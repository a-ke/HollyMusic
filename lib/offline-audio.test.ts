import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cachePlayedTrack, cancelOfflineDownloads, clearOfflineTracks, getOfflineAudio, listOfflineTracks,
  CACHE_MB, OFFLINE_DEFAULT_LIMIT_BYTES, getOfflineCacheLimit, setOfflineCacheLimit, planOfflineCleanup } from './offline-audio'
import { toTrack } from './types/player'

function memoryCaches() {
  const stores = new Map<string, Map<string, Response>>()
  return {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      const key = (input: string | Request) => typeof input === 'string' ? input : input.url
      return {
        match: async (input: string | Request) => store.get(key(input))?.clone(),
        put: async (input: string | Request, response: Response) => { store.set(key(input), response.clone()) },
        keys: async () => [...store.keys()].map(url => new Request(url)),
        delete: async (input: string | Request) => store.delete(key(input)),
      }
    },
    delete: async (name: string) => stores.delete(name),
  }
}
const track = (id: string) => toTrack({ uid: `kw-${id}`, musicInfo: {
  name: `歌曲 ${id}`, singer: '歌手', source: 'kw', songmid: id, interval: '03:00',
  types: [], _types: {}, typeUrl: {},
} as Parameters<typeof toTrack>[0]['musicInfo'] })
const response = (size = 4) => new Response(new Uint8Array(size), {
  headers: { 'content-type': 'audio/mpeg', 'content-length': String(size) },
})
const nativeFetch = globalThis.fetch

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { isSecureContext: true, caches: {}, location: { origin: 'https://holly.test' }, dispatchEvent: vi.fn(),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } } })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('caches', memoryCaches())
  vi.stubGlobal('fetch', vi.fn(async () => response()))
})
afterEach(() => { cancelOfflineDownloads(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('保存完整音频，按账号隔离，并从缓存返回可播放 Blob', async () => {
  await cachePlayedTrack('alice', track('1'), '320k')
  expect((await listOfflineTracks('alice'))[0]).toMatchObject({ size: 4, quality: '320k', track: { name: '歌曲 1' } })
  expect(await listOfflineTracks('bob')).toEqual([])
  const local = await getOfflineAudio('alice', 'kw-1', 'flac', ['128k', '320k'])
  expect(local?.quality).toBe('320k')
  const blob = await nativeFetch(local!.url)
  expect((await blob.arrayBuffer()).byteLength).toBe(4)
  URL.revokeObjectURL(local!.url)
  await clearOfflineTracks('alice')
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('已缓存歌曲不重复下载；相同歌曲不同音质分别保存', async () => {
  await Promise.all([cachePlayedTrack('alice', track('1'), '320k'), cachePlayedTrack('alice', track('1'), '320k')])
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).toHaveBeenCalledTimes(1)
  await cachePlayedTrack('alice', track('1'), '128k')
  expect(await listOfflineTracks('alice')).toHaveLength(2)
})

it.each([
  () => new Response('part', { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } }),
  () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg', 'content-length': '20' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg' } }),
  () => new Response('part', { headers: { 'content-type': 'audio/mpeg', 'content-length': String(OFFLINE_DEFAULT_LIMIT_BYTES + 1) } }),
])('不把部分响应、错误数据、截断或超过总容量的音频标记为离线可用', async factory => {
  vi.mocked(fetch).mockResolvedValue(factory())
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('清空或账号切换后，进行中的下载不能重新写回缓存', async () => {
  let resolve!: (response: Response) => void
  vi.mocked(fetch).mockImplementation(() => new Promise(done => { resolve = done }))
  const task = cachePlayedTrack('alice', track('1'), '320k')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  await clearOfflineTracks('alice')
  resolve(response())
  await task
  expect(await listOfflineTracks('alice')).toEqual([])
})

it('取消的下载尚未结束时可以排入同歌曲的重试，新任务仍保持去重', async () => {
  let resolve!: (response: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce(response())
  const cancelled = cachePlayedTrack('alice', track('1'), '320k')
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  cancelOfflineDownloads()
  const retry = cachePlayedTrack('alice', track('1'), '320k')
  const duplicate = cachePlayedTrack('alice', track('1'), '320k')
  resolve(response())
  await Promise.all([cancelled, retry, duplicate])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(await listOfflineTracks('alice')).toHaveLength(1)
})

it('缓存超过 100 个音频但未用满总容量时，不淘汰歌曲', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => ++now)
  for (let i = 0; i < 100; i++) await cachePlayedTrack('alice', track(String(i)), '320k')
  await cachePlayedTrack('alice', track('0'), '320k')
  await cachePlayedTrack('alice', track('100'), '320k')
  const entries = await listOfflineTracks('alice')
  expect(entries).toHaveLength(101)
  expect(entries.some(entry => entry.track.uid === 'kw-0')).toBe(true)
  expect(entries.some(entry => entry.track.uid === 'kw-1')).toBe(true)
})

it('大于旧单首 100 MiB 限制的完整音频，在总容量内仍可缓存', async () => {
  const size = 106 * CACHE_MB
  vi.mocked(fetch).mockResolvedValue(response(size))
  await cachePlayedTrack('alice', track('large'), 'flac')
  expect((await listOfflineTracks('alice'))[0]).toMatchObject({ size, quality: 'flac' })
})

it('容量最低 100 MB，按账号保存；损坏或非法设置回退默认值', async () => {
  expect(getOfflineCacheLimit('alice')).toBe(500 * CACHE_MB)
  for (const invalid of [99 * CACHE_MB, NaN, Infinity, -1, 100.1]) {
    await expect(setOfflineCacheLimit('alice', invalid)).rejects.toThrow('100 MB')
  }
  expect((await setOfflineCacheLimit('alice', 100 * CACHE_MB)).saved).toBe(true)
  expect(getOfflineCacheLimit('alice')).toBe(100 * CACHE_MB)
  expect(getOfflineCacheLimit('bob')).toBe(500 * CACHE_MB)
  window.localStorage.setItem('holly-offline-limit:alice', '{bad')
  expect(getOfflineCacheLimit('alice')).toBe(OFFLINE_DEFAULT_LIMIT_BYTES)
})

// 容量清理只读取元数据；这些测试不必分配数百 MB 的音频数据。
async function seed(id: string, sizeMB: number, usedAt: number) {
  const key = `https://holly.test/__offline_audio/kw-${id}/320k`
  await (await caches.open('holly-audio-v1:alice')).put(key, new Response('audio', { headers: {
    'content-type': 'audio/mpeg', 'content-length': String(sizeMB * CACHE_MB),
    'x-holly-track': encodeURIComponent(JSON.stringify(track(id))), 'x-holly-quality': '320k', 'x-holly-used': String(usedAt),
  } }))
  return key
}

it('按实际空间和最近使用顺序清理；单曲超过总容量时保留现有缓存', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  vi.mocked(fetch).mockResolvedValueOnce(new Response('audio', { headers: {
    'content-type': 'audio/mpeg', 'content-length': String(501 * CACHE_MB),
  } }))
  await cachePlayedTrack('alice', track('too-large'), '320k')
  expect(await listOfflineTracks('alice')).toHaveLength(2)
  vi.mocked(fetch).mockResolvedValueOnce(response())
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent'])
})

it.each(['QuotaExceededError', 'UnknownError'])('写入新歌曲失败（%s）时不淘汰任何旧歌曲', async name => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  vi.spyOn(cache, 'put').mockRejectedValue(new DOMException('存储失败', name))
  const deleted = vi.spyOn(cache, 'delete')
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect(deleted).not.toHaveBeenCalled()
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-recent', 'kw-old'])
  expect(window.dispatchEvent).not.toHaveBeenCalled()
})

it('新歌曲写入期间取消，只移除新歌曲，旧歌曲完整保留且通知刷新', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const put = cache.put.bind(cache)
  vi.spyOn(cache, 'put').mockImplementation(async (key, response) => {
    await put(key, response)
    cancelOfflineDownloads()
  })
  const deleted = vi.spyOn(cache, 'delete')
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-recent', 'kw-old'])
  expect(deleted).toHaveBeenCalledExactlyOnceWith('https://holly.test/__offline_audio/kw-new/320k')
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('开始淘汰后取消仍保留已写入的新歌曲，不发生新旧歌曲同时丢失', async () => {
  const old = await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const remove = cache.delete.bind(cache)
  vi.spyOn(cache, 'delete').mockImplementation(async key => {
    const removed = await remove(key)
    if (key === old) cancelOfflineDownloads()
    return removed
  })
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent'])
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('淘汰中途删除失败时保留新歌曲，仍通知列表刷新已发生的删除', async () => {
  await seed('old', 250, 1)
  const middle = await seed('middle', 250, 2)
  await seed('recent', 250, 3)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const remove = cache.delete.bind(cache)
  vi.spyOn(cache, 'delete').mockImplementation(async key => {
    if (key === middle) throw new Error('删除失败')
    return remove(key)
  })
  vi.mocked(window.dispatchEvent).mockClear()
  await cachePlayedTrack('alice', track('new'), '320k')
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new', 'kw-recent', 'kw-middle'])
  expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'holly-offline-changed' }))
})

it('读取淘汰计划期间取消，不写入新歌曲，也不删除旧歌曲', async () => {
  await seed('old', 250, 1)
  await seed('recent', 250, 2)
  const cache = await caches.open('holly-audio-v1:alice')
  vi.spyOn(caches, 'open').mockResolvedValue(cache)
  const keys = cache.keys.bind(cache)
  vi.spyOn(cache, 'keys').mockImplementationOnce(async () => {
    cancelOfflineDownloads()
    return keys()
  })
  const put = vi.spyOn(cache, 'put')
  const remove = vi.spyOn(cache, 'delete')
  await cachePlayedTrack('alice', track('new'), '320k')
  expect(put).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
  expect(await listOfflineTracks('alice')).toHaveLength(2)
})

it('调低上限先预览并确认，计划变化时不会删除未经确认的歌曲', async () => {
  const old = await seed('old', 70, 1)
  await seed('recent', 70, 2)
  const preview = await setOfflineCacheLimit('alice', 100 * CACHE_MB)
  expect(preview.saved).toBe(false)
  expect(preview.cleanup).toMatchObject({ bytes: 70 * CACHE_MB, entries: [{ key: old }] })
  expect(await listOfflineTracks('alice')).toHaveLength(2)
  expect(getOfflineCacheLimit('alice')).toBe(OFFLINE_DEFAULT_LIMIT_BYTES)
  await seed('new', 70, 3)
  const changed = await setOfflineCacheLimit('alice', 100 * CACHE_MB, [old])
  expect(changed.saved).toBe(false)
  expect(changed.cleanup.entries).toHaveLength(2)
  expect(await listOfflineTracks('alice')).toHaveLength(3)
  const saved = await setOfflineCacheLimit('alice', 100 * CACHE_MB, changed.cleanup.entries.map(item => item.key))
  expect(saved.saved).toBe(true)
  expect((await listOfflineTracks('alice')).map(item => item.track.uid)).toEqual(['kw-new'])
  expect(getOfflineCacheLimit('alice')).toBe(100 * CACHE_MB)
})

it('保存设置失败时不删除缓存，恰好达到上限不清理', async () => {
  await seed('old', 60, 1)
  await seed('new', 40, 2)
  expect(planOfflineCleanup(await listOfflineTracks('alice'), 100 * CACHE_MB).entries).toEqual([])
  const extra = await seed('extra', 10, 3)
  expect(extra).toContain('extra')
  const preview = await setOfflineCacheLimit('alice', 100 * CACHE_MB)
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(setOfflineCacheLimit('alice', 100 * CACHE_MB, preview.cleanup.entries.map(item => item.key))).rejects.toThrow('无法保存')
  expect(await listOfflineTracks('alice')).toHaveLength(3)
})

it('浏览器不允许存储时不影响在线播放', async () => {
  vi.stubGlobal('window', { isSecureContext: false })
  await cachePlayedTrack('alice', track('1'), '320k')
  expect(fetch).not.toHaveBeenCalled()
  expect(await listOfflineTracks('alice')).toEqual([])
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FavoritesPage } from '../src/routes/FavoritesPage'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import type { FavoriteSong } from '@/lib/api/favorites'

const api = vi.hoisted(() => ({ listFavorites: vi.fn(), starSong: vi.fn(), unstarSong: vi.fn() }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/favorites', () => api)
vi.mock('@/lib/toast', () => ({ toast: { error: toastError } }))
vi.mock('@/components/shared/SongList', () => ({ SongList: ({ tracks }: { tracks: { uid: string }[] }) => <div>{tracks.map(t => t.uid).join(',')}</div> }))
vi.mock('@/components/shared/LoadingSkeleton', () => ({ LoadingSkeleton: () => <div>loading</div> }))
vi.mock('@/components/shared/EmptyState', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const favorites = (start: number, count: number): FavoriteSong[] => Array.from({ length: count }, (_, i) => ({
  songId: `kw-song${start + i}`, source: 'kw', starredAt: '2026-09-21T00:00:00Z',
  musicInfo: {
    source: 'kw', songmid: `song${start + i}`, name: `song${start + i}`, singer: 'tester', interval: '03:00',
    types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {},
  },
}))
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  api.listFavorites.mockResolvedValue({ list: [], total: 0 })
  useFavoritesStore.getState().reset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  useFavoritesStore.getState().reset()
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function mount() {
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 200 })
  await act(async () => { root.render(<FavoritesPage />) })
}
async function loadMore() {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('加载更多'))!
  expect(button.textContent).toContain('加载更多')
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

async function typeSearch(value: string) {
  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function finishTyping() {
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
}

it('收藏刷新完成后丢弃此前发出的加载更多响应', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 100 })
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  await act(async () => { pending.resolve({ list: favorites(100, 100), total: 200 }) })
  expect(container.textContent).not.toContain('kw-song100')
  expect(container.textContent).not.toContain('加载更多')
})

it('过期加载更多的失败不弹提示，也不结束新分页的 loading', async () => {
  await mount()
  const oldPage = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(oldPage.promise)
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 200 })
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  const newPage = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(newPage.promise)
  await loadMore()
  await act(async () => { oldPage.reject(new Error('stale response')) })
  expect(toastError).not.toHaveBeenCalled()
  expect(container.querySelector('button')?.disabled).toBe(true)
  await act(async () => { newPage.resolve({ list: favorites(100, 100), total: 200 }) })
  expect(container.textContent).toContain('kw-song199')
})

it('页面卸载后不处理旧分页错误', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  await loadMore()
  await act(async () => { root.render(null) })
  await act(async () => { pending.reject(new Error('unmounted response')) })
  expect(toastError).not.toHaveBeenCalled()
})

it('连续点击只发送一个分页请求', async () => {
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  const button = container.querySelector('button')!
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(api.listFavorites).toHaveBeenCalledTimes(2)
  await act(async () => { pending.resolve({ list: favorites(100, 100), total: 200 }) })
})

it('超过 500 首的已加载深度在收藏刷新后仍保留', async () => {
  const all = favorites(0, 700)
  api.listFavorites.mockImplementation(async (limit: number, offset: number) => ({
    list: all.slice(offset, offset + limit), total: all.length,
  }))
  await act(async () => { root.render(<FavoritesPage />) })
  for (let i = 0; i < 5; i++) await loadMore()
  expect(container.textContent).toContain('600/700')
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 500)
  expect(container.textContent).toContain('kw-song599')
  expect(container.textContent).toContain('600/700')
})

it('分页仍按原始条目偏移推进，避免去重后反复读取重叠页面', async () => {
  await mount()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(99, 100), total: 300 })
  await loadMore()
  api.listFavorites.mockResolvedValueOnce({ list: favorites(200, 100), total: 300 })
  await loadMore()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 200)
  expect(container.textContent).not.toContain('加载更多')
})

it('输入自动搜索全部收藏，并在搜索结果翻页时保留关键词', async () => {
  vi.useFakeTimers()
  await mount()
  await typeSearch('  SOng')
  await typeSearch('  SOng150  ')
  expect(api.listFavorites).toHaveBeenCalledTimes(1)
  api.listFavorites.mockResolvedValueOnce({ list: favorites(150, 100), total: 120 })
  await finishTyping()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 0, 'song150')
  expect(container.textContent).toContain('找到 120 首音乐')
  api.listFavorites.mockResolvedValueOnce({ list: favorites(250, 20), total: 120 })
  await loadMore()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 100, 'song150')
  expect(container.textContent).toContain('kw-song269')
})

it('切换搜索词或清空搜索后忽略旧请求，清空恢复列表并聚焦输入框', async () => {
  vi.useFakeTimers()
  await mount()
  const pending = deferred<{ list: FavoriteSong[]; total: number }>()
  api.listFavorites.mockReturnValueOnce(pending.promise)
  await typeSearch('旧搜索')
  await finishTyping()
  await typeSearch('新搜索')
  await act(async () => { pending.resolve({ list: favorites(800, 1), total: 1 }) })
  expect(container.textContent).not.toContain('kw-song800')
  api.listFavorites.mockResolvedValueOnce({ list: favorites(900, 1), total: 1 })
  await finishTyping()
  expect(container.textContent).toContain('kw-song900')
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 100), total: 200 })
  await act(async () => {
    container.querySelector('[aria-label="清空搜索词"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 0)
  expect(container.textContent).toContain('已收藏 200 首音乐')
  expect(container.querySelector('input')?.value).toBe('')
  expect(document.activeElement).toBe(container.querySelector('input'))
})

it('中文输入法选词期间不搜索，确认后搜索并区分无结果与未收藏', async () => {
  vi.useFakeTimers()
  await mount()
  const input = container.querySelector('input')!
  await act(async () => { input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
  await typeSearch('zhou')
  await finishTyping()
  expect(api.listFavorites).toHaveBeenCalledTimes(1)
  await typeSearch('周杰伦')
  await act(async () => { input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })) })
  await finishTyping()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 0, '周杰伦')
  expect(container.textContent).toContain('未找到匹配的收藏')
  expect(container.textContent).toContain('找到 0 首音乐')
  expect(container.textContent).not.toContain('还没有收藏')
})

it('搜索失败可使用相同关键词重试，取消收藏后保持当前搜索', async () => {
  vi.useFakeTimers()
  await mount()
  api.listFavorites.mockRejectedValueOnce(new Error('offline'))
  await typeSearch('歌曲')
  await finishTyping()
  expect(container.textContent).toContain('搜索收藏失败')
  api.listFavorites.mockResolvedValueOnce({ list: favorites(0, 1), total: 1 })
  await act(async () => {
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '重试')!
    retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await finishTyping()
  expect(container.textContent).toContain('找到 1 首音乐')
  await act(async () => { useFavoritesStore.setState({ version: 1 }) })
  await finishTyping()
  expect(api.listFavorites).toHaveBeenLastCalledWith(100, 0, '歌曲')
  expect(container.querySelector('input')?.value).toBe('歌曲')
  expect(container.textContent).toContain('未找到匹配的收藏')
})

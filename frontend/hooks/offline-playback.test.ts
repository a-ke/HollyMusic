import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlayerStore } from '@/lib/store/player-store'
import { getOfflineAudio } from '@/lib/offline-audio'
import { toTrack } from '@/lib/types/player'
import { buildAudioUrl } from '@/lib/api/music'
import { reportPlay } from '@/lib/api/history'
import { parseTrack, playbackSessionStorage } from '@/lib/player-storage'

vi.mock('@/lib/offline-audio', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/offline-audio')>(), getOfflineAudio: vi.fn(),
}))
vi.mock('@/lib/api/history', () => ({ reportPlay: vi.fn(async () => {}) }))
const track = toTrack({ uid: 'kw-1', musicInfo: { name: '歌曲', singer: '歌手', source: 'kw', songmid: '1',
  interval: '03:00', types: [], _types: {}, typeUrl: {},
} as Parameters<typeof toTrack>[0]['musicInfo'] })

beforeEach(() => {
  useAuthStore.setState({ authenticated: null, username: null, offlineUsername: 'alice' })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  usePlayerStore.setState({ currentTrack: track, queue: [track], currentIndex: 0 })
  vi.mocked(getOfflineAudio).mockReset()
  vi.mocked(reportPlay).mockClear()
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('断网从本机 Blob 恢复歌曲与进度，使用实际缓存音质', async () => {
  vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:local', quality: '128k' })
  await usePlayerStore.getState().loadStreamUrl(track, undefined, { startTime: 92 })
  expect(getOfflineAudio).toHaveBeenCalledWith('alice', 'kw-1', '320k', expect.any(Array))
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: 'blob:local', effectiveQuality: '128k', currentTime: 92, isPlaying: true })
})

it('未完整缓存时停止并明确提示，不请求在线音频', async () => {
  vi.mocked(getOfflineAudio).mockResolvedValue(null)
  await usePlayerStore.getState().loadStreamUrl(track)
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: null, isPlaying: false })
  expect(usePlayerStore.getState().urlFetchError).toContain('尚未完整缓存')
})

it('清空队列或切换账号后，过期的缓存读取不能重新开始播放', async () => {
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementation(() => new Promise(done => { resolve = done }))
  const loading = usePlayerStore.getState().loadStreamUrl(track)
  usePlayerStore.getState().clearQueue()
  resolve({ url: 'blob:stale', quality: '320k' })
  await loading
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, streamUrl: null, isPlaying: false })
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale')
})

it('在线优先读取当前账号同渠道同歌曲同音质的缓存，并保留进度与暂停状态', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:online-cache', quality: '320k' })
  await usePlayerStore.getState().loadStreamUrl(track, undefined, { startTime: 42, autoplay: false })
  expect(getOfflineAudio).toHaveBeenCalledWith('alice', 'kw-1', '320k', ['320k'])
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: 'blob:online-cache', effectiveQuality: '320k', currentTime: 42, isPlaying: false })
})

it.each(['未命中', '读取异常'])('在线缓存%s时回退服务端音频', async result => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  if (result === '读取异常') vi.mocked(getOfflineAudio).mockRejectedValue(new Error('存储不可用'))
  else vi.mocked(getOfflineAudio).mockResolvedValue(null)
  await usePlayerStore.getState().loadStreamUrl(track)
  expect(getOfflineAudio).toHaveBeenCalledWith('alice', 'kw-1', '320k', ['320k'])
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: buildAudioUrl(track.uid, '320k'), isPlaying: true })
})

it('相同歌曲 ID 的不同渠道分别查询，切换音质只查询指定档位', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockResolvedValue(null)
  await usePlayerStore.getState().loadStreamUrl(track)
  const otherSource = toTrack({ uid: 'tx-1', musicInfo: { ...track.musicInfo, source: 'tx' } })
  usePlayerStore.setState({ currentTrack: otherSource })
  await usePlayerStore.getState().loadStreamUrl(otherSource, '128k')
  expect(getOfflineAudio).toHaveBeenNthCalledWith(1, 'alice', 'kw-1', '320k', ['320k'])
  expect(getOfflineAudio).toHaveBeenNthCalledWith(2, 'alice', 'tx-1', '128k', ['128k'])
  expect(usePlayerStore.getState().streamUrl).toBe(buildAudioUrl('tx-1', '128k'))
})

it('在线快速切歌时忽略旧缓存查询，释放旧 Blob', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce(null)
  const loading = usePlayerStore.getState().loadStreamUrl(track)
  await usePlayerStore.getState().loadStreamUrl(track, '128k')
  resolve({ url: 'blob:stale', quality: '320k' })
  await loading
  expect(usePlayerStore.getState().streamUrl).toBe(buildAudioUrl(track.uid, '128k'))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale')
})

it.each(['hit', 'miss', 'error'])('切音质时缓存读取 %s，期间暂停并拖动后不自动播放或重置进度', async result => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  usePlayerStore.setState({ streamUrl: buildAudioUrl(track.uid, '320k'), isPlaying: true,
    effectiveQuality: '320k', currentTime: 90 })
  let resolve!: (value: { url: string; quality: '128k' } | null) => void
  let reject!: (reason: Error) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail }))
  usePlayerStore.getState().setQuality('128k')
  usePlayerStore.getState().setIsPlaying(false)
  usePlayerStore.getState().seek(120)
  if (result === 'error') reject(new Error('存储不可用'))
  else resolve(result === 'hit' ? { url: 'blob:new-quality', quality: '128k' } : null)
  await vi.waitFor(() => {
    expect(usePlayerStore.getState().streamUrl).toBe(result === 'hit' ? 'blob:new-quality' : buildAudioUrl(track.uid, '128k'))
  })
  expect(usePlayerStore.getState()).toMatchObject({ isPlaying: false, currentTime: 120, effectiveQuality: '128k' })
})

it('离线首次选歌读取缓存时暂停，完成后保持暂停', async () => {
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const loading = usePlayerStore.getState().playTrack(track, [track], { offline: true })
  usePlayerStore.getState().setIsPlaying(false)
  resolve({ url: 'blob:paused', quality: '320k' })
  await loading
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, streamUrl: 'blob:paused', isPlaying: false })
})

it.each(['hit', 'miss', 'error'])('移除当前歌曲后丢弃旧缓存读取（%s），不写回音频或错误提示', async result => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  let resolve!: (value: { url: string; quality: '320k' } | null) => void
  let reject!: (reason: Error) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail }))
  const loading = usePlayerStore.getState().loadStreamUrl(track)
  usePlayerStore.getState().removeFromQueue(0)
  if (result === 'error') reject(new Error('存储不可用'))
  else resolve(result === 'hit' ? { url: 'blob:removed', quality: '320k' } : null)
  await loading
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: null, streamUrl: null,
    isPlaying: false, isFetchingUrl: false, urlFetchError: null })
  if (result === 'hit') expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:removed')
})

it.each(['account', 'track'])('提交缓存结果前再次校验 %s，即使没有新加载请求也丢弃旧结果', async change => {
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const loading = usePlayerStore.getState().loadStreamUrl(track)
  if (change === 'account') useAuthStore.setState({ offlineUsername: 'bob' })
  else usePlayerStore.setState({ currentTrack: null })
  resolve({ url: 'blob:stale', quality: '320k' })
  await loading
  expect(usePlayerStore.getState().streamUrl).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale')
})

it('移除主队列中的歌曲不打断当前插播歌曲的缓存读取', async () => {
  usePlayerStore.setState({ isCurrentTempPlay: true })
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const loading = usePlayerStore.getState().loadStreamUrl(track)
  usePlayerStore.getState().removeFromQueue(0)
  resolve({ url: 'blob:temporary', quality: '320k' })
  await loading
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, streamUrl: 'blob:temporary', isPlaying: true })
})

function interruptedStream() {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  usePlayerStore.setState({ currentTrack: track, queue: [track], currentIndex: 0,
    streamUrl: buildAudioUrl(track.uid, '320k'), effectiveQuality: '320k', currentTime: 123,
    // 模拟音频引擎先上报暂停，再传递错误发生前的播放意图。
    isPlaying: false, errorRetryCount: 0 })
}

it.each([2, 4])('网络播放失败（错误码 %s）时用同渠道同歌曲同音质的本地缓存恢复进度', async code => {
  interruptedStream()
  if (code === 4) vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:recovered', quality: '320k' })
  await usePlayerStore.getState().handleTrackError('网络失败', code, true)
  expect(getOfflineAudio).toHaveBeenCalledExactlyOnceWith('alice', 'kw-1', '320k', ['320k'])
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, currentTime: 123,
    streamUrl: 'blob:recovered', effectiveQuality: '320k', isPlaying: true, errorRetryCount: 0, urlFetchError: null })
})

it.each(['miss', 'error'])('网络错误后的本地恢复 %s 时执行原有停止逻辑', async result => {
  interruptedStream()
  if (result === 'miss') vi.mocked(getOfflineAudio).mockResolvedValue(null)
  else vi.mocked(getOfflineAudio).mockRejectedValue(new Error('storage unavailable'))
  await usePlayerStore.getState().handleTrackError('网络失败', 2, true)
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: null, isPlaying: false, currentTime: 123 })
  expect(usePlayerStore.getState().urlFetchError).toContain('已停止')
})

it('本地 Blob 播放失败不重复读取同一缓存', async () => {
  interruptedStream()
  usePlayerStore.setState({ streamUrl: 'blob:broken' })
  await usePlayerStore.getState().handleTrackError('网络失败', 2, true)
  expect(getOfflineAudio).not.toHaveBeenCalled()
  expect(usePlayerStore.getState().isPlaying).toBe(false)
})

it('恢复缓存期间用户暂停并调整进度，恢复后保持暂停和最新进度', async () => {
  interruptedStream()
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const recovering = usePlayerStore.getState().handleTrackError('网络失败', 2, true)
  usePlayerStore.getState().setIsPlaying(false)
  usePlayerStore.getState().seek(180)
  resolve({ url: 'blob:recovered', quality: '320k' })
  await recovering
  expect(usePlayerStore.getState()).toMatchObject({ streamUrl: 'blob:recovered', currentTime: 180, isPlaying: false })
})

it.each(['clear', 'account', 'quality', 'remove'])('恢复期间发生 %s，丢弃旧结果且释放 Blob', async action => {
  interruptedStream()
  let resolve!: (value: { url: string; quality: '320k' }) => void
  vi.mocked(getOfflineAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce(null)
  const recovering = usePlayerStore.getState().handleTrackError('网络失败', 2, true)
  if (action === 'clear') usePlayerStore.getState().clearQueue()
  else if (action === 'remove') usePlayerStore.getState().removeFromQueue(0)
  else if (action === 'account') useAuthStore.setState({ username: 'bob' })
  else await usePlayerStore.getState().loadStreamUrl(track, '128k')
  resolve({ url: 'blob:stale-recovery', quality: '320k' })
  await recovering
  expect(usePlayerStore.getState().streamUrl).not.toBe('blob:stale-recovery')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-recovery')
})

it('已暂停的网络音频出错不会自动恢复或跳歌', async () => {
  interruptedStream()
  await usePlayerStore.getState().handleTrackError('网络失败', 2, false)
  expect(getOfflineAudio).not.toHaveBeenCalled()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: track, currentTime: 123, isPlaying: false })
})

const local128 = { ...track, playback: { source: 'local', quality: '128k' } as const }
const secondLocal = { ...track, uid: 'kw-2', musicInfo: { ...track.musicInfo, songmid: '2' },
  playback: { source: 'local', quality: '320k' } as const }

it.each(['next', 'ended', 'random'])('联网本地队列通过 %s 切歌时沿用每条歌曲的缓存音质', async action => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockImplementation(async (_user, uid, quality) => ({ url: `blob:${uid}:${quality}`, quality }))
  usePlayerStore.setState({ quality: 'flac', codecCap: 'flac24bit' })
  await usePlayerStore.getState().playTrack(local128, [local128, secondLocal])
  if (action === 'ended') usePlayerStore.getState().handleTrackEnd()
  else {
    if (action === 'random') usePlayerStore.setState({ playbackMode: 'random' })
    usePlayerStore.getState().next()
  }
  await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBe('blob:kw-2:320k'))
  expect(getOfflineAudio).toHaveBeenNthCalledWith(1, 'alice', 'kw-1', '128k', ['128k'])
  expect(getOfflineAudio).toHaveBeenNthCalledWith(2, 'alice', 'kw-2', '320k', ['320k'])
  expect(usePlayerStore.getState().quality).toBe('flac')
  expect(reportPlay).not.toHaveBeenCalled()
})

it('本地播放回退与再次前进使用各自绑定音质，不转成在线播放', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockImplementation(async (_user, uid, quality) => ({ url: `blob:${uid}:${quality}`, quality }))
  await usePlayerStore.getState().playTrack(local128, [local128, secondLocal])
  usePlayerStore.getState().markPlaybackStarted()
  usePlayerStore.getState().next()
  await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBe('blob:kw-2:320k'))
  usePlayerStore.getState().markPlaybackStarted()
  usePlayerStore.getState().previous()
  await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBe('blob:kw-1:128k'))
  usePlayerStore.getState().next()
  await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBe('blob:kw-2:320k'))
  expect(reportPlay).not.toHaveBeenCalled()
})

it('本地列表同一歌曲不同音质可分别定位队列项，单曲循环保留本地音频', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  const local320 = { ...track, playback: { source: 'local', quality: '320k' } as const }
  vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:320', quality: '320k' })
  await usePlayerStore.getState().playTrack(local320, [local128, local320])
  expect(usePlayerStore.getState().currentIndex).toBe(1)
  usePlayerStore.setState({ playbackMode: 'loop' })
  usePlayerStore.getState().handleTrackEnd()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: local320, streamUrl: 'blob:320', currentTime: 0, isPlaying: true })
  expect(getOfflineAudio).toHaveBeenCalledTimes(1)
})

it('本地队列下一首缓存缺失时提示并停止，不转为网络播放', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockResolvedValueOnce({ url: 'blob:128', quality: '128k' }).mockResolvedValueOnce(null)
  await usePlayerStore.getState().playTrack(local128, [local128, secondLocal])
  usePlayerStore.getState().next()
  await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBeNull())
  expect(usePlayerStore.getState().isPlaying).toBe(false)
  expect(usePlayerStore.getState().urlFetchError).toContain('尚未完整缓存')
})

it('本地播放期间调整全局音质，当前本地歌曲继续使用绑定的缓存音质', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:128', quality: '128k' })
  await usePlayerStore.getState().playTrack(local128, [local128])
  usePlayerStore.getState().setQuality('flac')
  await vi.waitFor(() => expect(getOfflineAudio).toHaveBeenCalledTimes(2))
  expect(getOfflineAudio).toHaveBeenLastCalledWith('alice', track.uid, '128k', ['128k'])
})

it('播放会话保存并恢复后，主队列和插播队列仍保留本地来源和音质', async () => {
  useAuthStore.setState({ authenticated: true, username: 'alice', offlineUsername: null })
  const storage = playbackSessionStorage('alice')
  try {
    storage.write({ queue: [local128, secondLocal], playNextQueue: [local128], currentTrack: local128,
      currentIndex: 0, isCurrentTempPlay: false, currentTime: 92 })
    const session = storage.read()
    expect(session?.queue).toEqual([local128, secondLocal])
    expect(session?.playNextQueue).toEqual([local128])
    usePlayerStore.getState().restorePlayback(session)
    vi.mocked(getOfflineAudio).mockResolvedValue({ url: 'blob:restored', quality: '128k' })
    usePlayerStore.getState().togglePlay()
    await vi.waitFor(() => expect(usePlayerStore.getState().streamUrl).toBe('blob:restored'))
    expect(getOfflineAudio).toHaveBeenLastCalledWith('alice', track.uid, '128k', ['128k'])
    expect(usePlayerStore.getState().currentTime).toBe(92)
  } finally { storage.remove() }
})

it('损坏的本地播放元数据不会被静默恢复成在线歌曲', () => {
  expect(parseTrack({ ...track, playback: { source: 'local', quality: 'invalid' } })).toBeNull()
})

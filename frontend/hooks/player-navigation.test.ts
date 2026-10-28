import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAuthStore } from '@/hooks/useAuth'
import { playbackSessionStorage } from '@/lib/player-storage'
import { startPlayerSession } from '@/lib/player-persistence'
import { toTrack } from '@/lib/types/player'

vi.mock('@/lib/api/history', () => ({ reportPlay: vi.fn(async () => {}) }))
const tracks = ['A', 'B', 'C', 'D'].map(name => toTrack({ uid: `kw-${name}`, musicInfo: {
  name, singer: 'artist', source: 'kw', songmid: name, interval: '03:00', types: [],
  _types: { '128k': { type: '128k' }, '320k': { type: '320k' }, flac: { type: 'flac' }, flac24bit: { type: 'flac24bit' } }, typeUrl: {},
} }))
let stop: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useAuthStore.setState({ authenticated: false, username: null, offlineUsername: null })
  vi.spyOn(Math, 'random').mockReturnValue(0.2)
})
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks() })

async function start() {
  usePlayerStore.getState().setPlaybackMode('random')
  await usePlayerStore.getState().playTrack(tracks[0], tracks)
  usePlayerStore.getState().markPlaybackStarted()
}
function next() {
  usePlayerStore.getState().next()
  usePlayerStore.getState().markPlaybackStarted()
}

it('保留超过 3 秒先重播，3 秒内沿历史回退，再前进回到原曲', async () => {
  await start()
  next()
  const target = usePlayerStore.getState().currentTrack
  usePlayerStore.getState().seek(3.01)
  usePlayerStore.getState().previous()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: target, currentTime: 0, seekTarget: 0 })
  usePlayerStore.getState().seek(3)
  usePlayerStore.getState().previous()
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(tracks[0].uid)
  next()
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(target?.uid)
})

it('刚开始播放且没有历史时，上一首只回到开头，不随机或循环到队尾', async () => {
  await start()
  usePlayerStore.getState().seek(2)
  usePlayerStore.getState().previous()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: tracks[0], currentTime: 0 })
  expect(usePlayerStore.getState().navigation?.past).toEqual([])
})

it('音源失败自动跳歌不记录未播放曲目，3 秒规则不阻止回退到真实上一首', async () => {
  await start()
  usePlayerStore.getState().next()
  const failed = usePlayerStore.getState().currentTrack
  await usePlayerStore.getState().handleTrackError('bad source', 1, true)
  usePlayerStore.getState().markPlaybackStarted()
  expect(usePlayerStore.getState().currentTrack?.uid).not.toBe(failed?.uid)
  usePlayerStore.getState().previous()
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(tracks[0].uid)
})

it('刷新恢复回退位置、未消费插播与随机顺序，并保持暂停', async () => {
  stop = startPlayerSession('alice')
  await start()
  next()
  next()
  usePlayerStore.getState().previous()
  usePlayerStore.getState().addNext(tracks[3])
  usePlayerStore.getState().seek(2)
  const before = usePlayerStore.getState().navigation!
  stop()
  usePlayerStore.getState().clearQueue()
  stop = startPlayerSession('alice')
  const state = usePlayerStore.getState()
  expect(state.navigation).toEqual(before)
  expect(state).toMatchObject({ currentTime: 2, isPlaying: false, streamUrl: null })
  next()
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(tracks[3].uid)
  next()
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(before.future[0].entry.track.uid)
  expect(usePlayerStore.getState().playNextQueue).toEqual([])
})

it('旧版记录迁移后保留进度和重复插播，不虚构播放历史', () => {
  const storage = playbackSessionStorage('alice')
  localStorage.setItem(storage.key, JSON.stringify({ version: 1, data: {
    queue: tracks, playNextQueue: [tracks[1], tracks[1]], currentTrack: { ...tracks[2], duration: 200 }, currentIndex: 2,
    isCurrentTempPlay: false, currentTime: 52,
  } }))
  stop = startPlayerSession('alice')
  expect(usePlayerStore.getState()).toMatchObject({ currentTime: 52, duration: 200, currentTrack: { ...tracks[2], duration: 200 } })
  expect(usePlayerStore.getState().playNextQueue).toHaveLength(2)
  expect(usePlayerStore.getState().navigation?.past).toEqual([])
  expect(JSON.parse(sessionStorage.getItem(storage.key)!).version).toBe(2)
})

it('损坏的导航引用不会恢复到其他歌曲；清空后刷新不复活历史', async () => {
  stop = startPlayerSession('alice')
  await start()
  next()
  const storage = playbackSessionStorage('alice')
  const corrupted = JSON.parse(localStorage.getItem(storage.key)!)
  corrupted.data.upcoming = ['missing-entry']
  localStorage.setItem(storage.key, JSON.stringify(corrupted))
  expect(storage.read()).toBeNull()
  usePlayerStore.getState().clearQueue()
  stop()
  stop = startPlayerSession('alice')
  expect(usePlayerStore.getState().currentTrack).toBeNull()
  expect(usePlayerStore.getState().navigation?.past).toEqual([])
})

it('同曲重复主队列条目按点击索引定位，回退到插播不重新添加待插播项', async () => {
  await usePlayerStore.getState().playTrack(tracks[0], [tracks[0], tracks[0], tracks[1]], { queueIndex: 1 })
  usePlayerStore.getState().markPlaybackStarted()
  expect(usePlayerStore.getState().currentIndex).toBe(1)
  usePlayerStore.getState().addNext(tracks[2])
  next()
  next()
  usePlayerStore.getState().previous()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: tracks[2], isCurrentTempPlay: true, playNextQueue: [] })
  next()
  expect(usePlayerStore.getState()).toMatchObject({ currentTrack: tracks[1], isCurrentTempPlay: false, playNextQueue: [] })
})

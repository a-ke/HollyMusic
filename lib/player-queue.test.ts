import { describe, expect, it, vi } from 'vitest'
import {
  confirmQueuePlayback, emptyPlaybackQueue, enqueueTrack, MAX_PLAYBACK_HISTORY, nextQueueEntry,
  playManualEntry, previousQueueEntry, removeManualEntry, removeQueueEntry, selectTrack,
  setQueueShuffle, upcomingQueueEntries, type PlaybackQueue,
} from './player-queue'
import { toTrack } from './types/player'

const tracks = ['A', 'B', 'C', 'D'].map(name => toTrack({ uid: `kw-${name}`, musicInfo: {
  name, singer: 'artist', source: 'kw', songmid: name, interval: '03:00', types: [],
  _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {},
} }))
const [a, b, c, d] = tracks
const random = () => 0.2
const start = (shuffle = true) => confirmQueuePlayback(selectTrack(emptyPlaybackQueue(shuffle), a, tracks, 0, random))
const advance = (state: PlaybackQueue) => confirmQueuePlayback(nextQueueEntry(state, random))
const name = (state: PlaybackQueue) => state.current?.entry.track.name

describe('随机播放顺序', () => {
  it('每轮每个条目只自动选取一次，跨轮首尾不重复', () => {
    let state = start()
    const first = [name(state)]
    for (let i = 0; i < 3; i++) { state = advance(state); first.push(name(state)) }
    expect(new Set(first)).toEqual(new Set(['A', 'B', 'C', 'D']))
    const last = name(state)
    state = advance(state)
    expect(name(state)).not.toBe(last)
    const second = [name(state)]
    for (let i = 0; i < 3; i++) { state = advance(state); second.push(name(state)) }
    expect(new Set(second)).toEqual(new Set(first))
  })

  it('队列显示顺序等于接下来实际播放的顺序，读取不重新洗牌', () => {
    let state = start()
    const upcoming = upcomingQueueEntries(state).map(item => item.entry.track.name)
    expect(upcomingQueueEntries(state).map(item => item.entry.track.name)).toEqual(upcoming)
    const played = upcoming.map(() => { state = advance(state); return name(state) })
    expect(played).toEqual(upcoming)
  })

  it('多次回退和前进沿原轨迹移动，不重新抽签、不消耗待播顺序', () => {
    let state = start()
    const heard = [name(state)]
    for (let i = 0; i < 2; i++) { state = advance(state); heard.push(name(state)) }
    const upcoming = state.upcoming
    state = previousQueueEntry(state)
    expect(name(state)).toBe(heard[1])
    state = previousQueueEntry(state)
    expect(name(state)).toBe(heard[0])
    const unexpectedRandom = vi.fn(() => { throw new Error('回看历史不应抽签') })
    state = nextQueueEntry(state, unexpectedRandom)
    expect(name(state)).toBe(heard[1])
    state = nextQueueEntry(state, unexpectedRandom)
    expect(name(state)).toBe(heard[2])
    expect(state.upcoming).toEqual(upcoming)
    expect(unexpectedRandom).not.toHaveBeenCalled()
  })

  it('没有历史时不跳至列表尾部，未开始播放的失败歌曲不进入回退记录', () => {
    let state = start()
    expect(previousQueueEntry(state)).toBe(state)
    state = nextQueueEntry(state, random)
    const failed = name(state)
    state = advance(state)
    state = previousQueueEntry(state)
    expect(name(state)).toBe('A')
    expect(state.future.map(visit => visit.entry.track.name)).not.toContain(failed)
  })

  it('切换模式保留历史和当前位置，关闭随机后按主列表继续', () => {
    let state = advance(start())
    const past = state.past
    const current = state.current
    state = setQueueShuffle(state, false, random)
    expect(state.past).toBe(past)
    expect(state.current).toBe(current)
    const index = tracks.findIndex(track => track.uid === current?.entry.track.uid)
    expect(name(advance(state))).toBe(tracks[(index + 1) % tracks.length].name)
  })

  it('同一列表手动选歌保留其余随机顺序，替换列表重建会话并保留待插播', () => {
    let state = start()
    const id = state.entries[2].id
    const remaining = state.upcoming.filter(item => item !== id)
    state = selectTrack(state, c, [...tracks], 2, random)
    expect(state.upcoming).toEqual(remaining)
    state = enqueueTrack(state, d, true)
    state = selectTrack(state, b, [b, c], 0, random)
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
    expect(state.manual.map(entry => entry.track)).toEqual([d])
  })
})

describe('插播与条目身份', () => {
  it('连续插播保持手动排序，回退和重放不会重复消费插播', () => {
    let state = start()
    const mainUpcoming = state.upcoming
    state = enqueueTrack(state, b, false)
    state = enqueueTrack(state, c, false)
    state = enqueueTrack(state, d, true)
    const ids = state.manual.map(entry => entry.id)
    for (const expected of ['D', 'B', 'C']) { state = advance(state); expect(name(state)).toBe(expected) }
    expect(state.manual).toEqual([])
    expect(state.upcoming).toEqual(mainUpcoming)
    state = previousQueueEntry(state)
    expect(state.current?.entry.id).toBe(ids[1])
    state = advance(state)
    expect(name(state)).toBe('C')
    expect(state.manual).toEqual([])
    state = advance(state)
    expect(state.current?.entry.id).toBe(mainUpcoming[0])
  })

  it('回退后新增的下一首优先播放，随后仍能继续原来的前进记录', () => {
    let state = advance(start())
    const forward = state.current?.entry.id
    state = previousQueueEntry(state)
    state = enqueueTrack(state, d, true)
    state = advance(state)
    expect(name(state)).toBe('D')
    state = advance(state)
    expect(state.current?.entry.id).toBe(forward)
    expect(name(previousQueueEntry(state))).toBe('D')
  })

  it('重复入队使用不同 ID，删除一个或点选第二个不会误操作另一个', () => {
    let state = start()
    state = enqueueTrack(enqueueTrack(state, b, false), b, false)
    expect(new Set(state.manual.map(entry => entry.id)).size).toBe(2)
    const second = state.manual[1]
    state = removeManualEntry(state, 0)
    state = playManualEntry(state, 0)
    expect(state.current?.entry.id).toBe(second.id)
    state = selectTrack(state, a, [a, a, b], 1, random)
    expect(state.current?.entry.id).toBe(state.entries[1].id)
    expect(state.entries[0].id).not.toBe(state.entries[1].id)
  })

  it('删除歌曲清理待播和历史，删除插播的主列表位置不打断当前插播', () => {
    let state = advance(start(false))
    const removedId = state.entries[0].id
    state = removeQueueEntry(state, 0, random)
    expect(state.past.some(visit => visit.entry.id === removedId)).toBe(false)
    expect(state.upcoming).not.toContain(removedId)
    state = advance(enqueueTrack(state, d, true))
    const manualId = state.current?.entry.id
    state = removeQueueEntry(state, 0, random)
    expect(state.current?.entry.id).toBe(manualId)
    expect(name(advance(state))).toBe('C')
  })

  it('只有插播队列时也支持前后导航，且不会将插播自动循环', () => {
    let state = enqueueTrack(enqueueTrack(emptyPlaybackQueue(), a, false), b, false)
    state = advance(advance(state))
    expect(name(state)).toBe('B')
    state = previousQueueEntry(state)
    expect(name(state)).toBe('A')
    state = advance(state)
    expect(name(state)).toBe('B')
    expect(nextQueueEntry(state)).toBe(state)
  })

  it('长期播放与回退中插播仍限制历史长度，避免会话无限增长', () => {
    let state = start()
    for (let i = 0; i < MAX_PLAYBACK_HISTORY + 10; i++) state = advance(state)
    expect(state.past).toHaveLength(MAX_PLAYBACK_HISTORY)
    for (let i = 0; i < 20; i++) state = previousQueueEntry(state)
    for (let i = 0; i < 30; i++) state = advance(enqueueTrack(state, d, true))
    expect(state.past.length + state.future.length).toBeLessThanOrEqual(MAX_PLAYBACK_HISTORY)
  })
})

import type { PlaybackMode, Track } from './types/player'

/** 歌曲身份与入队身份分离：同曲重复插播、不同本地音质都可以独立导航。 */
export interface QueueEntry { id: string; track: Track }
export interface PlaybackVisit {
  entry: QueueEntry
  /** 此次播放对应的主列表位置；插播继承进入时的位置。 */
  mainId: string | null
  started: boolean
}

/** 当前会话的唯一顺序来源。past / future 只保存实际开始过的播放。 */
export interface PlaybackQueue {
  entries: QueueEntry[]
  manual: QueueEntry[]
  past: PlaybackVisit[]
  current: PlaybackVisit | null
  future: PlaybackVisit[]
  upcoming: string[]
  shuffle: boolean
  nextId: number
}

export interface LegacyQueue {
  queue: Track[]
  playNextQueue: Track[]
  currentTrack: Track | null
  currentIndex: number
  isCurrentTempPlay: boolean
}

export const MAX_PLAYBACK_HISTORY = 200
type Random = () => number

export function sameTrack(a: Track, b: Track): boolean {
  return a.uid === b.uid && a.playback?.source === b.playback?.source && a.playback?.quality === b.playback?.quality
}

export function emptyPlaybackQueue(shuffle = false): PlaybackQueue {
  return { entries: [], manual: [], past: [], current: null, future: [], upcoming: [], shuffle, nextId: 1 }
}

function shuffled(ids: string[], random: Random): string[] {
  const result = [...ids]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function frontier(state: PlaybackQueue): string | null {
  return state.future[state.future.length - 1]?.mainId ?? state.current?.mainId ?? null
}

/** 下一轮在消费完本轮时生成，因此打开面板不会改变随机数或播放安排。 */
function nextRound(state: PlaybackQueue, random: Random): string[] {
  const ids = state.entries.map(entry => entry.id)
  const anchor = frontier(state)
  if (state.shuffle) {
    const order = shuffled(ids, random)
    if (order.length > 1 && order[0] === anchor) [order[0], order[1]] = [order[1], order[0]]
    return order
  }
  const index = ids.indexOf(anchor ?? '')
  return [...ids.slice(index + 1), ...ids.slice(0, index + 1)]
}

function ensureUpcoming(state: PlaybackQueue, random: Random): PlaybackQueue {
  return state.upcoming.length || !state.entries.length ? state : { ...state, upcoming: nextRound(state, random) }
}

export function setQueueShuffle(state: PlaybackQueue, enabled: boolean, random: Random = Math.random): PlaybackQueue {
  if (state.shuffle === enabled) return state
  const changed = { ...state, shuffle: enabled }
  if (!enabled) return { ...changed, upcoming: nextRound(changed, random) }
  const replayIds = new Set([state.current?.entry.id, ...state.future.map(visit => visit.entry.id)])
  return ensureUpcoming({ ...changed, upcoming: shuffled(state.entries.map(entry => entry.id).filter(id => !replayIds.has(id)), random) }, random)
}

export function restoreLegacyQueue(legacy: LegacyQueue, mode: PlaybackMode): PlaybackQueue {
  let nextId = 1
  const makeEntry = (track: Track): QueueEntry => ({ id: String(nextId++), track })
  const entries = legacy.queue.map(makeEntry)
  const manual = legacy.playNextQueue.map(makeEntry)
  const anchor = entries[legacy.currentIndex]?.id ?? null
  const current = legacy.currentTrack ? {
    entry: !legacy.isCurrentTempPlay && entries[legacy.currentIndex]
      ? { ...entries[legacy.currentIndex], track: legacy.currentTrack } : makeEntry(legacy.currentTrack),
    mainId: anchor, started: true,
  } : null
  const state = { ...emptyPlaybackQueue(), entries, manual, current, nextId }
  state.upcoming = nextRound(state, Math.random)
  return setQueueShuffle(state, mode === 'random')
}

export function projectPlaybackQueue(state: PlaybackQueue): LegacyQueue & { navigation: PlaybackQueue } {
  const currentIndex = state.entries.findIndex(entry => entry.id === state.current?.mainId)
  return {
    navigation: state,
    queue: state.entries.map(entry => entry.track),
    playNextQueue: state.manual.map(entry => entry.track),
    currentTrack: state.current?.entry.track ?? null,
    currentIndex,
    isCurrentTempPlay: !!state.current && state.current.entry.id !== state.current.mainId,
  }
}

function rememberCurrent(state: PlaybackQueue): PlaybackVisit[] {
  if (!state.current?.started) return state.past
  const limit = MAX_PLAYBACK_HISTORY - state.future.length
  return limit > 0 ? [...state.past, state.current].slice(-limit) : []
}

function activate(state: PlaybackQueue, visit: PlaybackVisit): PlaybackQueue {
  return { ...state, past: rememberCurrent(state), current: visit }
}

export function confirmQueuePlayback(state: PlaybackQueue): PlaybackQueue {
  return !state.current || state.current.started ? state : { ...state, current: { ...state.current, started: true } }
}

/** 显式换列表开启新会话；在同一列表点歌保留已有随机顺序。 */
export function selectTrack(
  state: PlaybackQueue, track: Track, tracks?: Track[], index?: number, random: Random = Math.random,
): PlaybackQueue {
  let next = state
  if (tracks?.length) {
    const sameList = tracks.length === state.entries.length && tracks.every((item, i) => sameTrack(item, state.entries[i].track))
    if (!sameList) {
      let nextId = state.nextId
      next = { ...emptyPlaybackQueue(state.shuffle), manual: state.manual,
        entries: tracks.map(item => ({ id: String(nextId++), track: item })), nextId }
    }
  }
  const at = index !== undefined && next.entries[index] && sameTrack(next.entries[index].track, track)
    ? index : next.entries.findIndex(entry => sameTrack(entry.track, track))
  let entry = next.entries[at]
  if (!entry) {
    entry = { id: String(next.nextId), track }
    next = { ...next, entries: [...next.entries, entry], nextId: next.nextId + 1 }
  }
  const starting = !next.current
  const current = { entry: { ...entry, track }, mainId: entry.id, started: false }
  if (next.current?.entry.id === entry.id) {
    next = { ...next, current: { ...current, started: next.current.started }, future: [] }
  } else next = activate({ ...next, future: [] }, current)
  if (starting || !next.shuffle) {
    next = { ...next, upcoming: next.shuffle
      ? shuffled(next.entries.map(item => item.id).filter(id => id !== entry.id), random)
      : nextRound(next, random) }
  } else next = { ...next, upcoming: next.upcoming.filter(id => id !== entry.id) }
  return ensureUpcoming(next, random)
}

export function enqueueTrack(state: PlaybackQueue, track: Track, first: boolean): PlaybackQueue {
  const entry = { id: String(state.nextId), track }
  return { ...state, manual: first ? [entry, ...state.manual] : [...state.manual, entry], nextId: state.nextId + 1 }
}

export function playManualEntry(state: PlaybackQueue, index: number): PlaybackQueue {
  const entry = state.manual[index]
  if (!entry) return state
  return activate({ ...state, manual: state.manual.filter((_, i) => i !== index) },
    { entry, mainId: state.current?.mainId ?? null, started: false })
}

export function playFutureEntry(state: PlaybackQueue, index: number): PlaybackQueue {
  const visit = state.future[index]
  return visit ? activate({ ...state, future: state.future.slice(index + 1) }, visit) : state
}

export function nextQueueEntry(state: PlaybackQueue, random: Random = Math.random): PlaybackQueue {
  if (state.manual.length) return playManualEntry(state, 0)
  if (state.future.length) return playFutureEntry(state, 0)
  const ready = ensureUpcoming(state, random)
  const entry = ready.entries.find(item => item.id === ready.upcoming[0])
  if (!entry) return state
  return ensureUpcoming(activate({ ...ready, upcoming: ready.upcoming.slice(1) },
    { entry, mainId: entry.id, started: false }), random)
}

export function previousQueueEntry(state: PlaybackQueue): PlaybackQueue {
  const visit = state.past[state.past.length - 1]
  if (!visit) return state
  return { ...state, past: state.past.slice(0, -1), current: visit,
    future: state.current?.started ? [state.current, ...state.future] : state.future }
}

export function removeManualEntry(state: PlaybackQueue, index: number): PlaybackQueue {
  return { ...state, manual: state.manual.filter((_, i) => i !== index) }
}

/** 移除主列表条目同时清理历史引用；插播使用其前一位置继续，不打断插播。 */
export function removeQueueEntry(state: PlaybackQueue, index: number, random: Random = Math.random): PlaybackQueue {
  const entry = state.entries[index]
  if (!entry) return state
  const previousId = state.entries[index - 1]?.id ?? null
  const remap = (visit: PlaybackVisit): PlaybackVisit => visit.mainId === entry.id ? { ...visit, mainId: previousId } : visit
  const current = state.current?.entry.id === entry.id ? null : state.current ? remap(state.current) : null
  return ensureUpcoming({ ...state,
    entries: state.entries.filter((_, i) => i !== index), current,
    past: state.past.filter(visit => visit.entry.id !== entry.id).map(remap),
    future: state.future.filter(visit => visit.entry.id !== entry.id).map(remap),
    upcoming: state.upcoming.filter(id => id !== entry.id),
  }, random)
}

export interface UpcomingEntry { entry: QueueEntry; kind: 'future' | 'main'; index: number }
export function upcomingQueueEntries(state: PlaybackQueue): UpcomingEntry[] {
  const entries = new Map(state.entries.map((entry, index) => [entry.id, { entry, kind: 'main' as const, index }]))
  return [
    ...state.future.map((visit, index) => ({ entry: visit.entry, kind: 'future' as const, index })),
    ...state.upcoming.flatMap(id => entries.has(id) ? [entries.get(id)!] : []),
  ]
}

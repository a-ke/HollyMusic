import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
import { upcomingQueueEntries } from '@/lib/player-queue'
import { QueuePanel } from '@/components/player/QueuePanel'

vi.mock('@/components/shared/CoverImage', () => ({ CoverImage: () => null }))

const tracks = Array.from({ length: 12 }, (_, index) => toTrack({
  uid: `kw-${index}`,
  musicInfo: { name: `歌曲${index}`, singer: '歌手', source: 'kw', songmid: String(index),
    interval: '03:00', types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} },
}))
const extra = toTrack({ uid: 'kw-extra', musicInfo: { ...tracks[0].musicInfo, name: '插播歌曲', songmid: 'extra' } })
let root: Root
let container: HTMLDivElement

function scroller(): HTMLDivElement {
  return container.querySelector<HTMLDivElement>('[role="dialog"] .overflow-y-auto')!
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  usePlayerStore.setState({ queue: tracks, currentIndex: 6, currentTrack: tracks[6] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(open = false): Promise<void> {
  usePlayerStore.getState().setQueueOpen(open)
  await act(async () => root.render(<StrictMode><QueuePanel /></StrictMode>))
}

async function setOpen(open: boolean): Promise<void> {
  await act(async () => usePlayerStore.getState().setQueueOpen(open))
}

it.each([0, 6])('播放主列表第 %i 首时，打开面板均在顶部显示当前曲', async index => {
  usePlayerStore.setState({ currentIndex: index, currentTrack: tracks[index] })
  await mount(true)
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain(tracks[index].name)
  expect(scroller().firstElementChild?.querySelector('[aria-current="true"]')).not.toBeNull()
  expect(scroller().scrollTop).toBe(0)
})

it('关闭期间切歌后，重新打开定位新的当前歌曲', async () => {
  await mount()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await setOpen(true)
  expect(scroller().scrollTop).toBe(0)
  await setOpen(false)
  await act(async () => usePlayerStore.setState({ currentIndex: 4, currentTrack: tracks[4] }))
  await setOpen(true)
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain(tracks[4].name)
  expect(scroller().scrollTop).toBe(0)
})

it('播放插播歌曲时定位插播行，主队列冻结位置不标记为当前曲', async () => {
  await mount()
  await act(async () => usePlayerStore.setState({ isCurrentTempPlay: true, currentTrack: extra }))
  await setOpen(true)
  const current = container.querySelector('[aria-current="true"]')!
  expect(current.textContent).toContain(extra.name)
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  expect(current.parentElement?.textContent).toContain('正在播放 · 插播')
  expect(scroller().scrollTop).toBe(0)
})

it.each(['空队列', '没有当前歌曲'])('%s时打开面板不尝试定位歌曲', async state => {
  usePlayerStore.setState({ queue: state === '空队列' ? [] : tracks, currentIndex: -1, currentTrack: null })
  await mount(true)
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  expect(container.querySelector('[aria-current]')).toBeNull()
  expect(scroller().scrollTop).toBe(0)
})

it('手动滚动后切歌或更新队列不会抢回位置，再打开才重新定位', async () => {
  await mount(true)
  const scroll = scroller()
  await act(async () => {
    scroll.scrollTop = 91
    scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await act(async () => usePlayerStore.setState({ currentIndex: 8, currentTrack: tracks[8], queue: [...tracks, extra] }))
  expect(scroller()).toBe(scroll)
  expect(scroll.scrollTop).toBe(91)
  await setOpen(false)
  await setOpen(true)
  expect(scroller().scrollTop).toBe(0)
})

it('随机模式展示实际待播顺序，点击面板歌曲保持精确入队身份', async () => {
  usePlayerStore.getState().setPlaybackMode('random')
  await usePlayerStore.getState().playTrack(tracks[0], tracks)
  usePlayerStore.getState().markPlaybackStarted()
  await mount(true)
  const navigation = usePlayerStore.getState().navigation!
  const expected = upcomingQueueEntries(navigation)
  const rows = [...container.querySelectorAll('[aria-label="接下来播放"] .text-sm')]
  expect(rows.map(row => row.textContent)).toEqual(expected.map(item => item.entry.track.name))
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain(tracks[0].name)
  await act(async () => { container.querySelector('[aria-label="接下来播放"] button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(usePlayerStore.getState().navigation?.current?.entry.id).toBe(expected[0].entry.id)
})

it('待播列表优先显示回退后的前进歌曲，删除它不影响正在播放的歌曲', async () => {
  await usePlayerStore.getState().playTrack(tracks[0], tracks)
  usePlayerStore.getState().markPlaybackStarted()
  usePlayerStore.getState().next()
  usePlayerStore.getState().markPlaybackStarted()
  usePlayerStore.getState().previous()
  await mount(true)
  expect(container.querySelector('[aria-label="接下来播放"] .text-sm')?.textContent).toBe(tracks[1].name)
  await act(async () => { container.querySelector('[aria-label="接下来播放"] [aria-label="移除"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  expect(usePlayerStore.getState().navigation?.future).toEqual([])
  expect(usePlayerStore.getState().currentTrack?.uid).toBe(tracks[0].uid)
})

import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
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

  // jsdom 不排版：给歌曲行提供固定位置，并模拟滚动后的视口坐标。
  // 容器顶部 100px、高 400px，行高 56px、顶部内边距 8px。
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === scroller()) return new DOMRect(0, 100, 400, 400)
    const name = this.querySelector('.text-sm')?.textContent
    const index = tracks.findIndex(track => track.name === name)
    const top = name === extra.name ? 32 : 8 + index * 56
    return new DOMRect(0, 100 + top - (scroller()?.scrollTop ?? 0), 400, 56)
  })
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

it.each([
  { index: 0, expectedScroll: 0 },
  { index: 6, expectedScroll: 172 },
])('初次打开定位第 $index 首，首曲不产生负滚动值', async ({ index, expectedScroll }) => {
  usePlayerStore.setState({ currentIndex: index, currentTrack: tracks[index] })
  await mount(true)
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain(tracks[index].name)
  expect(scroller().scrollTop).toBe(expectedScroll)
})

it('关闭期间切歌后，重新打开定位新的当前歌曲', async () => {
  await mount()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await setOpen(true)
  expect(scroller().scrollTop).toBe(172)
  await setOpen(false)
  await act(async () => usePlayerStore.setState({ currentIndex: 4, currentTrack: tracks[4] }))
  await setOpen(true)
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain(tracks[4].name)
  expect(scroller().scrollTop).toBe(60)
})

it('播放插播歌曲时定位插播行，主队列冻结位置不标记为当前曲', async () => {
  await mount()
  await act(async () => usePlayerStore.setState({ isCurrentTempPlay: true, currentTrack: extra }))
  await setOpen(true)
  const current = container.querySelector('[aria-current="true"]')!
  expect(current.textContent).toContain(extra.name)
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.contexts).toContain(current)
  expect(scroller().scrollTop).toBe(0)
})

it.each(['空队列', '没有当前歌曲'])('%s时打开面板不尝试定位歌曲', async state => {
  usePlayerStore.setState({ queue: state === '空队列' ? [] : tracks, currentIndex: -1, currentTrack: null })
  await mount(true)
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  expect(container.querySelector('[aria-current]')).toBeNull()
  expect(scroller().scrollTop).toBe(0)
  expect(HTMLElement.prototype.getBoundingClientRect).not.toHaveBeenCalled()
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
  expect(scroller().scrollTop).toBe(284)
})

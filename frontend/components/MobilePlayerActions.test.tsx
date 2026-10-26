import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobilePlayerMenu } from '@/components/player/MobilePlayerMenu'
import { LyricsPanel } from '@/components/player/LyricsPanel'
import { QueuePanel } from '@/components/player/QueuePanel'
import { SongRow } from '@/components/shared/SongRow'
import { SongContextMenu } from '@/components/shared/SongContextMenu'
import { LyricsPanelContext } from '@/hooks/useLyricsPanel'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { starSong, unstarSong } from '@/lib/api/favorites'
import { toast } from '@/lib/toast'
import { toTrack } from '@/lib/types/player'

vi.mock('@/lib/api/favorites', () => ({ starSong: vi.fn(async () => ({})), unstarSong: vi.fn(async () => ({})), listFavorites: vi.fn(async () => ({ list: [], total: 0 })) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ download: vi.fn() }) }))
vi.mock('@/hooks/useLyrics', () => ({ useLyrics: () => ({ lines: [], activeIndex: -1, hasLyric: false, loading: false }) }))
vi.mock('@/components/shared/CoverImage', () => ({ CoverImage: () => null }))
vi.mock('@/components/player/AudioSpectrum', () => ({ AudioSpectrum: () => null }))
const track = toTrack({ uid: 'kw-touch', musicInfo: { name: '触屏测试', singer: '歌手', source: 'kw', songmid: 'touch', interval: '03:00', types: [], _types: {}, typeUrl: {} } })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } })
  useFavoritesStore.getState().reset()
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), currentTrack: track, queue: [track], currentIndex: 0 }, true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.clearAllMocks()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useFavoritesStore.getState().reset()
  useContextMenuStore.getState().dismiss()
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  vi.unstubAllGlobals()
})
async function tap(button: Element) {
  await act(async () => {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      button.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
    }
  })
}

it('打开歌曲菜单后立即点收藏：执行请求并收起，不受 350ms 背景保护限制', async () => {
  await act(async () => root.render(<><SongRow track={track} /><SongContextMenu /></>))
  await tap(container.querySelector('[aria-label="更多操作"]')!)
  const favorite = [...container.querySelectorAll('[role="menu"] button')].find(b => b.textContent === '收藏')!
  await tap(favorite)
  expect(starSong).toHaveBeenCalledWith(track.uid)
  expect(useFavoritesStore.getState().ids.has(track.uid)).toBe(true)
  expect(useContextMenuStore.getState().menu).toBeNull()
  expect(container.querySelector('[aria-label="取消收藏"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(toast.success).toHaveBeenCalledWith('已收藏')
})

it('播放设置中的收藏可点击，等待时禁用，成功后可取消收藏', async () => {
  let finish!: () => void
  vi.mocked(starSong).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ starred: true }) }))
  await act(async () => root.render(<MobilePlayerMenu />))
  await tap(container.querySelector('[aria-label="更多"]')!)
  expect(container.querySelector('dialog')?.open).toBe(true)
  await tap(container.querySelector('button[aria-pressed]')!)
  expect(container.querySelector('button[aria-busy="true"]')?.hasAttribute('disabled')).toBe(true)
  await act(async () => finish())
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toContain('取消收藏')
  await tap(container.querySelector('button[aria-pressed="true"]')!)
  expect(unstarSong).toHaveBeenCalledWith(track.uid)
  expect(useFavoritesStore.getState().ids.has(track.uid)).toBe(false)
})

it('收藏失败回滚并显示错误，可再次操作', async () => {
  vi.mocked(starSong).mockRejectedValueOnce(new Error('offline'))
  await act(async () => root.render(<MobilePlayerMenu />))
  await tap(container.querySelector('[aria-label="更多"]')!)
  await tap(container.querySelector('button[aria-pressed]')!)
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('收藏操作失败，请重试')
  expect(useFavoritesStore.getState().ids.has(track.uid)).toBe(false)
  expect(container.querySelector('button[aria-pressed]')?.hasAttribute('disabled')).toBe(false)
})

it('歌词页可直接收藏、切模式和打开队列，Escape 先关闭队列', async () => {
  const close = vi.fn()
  await act(async () => root.render(<LyricsPanelContext.Provider value={{ isOpen: true, open: vi.fn(), close, toggle: vi.fn() }}>
    <LyricsPanel audio={null} /><QueuePanel />
  </LyricsPanelContext.Provider>))
  await tap(container.querySelector('[aria-label="收藏"]')!)
  expect(starSong).toHaveBeenCalledWith(track.uid)
  await tap(container.querySelector('[aria-label="列表循环"]')!)
  expect(usePlayerStore.getState().playbackMode).toBe('loop')
  await tap(container.querySelector('[aria-label="队列"]')!)
  expect(container.querySelector('[aria-label="播放队列"]')).not.toBeNull()
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
  expect(usePlayerStore.getState().isQueueOpen).toBe(false)
  expect(close).not.toHaveBeenCalled()
})

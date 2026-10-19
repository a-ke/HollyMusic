import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SongContextMenu } from '@/components/shared/SongContextMenu'
import { CreatePlaylistDialog } from '../src/components/playlists/CreatePlaylistDialog'
import { useContextMenuStore } from '@/lib/store/context-menu-store'
import { toTrack } from '@/lib/types/player'

vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ download: vi.fn() }) }))
let root: Root
let container: HTMLDivElement
const track = toTrack({ uid: 'kw-1', musicInfo: { name: '歌曲', singer: '歌手', source: 'kw', songmid: '1',
  interval: '03:00', types: [], _types: {}, typeUrl: {},
} as Parameters<typeof toTrack>[0]['musicInfo'] })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useContextMenuStore.getState().dismiss()
  vi.unstubAllGlobals()
})
function event(target: Element, name: string) {
  target.dispatchEvent(new MouseEvent(name, { bubbles: true, button: 0 }))
}
function openMenu(mobile: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  useContextMenuStore.setState({ menu: { track, x: 0, y: 0, openedAt: 0 } })
}

it('实际歌单弹窗中输入框选取拖出不关闭，背景正常点击仍关闭', async () => {
  const close = vi.fn()
  await act(async () => root.render(<CreatePlaylistDialog onClose={close} onCreate={vi.fn(async () => {})} />))
  const mask = container.firstElementChild!
  await act(async () => {
    event(container.querySelector('input')!, 'pointerdown')
    event(mask, 'pointerup')
    event(mask, 'click')
  })
  expect(close).not.toHaveBeenCalled()
  await act(async () => { event(mask, 'pointerdown'); event(mask, 'pointerup'); event(mask, 'click') })
  expect(close).toHaveBeenCalledTimes(1)
})

it('手机歌曲菜单不在背景按下时提前关闭，从背景拖入内容也不关闭', async () => {
  openMenu(true)
  await act(async () => root.render(<SongContextMenu />))
  const mask = container.firstElementChild!
  const menu = container.querySelector('[role="menu"]')!
  await act(async () => { event(mask, 'pointerdown'); event(mask, 'mousedown') })
  expect(useContextMenuStore.getState().menu).not.toBeNull()
  await act(async () => { event(menu, 'pointerup'); event(mask, 'click') })
  expect(useContextMenuStore.getState().menu).not.toBeNull()
  await act(async () => { event(mask, 'pointerdown'); event(mask, 'pointerup'); event(mask, 'click') })
  expect(useContextMenuStore.getState().menu).toBeNull()
})

it('桌面歌曲菜单仍支持鼠标按下外部时关闭', async () => {
  openMenu(false)
  await act(async () => root.render(<SongContextMenu />))
  await act(async () => event(document.body, 'mousedown'))
  expect(useContextMenuStore.getState().menu).toBeNull()
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlaylistsPage } from '../src/routes/PlaylistsPage'
import { DiscoveryCollectionPage } from '../src/routes/DiscoveryCollectionPage'
import { useAuthStore } from '@/hooks/useAuth'

const api = vi.hoisted(() => ({ listFavoritePlaylists: vi.fn(), saveFavoritePlaylist: vi.fn(), removeFavoritePlaylist: vi.fn() }))
const discovery = vi.hoisted(() => ({ getRecommendedPlaylistDetail: vi.fn(), getToplistDetail: vi.fn() }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/favorite-playlists', () => api)
vi.mock('@/lib/api/discovery', () => discovery)
vi.mock('@/hooks/usePlaylists', () => ({ usePlaylists: () => ({ playlists: [], loading: false }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: toastError } }))
vi.mock('@/lib/store/player-store', () => ({ usePlayerStore: () => vi.fn() }))
vi.mock('@/components/shared/SongList', () => ({ SongList: () => <div>歌曲列表</div> }))
vi.mock('@@/components/playlists/ImportPlaylistDialog', () => ({ ImportPlaylistDialog: () => null }))

const playlist = { source: 'kg', playlistId: 'abc/123?x=1', name: '收藏时的名字', cover: '', author: '作者', songCount: 5, createdAt: '2026-10-20T00:00:00Z' }
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  useAuthStore.setState({ authenticated: true, username: 'alice', sessionRevision: 0 })
  api.listFavoritePlaylists.mockResolvedValue({ list: [playlist] })
  api.removeFavoritePlaylist.mockResolvedValue({ removed: true })
  discovery.getRecommendedPlaylistDetail.mockResolvedValue({ id: playlist.playlistId, name: '原平台最新名字', author: '作者', cover: '', description: '', tracks: [] })
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

async function mount(path = '/playlists?tab=favorites') {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/playlists" element={<PlaylistsPage />} />
        <Route path="/discover/playlists/:id" element={<DiscoveryCollectionPage kind="playlists" />} />
      </Routes>
    </MemoryRouter>,
  ))
}
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
}

it('收藏入口打开原平台最新详情，保留平台和完整 ID，并能返回收藏页', async () => {
  await mount()
  const link = container.querySelector('a')!
  expect(link.getAttribute('href')).toBe('/discover/playlists/abc%2F123%3Fx%3D1?source=kg')
  await click(link)
  expect(discovery.getRecommendedPlaylistDetail).toHaveBeenCalledWith('kg', playlist.playlistId)
  expect(container.textContent).toContain('原平台最新名字')
  const favoriteButton = container.querySelector('button[aria-pressed]')!
  expect(favoriteButton.getAttribute('aria-pressed')).toBe('true')
  await click(favoriteButton)
  expect(api.removeFavoritePlaylist).toHaveBeenCalledWith('kg', playlist.playlistId)
  expect(favoriteButton.textContent).toContain('收藏歌单')
  api.listFavoritePlaylists.mockResolvedValue({ list: [] })
  await click(container.querySelector('a')!)
  expect(container.textContent).toContain('还没有收藏歌单')
})

it('取消失败显示错误并保留卡片，重试成功后移除', async () => {
  await mount()
  api.removeFavoritePlaylist.mockRejectedValueOnce(new Error('取消失败'))
  await click(container.querySelector('button[aria-label="取消收藏：收藏时的名字"]')!)
  expect(toastError).toHaveBeenCalledWith('取消失败')
  expect(container.textContent).toContain('收藏时的名字')
  await click(container.querySelector('button[aria-label="取消收藏：收藏时的名字"]')!)
  expect(container.textContent).toContain('还没有收藏歌单')
})

it('原歌单失效仍可返回并取消收藏，支持重试详情', async () => {
  discovery.getRecommendedPlaylistDetail.mockRejectedValue(new Error('原歌单不存在'))
  await mount()
  await click(container.querySelector('a')!)
  expect(container.textContent).toContain('歌单暂时无法加载')
  await click(container.querySelector('button')!)
  expect(discovery.getRecommendedPlaylistDetail).toHaveBeenCalledTimes(2)
  await click(container.querySelector('a')!)
  expect(container.textContent).toContain('收藏时的名字')
  expect(api.removeFavoritePlaylist).not.toHaveBeenCalled()
})

it('从详情收藏时提交原平台引用与展示信息，重新打开显示已收藏', async () => {
  api.listFavoritePlaylists.mockResolvedValue({ list: [] })
  const saved = { ...playlist, source: 'wy', playlistId: '123', name: '原平台最新名字', songCount: 0 }
  api.saveFavoritePlaylist.mockResolvedValue(saved)
  await mount('/discover/playlists/123?source=wy')
  await click(container.querySelector('button[aria-pressed]')!)
  expect(api.saveFavoritePlaylist).toHaveBeenCalledWith({ source: 'wy', playlistId: '123', name: '原平台最新名字', cover: '', author: '作者', songCount: 0 })
  expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true')
  await act(async () => root.render(null))
  api.listFavoritePlaylists.mockResolvedValue({ list: [saved] })
  await mount('/discover/playlists/123?source=wy')
  expect(container.querySelector('button[aria-pressed]')?.textContent).toContain('已收藏')
})

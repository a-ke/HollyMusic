import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/hooks/useAuth'
import { useFavoritePlaylists } from '@/hooks/useFavoritePlaylists'
import type { FavoritePlaylist } from '@/lib/api/favorite-playlists'

const api = vi.hoisted(() => ({ listFavoritePlaylists: vi.fn(), saveFavoritePlaylist: vi.fn(), removeFavoritePlaylist: vi.fn() }))
vi.mock('@/lib/api/favorite-playlists', () => api)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const playlist: FavoritePlaylist = { source: 'wy', playlistId: '123', name: '音乐', cover: '', author: '', songCount: 1, createdAt: '2026-10-20T00:00:00Z' }
let root: Root
let result: ReturnType<typeof useFavoritePlaylists>
function Harness() { result = useFavoritePlaylists(); return null }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  useAuthStore.setState({ authenticated: true, username: 'alice', sessionRevision: 0 })
  api.listFavoritePlaylists.mockResolvedValue({ list: [] })
  api.saveFavoritePlaylist.mockResolvedValue(playlist)
  api.removeFavoritePlaylist.mockResolvedValue({ removed: true })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})
async function mount() { await act(async () => root.render(<Harness />)) }

it('保存失败保持原状态，成功后才能变为已收藏', async () => {
  await mount()
  api.saveFavoritePlaylist.mockRejectedValueOnce(new Error('保存失败'))
  await act(async () => { await expect(result.setFavorite(playlist, true)).rejects.toThrow('保存失败') })
  expect(result.playlists).toEqual([])
  expect(result.pending).toBe(false)
  await act(async () => { await result.setFavorite(playlist, true) })
  expect(result.playlists).toEqual([playlist])
})

it('重复点击只发一次请求，取消不会移除其他平台相同 ID', async () => {
  api.listFavoritePlaylists.mockResolvedValue({ list: [playlist, { ...playlist, source: 'tx' }] })
  await mount()
  const pending = deferred<{ removed: true }>()
  api.removeFavoritePlaylist.mockReturnValueOnce(pending.promise)
  await act(async () => {
    void result.setFavorite(playlist, false)
    void result.setFavorite(playlist, false)
  })
  expect(api.removeFavoritePlaylist).toHaveBeenCalledTimes(1)
  expect(result.pending).toBe(true)
  await act(async () => pending.resolve({ removed: true }))
  expect(result.playlists.map(item => item.source)).toEqual(['tx'])
})

it('取消失败保留收藏，支持重试', async () => {
  api.listFavoritePlaylists.mockResolvedValue({ list: [playlist] })
  await mount()
  api.removeFavoritePlaylist.mockRejectedValueOnce(new Error('网络错误'))
  await act(async () => { await expect(result.setFavorite(playlist, false)).rejects.toThrow('网络错误') })
  expect(result.playlists).toEqual([playlist])
  await act(async () => { await result.setFavorite(playlist, false) })
  expect(result.playlists).toEqual([])
})

it('加载失败提供错误和重试，未获取状态前禁止收藏操作', async () => {
  api.listFavoritePlaylists.mockRejectedValueOnce(new Error('加载失败'))
  await mount()
  expect(result.error).toBe('加载失败')
  await expect(result.setFavorite(playlist, true)).rejects.toThrow('收藏状态尚未加载')
  expect(api.saveFavoritePlaylist).not.toHaveBeenCalled()
  await act(async () => { await result.reload() })
  expect(result.error).toBeNull()
})

it('切换账号后，旧加载响应不能显示旧用户收藏', async () => {
  const old = deferred<{ list: FavoritePlaylist[] }>()
  api.listFavoritePlaylists.mockReturnValueOnce(old.promise)
  await mount()
  await act(async () => useAuthStore.setState({ username: 'bob' }))
  await act(async () => old.resolve({ list: [playlist] }))
  expect(result.playlists).toEqual([])
  expect(result.loading).toBe(false)
})

it('退出后旧收藏请求不能写回，再登录也不会保留旧账号收藏', async () => {
  await mount()
  const old = deferred<FavoritePlaylist>()
  api.saveFavoritePlaylist.mockReturnValueOnce(old.promise)
  await act(async () => { void result.setFavorite(playlist, true) })
  await act(async () => useAuthStore.setState({ authenticated: false, username: null }))
  await act(async () => old.resolve(playlist))
  expect(result.playlists).toEqual([])
  await act(async () => useAuthStore.setState({ authenticated: true, username: 'bob' }))
  expect(result.playlists).toEqual([])
  expect(result.pending).toBe(false)
})

it('同账号重新认证后丢弃旧请求，卸载后也不报告旧请求错误', async () => {
  await mount()
  const old = deferred<FavoritePlaylist>()
  api.saveFavoritePlaylist.mockReturnValueOnce(old.promise)
  let saving!: Promise<void>
  await act(async () => { saving = result.setFavorite(playlist, true) })
  await act(async () => useAuthStore.setState({ sessionRevision: 1 }))
  await act(async () => root.render(null))
  await act(async () => { old.reject(new Error('旧请求')); await saving })
  expect(result.playlists).toEqual([])
})

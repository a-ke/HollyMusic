import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DELETE, GET, POST } from './route'
import { AuthError, requireUser } from '@/lib/services/user-context'
import { listFavoritePlaylists, removeFavoritePlaylist, saveFavoritePlaylist } from '@/lib/services/favorite-playlist-service'

vi.mock('@/lib/services/user-context', () => ({
  requireUser: vi.fn(), AuthError: class extends Error {},
}))
vi.mock('@/lib/services/favorite-playlist-service', () => ({
  listFavoritePlaylists: vi.fn(), removeFavoritePlaylist: vi.fn(), saveFavoritePlaylist: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

const playlist = { source: 'wy', playlistId: '123', name: '收藏歌单', cover: 'https://example.com/cover.jpg', author: '作者', songCount: 30 }
const request = (body: unknown) => new NextRequest('http://localhost/api/playlists/favorites', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ id: 7, username: 'alice' })
  vi.mocked(listFavoritePlaylists).mockResolvedValue({ list: [] })
  vi.mocked(removeFavoritePlaylist).mockResolvedValue({ removed: true })
})

it.each(['wy', 'tx', 'kw', 'kg', 'mg'])('支持 %s，用户身份只取自会话', async source => {
  const response = await POST(request({ ...playlist, source, userId: 99 }))
  expect(response.status).toBe(200)
  expect(saveFavoritePlaylist).toHaveBeenCalledWith(7, { ...playlist, source })
})

it.each([null, [], {}, { source: 'unknown' }, { playlistId: {} }, { playlistId: ' ' },
  { name: ' ' }, { cover: 'javascript:alert(1)' }, { songCount: -1 }, { songCount: 0.5 }, { author: 3 },
])('非法请求不写数据库：%j', async invalid => {
  const body = invalid && !Array.isArray(invalid) && Object.keys(invalid).length ? { ...playlist, ...invalid } : invalid
  expect((await POST(request(body))).status).toBe(400)
  expect(saveFavoritePlaylist).not.toHaveBeenCalled()
})

it('列表只读取当前用户，取消需要平台与歌单 ID', async () => {
  expect((await GET(new NextRequest('http://localhost/api/playlists/favorites?userId=99'))).status).toBe(200)
  expect(listFavoritePlaylists).toHaveBeenCalledWith(7)
  expect((await DELETE(new NextRequest('http://localhost/api/playlists/favorites?source=wy&playlistId=123&userId=99'))).status).toBe(200)
  expect(removeFavoritePlaylist).toHaveBeenCalledWith(7, 'wy', '123')
  expect((await DELETE(new NextRequest('http://localhost/api/playlists/favorites?playlistId=123'))).status).toBe(400)
  expect(removeFavoritePlaylist).toHaveBeenCalledTimes(1)
})

it.each([GET, POST, DELETE])('未登录时拒绝访问', async handler => {
  vi.mocked(requireUser).mockRejectedValueOnce(new AuthError('未登录'))
  expect((await handler(request(playlist))).status).toBe(401)
  expect(saveFavoritePlaylist).not.toHaveBeenCalled()
  expect(removeFavoritePlaylist).not.toHaveBeenCalled()
  expect(listFavoritePlaylists).not.toHaveBeenCalled()
})

it('数据库故障返回失败，不伪装为收藏成功', async () => {
  vi.mocked(saveFavoritePlaylist).mockRejectedValueOnce(new Error('db unavailable'))
  const response = await POST(request(playlist))
  expect(response.status).toBe(500)
  expect((await response.json()).success).toBe(false)
})

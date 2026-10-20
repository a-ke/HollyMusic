import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AuthResult } from './auth'

const { resolveMusicInfoById, getPlaylistCoverForUser } = vi.hoisted(() => ({
  resolveMusicInfoById: vi.fn(),
  getPlaylistCoverForUser: vi.fn(),
}))
vi.mock('./db', () => ({ resolveMusicInfoById }))
vi.mock('./services/playlist-service', () => ({ getPlaylistCoverForUser }))
vi.mock('./services/lyrics', () => ({ fetchLyricForMusic: vi.fn() }))
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { handleCoverArtAsync } = await import('./subsonic-metadata')
const user: AuthResult = { verified: true, user: { id: 1, username: 'alice' } }
const musicInfo = { source: 'wy', songmid: '123', img: 'https://example.com/song.jpg' }
const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
const fetchImage = vi.fn()

function request(id: string, auth = user) {
  return handleCoverArtAsync(new NextRequest(`http://localhost/rest/getCoverArt.view?id=${encodeURIComponent(id)}`), auth)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchImage)
  fetchImage.mockImplementation(async () => new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } }))
  getPlaylistCoverForUser.mockResolvedValue({ coverArt: null, songId: 'wy-123', musicInfo })
  resolveMusicInfoById.mockResolvedValue(null)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Subsonic 歌单封面', () => {
  it.each(['pl-12', 'al-pl-12'])('%s 使用歌单封面路径，返回真实图片', async id => {
    const response = await request(id)
    expect(getPlaylistCoverForUser).toHaveBeenCalledWith(12, 'alice')
    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  })

  it('自定义封面失败后回退到首曲封面', async () => {
    getPlaylistCoverForUser.mockResolvedValue({ coverArt: 'https://example.com/playlist.jpg', songId: 'wy-123', musicInfo })
    fetchImage.mockResolvedValueOnce(new Response(null, { status: 404 }))
    const response = await request('pl-12')
    expect(fetchImage.mock.calls.map(([url]) => url)).toEqual(['https://example.com/playlist.jpg', 'https://example.com/song.jpg'])
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  })

  it('只记录歌曲 ID 的条目也可以取得封面', async () => {
    getPlaylistCoverForUser.mockResolvedValue({ coverArt: null, songId: 'wy-123', musicInfo: null })
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)
    const response = await request('pl-12')
    expect(resolveMusicInfoById).toHaveBeenCalledWith('wy-123')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  })

  it.each(['pl-0', 'pl-nope', 'al-pl-12oops'])('非法歌单封面 ID %s 不进入歌曲查询', async id => {
    await request(id)
    expect(getPlaylistCoverForUser).not.toHaveBeenCalled()
    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('无权访问的歌单不能通过 al- 前缀绕过权限检查', async () => {
    getPlaylistCoverForUser.mockResolvedValue(null)
    await request('al-pl-12')
    expect(getPlaylistCoverForUser).toHaveBeenCalledWith(12, 'alice')
    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('未登录的歌单请求不查询歌单或歌曲', async () => {
    await request('al-pl-12', { user: null, verified: false })
    expect(getPlaylistCoverForUser).not.toHaveBeenCalled()
    expect(resolveMusicInfoById).not.toHaveBeenCalled()
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('临时获取失败的占位图不缓存，下一次请求可恢复真实图片', async () => {
    fetchImage.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const fallback = await request('pl-12')
    expect(fallback.headers.get('Cache-Control')).toBe('no-store')
    const recovered = await request('pl-12')
    expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(imageBytes)
  })
})

describe('原有封面 ID 兼容性', () => {
  it.each(['wy-123', 'al-wy-123'])('%s 仍能获取歌曲封面', async id => {
    resolveMusicInfoById.mockResolvedValueOnce(musicInfo)
    const response = await request(id)
    expect(resolveMusicInfoById).toHaveBeenCalledWith('wy-123')
    expect(getPlaylistCoverForUser).not.toHaveBeenCalled()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  })
})

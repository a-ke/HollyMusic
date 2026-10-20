import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { AuthResult } from './auth'
import type { PrismaClient } from './generated/prisma'
import type { DiscoverySource } from './services/discovery-service'
import type { Song } from './types/music'

const { database, getDetail } = vi.hoisted(() => ({
  database: { client: null as PrismaClient | null },
  getDetail: vi.fn(),
}))
vi.mock('./generated/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('./generated/prisma')>()
  return { ...actual, PrismaClient: class { constructor() { return database.client! } } }
})
vi.mock('./services/discovery-service', async importOriginal => ({
  ...await importOriginal<typeof import('./services/discovery-service')>(),
  getRecommendedPlaylistDetail: getDetail,
}))
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

let directory: string
let handlers: typeof import('./subsonic-playlist')
let metadata: typeof import('./subsonic-metadata')
let favorites: typeof import('./services/favorite-playlist-service')
let alice: AuthResult
let bob: AuthResult
const track: Song = {
  uid: 'kg-ABCDEF1234', source: 'kg', songmid: '123', hash: 'ABCDEF1234',
  name: '歌曲 & 名称', singer: '歌手', albumName: '专辑', interval: '03:12',
  types: [{ type: 'flac', size: '25M' }], _types: {} as Song['_types'], typeUrl: {},
}
const detail = { id: 'remote-123', name: '最新歌单', author: '作者', cover: 'https://example.com/live.jpg', description: '', tracks: [track] }
const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-subsonic-favorites-'))
  const databasePath = path.join(directory, 'test.db')
  await writeFile(databasePath, '')
  const url = `file:${databasePath.replaceAll(path.sep, '/')}`
  await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
  ], { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('./generated/prisma')>('./generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  handlers = await import('./subsonic-playlist')
  metadata = await import('./subsonic-metadata')
  favorites = await import('./services/favorite-playlist-service')
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})
afterEach(() => vi.unstubAllGlobals())

beforeEach(async () => {
  vi.resetAllMocks()
  await database.client!.playlist.deleteMany()
  await database.client!.musicInfo.deleteMany()
  await database.client!.user.deleteMany()
  const a = await database.client!.user.create({ data: { username: 'alice' } })
  const b = await database.client!.user.create({ data: { username: 'bob' } })
  alice = { verified: true, user: { id: a.id, username: a.username } }
  bob = { verified: true, user: { id: b.id, username: b.username } }
  getDetail.mockResolvedValue(detail)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(imageBytes, { headers: { 'Content-Type': 'image/png' } })))
})

function request(method: string, params: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/rest/${method}.view?${new URLSearchParams({ f: 'json', ...params })}`)
}

async function favorite(auth = alice, source: DiscoverySource = 'wy') {
  await favorites.saveFavoritePlaylist(auth.user!.id, {
    source, playlistId: 'remote-123', name: '收藏 & 歌单', cover: 'https://example.com/snapshot.jpg', author: '作者', songCount: 99,
  })
  return (await favorites.listFavoritePlaylistRecords(auth.user!.id)).find(item => item.source === source)!
}

async function payload(response: Response) {
  return (await response.json())['subsonic-response']
}

it('列表合并本地歌单和五个平台收藏，忽略请求中的他人用户名，且不访问上游', async () => {
  const local = await database.client!.playlist.create({ data: { username: 'alice', name: '本地' } })
  await database.client!.playlist.create({ data: { username: 'bob', name: '私有' } })
  const publicList = await database.client!.playlist.create({ data: { username: 'bob', name: '公开', isPublic: true } })
  const shared = await database.client!.playlist.create({ data: { username: 'bob', name: '授权', allowedUsers: { create: { username: 'alice' } } } })
  const records = []
  for (const source of ['tx', 'wy', 'kw', 'kg', 'mg'] as const) records.push(await favorite(alice, source))
  await favorite(bob)
  const response = await handlers.handleGetPlaylists(request('getPlaylists', { username: 'bob' }), alice)
  const result = await payload(response)
  expect(result.playlists.playlist.map((item: { id: string }) => item.id).sort()).toEqual([
    String(local.id), String(publicList.id), String(shared.id), ...records.map(item => `fp-${item.id}`),
  ].sort())
  expect(result.playlists.playlist.find((item: { id: string }) => item.id === `fp-${records[0].id}`)).toMatchObject({
    name: '【QQ音乐】收藏 & 歌单', owner: 'alice', public: false, coverArt: `pl-fp-${records[0].id}`, songCount: 99,
  })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(getDetail).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('详情使用最新内容、存储 uid、歌曲喜爱状态和真实时长', async () => {
  const saved = await favorite(alice, 'kg')
  await database.client!.favorite.create({ data: { userId: alice.user!.id, itemId: track.uid, itemType: 'song', createdAt: new Date('2026-01-02T03:04:05Z') } })
  const result = await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id: `fp-${saved.id}` }), alice))
  expect(result.playlist).toMatchObject({ name: '【酷狗音乐】最新歌单', songCount: 1, duration: 192, coverArt: `pl-fp-${saved.id}` })
  expect(result.playlist.entry).toEqual([expect.objectContaining({
    id: track.uid, coverArt: track.uid, albumId: track.uid, parent: `fp-${saved.id}`,
    duration: 192, suffix: 'flac', size: 25 * 1024 * 1024, starred: '2026-01-02T03:04:05',
  })])
  expect(getDetail).toHaveBeenCalledWith('kg', 'remote-123')
  expect(await database.client!.playlistEntry.count()).toBe(0)
})

it('XML 正确转义平台标题和歌曲名称', async () => {
  const saved = await favorite()
  const list = await handlers.handleGetPlaylists(request('getPlaylists', { f: 'xml' }), alice)
  expect(await list.text()).toContain('收藏 &amp; 歌单')
  const response = await handlers.handleGetPlaylist(request('getPlaylist', { id: `fp-${saved.id}`, f: 'xml' }), alice)
  expect(await response.text()).toContain('title="歌曲 &amp; 名称"')
})

it('空歌单详情返回 entry 数组', async () => {
  const saved = await favorite()
  getDetail.mockResolvedValue({ ...detail, tracks: [] })
  const result = await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id: `fp-${saved.id}` }), alice))
  expect(result.playlist).toMatchObject({ entry: [], songCount: 0, duration: 0 })
})

it.each(['fp-0', 'fp--1', 'fp-1oops', 'fp-1.5', 'fp-9007199254740992'])('拒绝非法收藏 ID %s', async id => {
  expect((await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id }), alice))).error.code).toBe(70)
  expect(getDetail).not.toHaveBeenCalled()
})

it('其他账号无法读取或删除收藏，封面也不请求上游', async () => {
  const saved = await favorite()
  const id = `fp-${saved.id}`
  expect((await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id }), bob))).error.code).toBe(70)
  expect((await payload(await handlers.handleDeletePlaylist(request('deletePlaylist', { id }), bob))).error.code).toBe(70)
  const cover = await metadata.handleCoverArtAsync(request('getCoverArt', { id: `al-pl-${id}` }), bob)
  expect(cover.headers.get('Cache-Control')).toBe('no-store')
  expect(await favorites.getFavoritePlaylistById(alice.user!.id, saved.id)).not.toBeNull()
  expect(getDetail).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('即使允许匿名访问，未验证用户名也不能读写收藏', async () => {
  const saved = await favorite()
  const unverified = { ...alice, verified: false }
  const id = `fp-${saved.id}`
  expect((await payload(await handlers.handleGetPlaylists(request('getPlaylists'), unverified))).playlists.playlist).toEqual([])
  for (const response of [
    await handlers.handleGetPlaylist(request('getPlaylist', { id }), unverified),
    await handlers.handleDeletePlaylist(request('deletePlaylist', { id }), unverified),
    await handlers.handleUpdatePlaylist(request('updatePlaylist', { playlistId: id }), unverified),
    await handlers.handleCreatePlaylist(request('createPlaylist', { playlistId: id }), unverified),
  ]) expect((await payload(response)).error.code).toBe(40)
  await metadata.handleCoverArtAsync(request('getCoverArt', { id: `pl-${id}` }), unverified)
  expect(getDetail).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('重命名、替换和增删曲目均返回只读错误，不修改本地或平台收藏', async () => {
  const saved = await favorite()
  await database.client!.playlist.create({ data: { id: saved.id, username: 'alice', name: '同号本地歌单' } })
  const params = { playlistId: `fp-${saved.id}`, name: '修改', songIdToAdd: track.uid, songIndexToRemove: '0', public: 'true' }
  for (const response of [
    await handlers.handleCreatePlaylist(request('createPlaylist', params), alice),
    await handlers.handleUpdatePlaylist(request('updatePlaylist', params), alice),
  ]) expect((await payload(response)).error).toMatchObject({ code: 50, message: expect.stringContaining('read-only') })
  expect((await favorites.getFavoritePlaylistById(alice.user!.id, saved.id))?.name).toBe(saved.name)
  expect((await database.client!.playlist.findUnique({ where: { id: saved.id } }))?.name).toBe('同号本地歌单')
  expect(getDetail).not.toHaveBeenCalled()
})

it('删除只取消本人收藏，保留同号本地歌单、其他账号收藏以及歌曲数据', async () => {
  const saved = await favorite()
  const other = await favorite(bob)
  await database.client!.playlist.create({ data: { id: saved.id, username: 'alice', name: '本地' } })
  const db = await import('./db')
  await db.upsertMusicInfo(track)
  const result = await payload(await handlers.handleDeletePlaylist(request('deletePlaylist', { id: `fp-${saved.id}` }), alice))
  expect(result.status).toBe('ok')
  expect((await favorites.listFavoritePlaylists(alice.user!.id)).list).toEqual([])
  expect(await favorites.getFavoritePlaylistById(bob.user!.id, other.id)).not.toBeNull()
  expect(await database.client!.playlist.count()).toBe(1)
  expect(await db.resolveMusicInfoById(track.uid)).not.toBeNull()
  expect(getDetail).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['missing', 'error'])('上游 %s 时保留收藏，并返回可理解的错误', async mode => {
  const saved = await favorite()
  if (mode === 'missing') getDetail.mockResolvedValue(null)
  else getDetail.mockRejectedValue(new Error('upstream unavailable'))
  const result = await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id: `fp-${saved.id}` }), alice))
  expect(result.status).toBe('failed')
  expect(result.error.message).toContain('favorite retained')
  expect((await favorites.listFavoritePlaylists(alice.user!.id)).list).toHaveLength(1)
})

it.each(['pl-', 'al-pl-'])('%s 收藏封面优先使用快照，不拉取全歌单', async prefix => {
  const saved = await favorite()
  const response = await metadata.handleCoverArtAsync(request('getCoverArt', { id: `${prefix}fp-${saved.id}` }), alice)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  expect(response.headers.get('Cache-Control')).toBe('private, max-age=300')
  expect(fetch).toHaveBeenCalledWith(saved.cover, expect.anything())
  expect(getDetail).not.toHaveBeenCalled()
})

it('快照封面失效后取得实时封面，全部失败时占位图不缓存', async () => {
  const saved = await favorite()
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
  const response = await metadata.handleCoverArtAsync(request('getCoverArt', { id: `pl-fp-${saved.id}` }), alice)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  expect(fetch).toHaveBeenCalledWith(detail.cover, expect.anything())
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }))
  getDetail.mockResolvedValue(null)
  const failed = await metadata.handleCoverArtAsync(request('getCoverArt', { id: `pl-fp-${saved.id}` }), alice)
  expect(failed.headers.get('Cache-Control')).toBe('no-store')
})

it('没有歌单封面时使用第一首歌的封面', async () => {
  const saved = await favorite()
  await database.client!.favoritePlaylist.update({ where: { id: saved.id }, data: { cover: '' } })
  getDetail.mockResolvedValue({ ...detail, cover: '', tracks: [{ ...track, source: 'wy', img: 'https://example.com/song.jpg' }] })
  const response = await metadata.handleCoverArtAsync(request('getCoverArt', { id: `pl-fp-${saved.id}` }), alice)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
  expect(fetch).toHaveBeenCalledWith('https://example.com/song.jpg', expect.anything())
})

it('真实发现服务完成 checksum 入库与缓存，返回的歌曲 ID 可被 getSong 和播放查询解析', async () => {
  const saved = await favorite()
  const actual = await vi.importActual<typeof import('./services/discovery-service')>('./services/discovery-service')
  getDetail.mockImplementation(actual.getRecommendedPlaylistDetail)
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: 200, playlist: {
    name: '实时网易歌单', coverImgUrl: 'https://example.com/new.jpg',
    tracks: [{ id: 11, name: '真实入库', ar: [{ name: '歌手' }], al: { id: 22, name: '专辑' }, dt: 180000, h: { size: 8000000 } }],
  } }), { headers: { 'Content-Type': 'application/json' } }))
  for (let i = 0; i < 2; i++) {
    const result = await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id: `fp-${saved.id}` }), alice))
    expect(result.playlist.entry[0]).toMatchObject({ id: 'wy-11', duration: 180, bitRate: 320 })
  }
  expect(fetch).toHaveBeenCalledTimes(1)
  const db = await import('./db')
  expect(await db.resolveMusicInfoById('wy-11')).toMatchObject({ source: 'wy', name: '真实入库' })
  const { handleGetSongAsync } = await import('./subsonic-song')
  expect((await payload(await handleGetSongAsync(request('getSong', { id: 'wy-11' }), alice))).song.id).toBe('wy-11')
  expect(await database.client!.playlist.count()).toBe(0)
  expect(await database.client!.playlistEntry.count()).toBe(0)
})

it('本地歌单的创建、编辑和删除继续生效', async () => {
  const created = await payload(await handlers.handleCreatePlaylist(request('createPlaylist', { name: '本地' }), alice))
  const id = created.playlist.id
  expect((await payload(await handlers.handleUpdatePlaylist(request('updatePlaylist', { playlistId: id, name: '重命名' }), alice))).status).toBe('ok')
  expect((await payload(await handlers.handleGetPlaylist(request('getPlaylist', { id }), alice))).playlist.name).toBe('重命名')
  expect((await payload(await handlers.handleDeletePlaylist(request('deletePlaylist', { id }), alice))).status).toBe('ok')
  expect(await database.client!.playlist.count()).toBe(0)
})

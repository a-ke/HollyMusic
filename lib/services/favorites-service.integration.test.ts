import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma'
import type { MusicInfo } from '../types/music'

const database = vi.hoisted(() => ({ client: null as PrismaClient | null }))
vi.mock('../generated/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('../generated/prisma')>()
  return { ...actual, PrismaClient: class { constructor() { return database.client! } } }
})

let directory: string
let service: typeof import('./favorites-service')
let db: typeof import('../db')
let alice: number
let bob: number

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-favorites-search-'))
  const databasePath = path.join(directory, 'test.db')
  await writeFile(databasePath, '')
  const url = `file:${databasePath.replaceAll(path.sep, '/')}`
  await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
  ], { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('../generated/prisma')>('../generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  service = await import('./favorites-service')
  db = await import('../db')
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  await database.client!.user.deleteMany()
  await database.client!.musicInfo.deleteMany()
  alice = (await database.client!.user.create({ data: { username: 'alice' } })).id
  bob = (await database.client!.user.create({ data: { username: 'bob' } })).id
})

async function favorite(songmid: string, metadata: Partial<MusicInfo> = {}, userId = alice): Promise<string> {
  const musicInfo: MusicInfo = {
    source: 'kw', songmid, name: '晴天', singer: '周杰伦', albumName: '叶惠美', interval: '04:00',
    types: [], _types: {} as MusicInfo['_types'], typeUrl: {}, ...metadata,
  }
  await db.upsertMusicInfo(musicInfo)
  const songId = `${musicInfo.source}-${db.getStorageSongmidForMusicInfo(musicInfo)}`
  await service.starSong(userId, songId)
  return songId
}

it('按歌曲、歌手、专辑搜索，忽略首尾空白和英文大小写', async () => {
  const songId = await favorite('1', { name: '晴天 Sunny Day' })
  for (const query of ['晴天', '  SUNNY  ', '周杰伦', '叶惠美']) {
    const result = await service.listFavoriteSongs(alice, { query })
    expect(result.total).toBe(1)
    expect(result.list.map(song => song.songId)).toEqual([songId])
    expect(result.list[0].starredAt).toEqual(expect.any(String))
  }
})

it('先搜索全部收藏再分页，结果总数与分页一致且保持倒序', async () => {
  const older = await favorite('older', { name: '目标歌曲' })
  await database.client!.favorite.updateMany({ where: { userId: alice }, data: { createdAt: new Date('2020-01-01') } })
  // 让目标歌曲位于普通收藏列表的第二页之外。
  await database.client!.favorite.createMany({ data: Array.from({ length: 110 }, (_, index) => ({
    userId: alice, itemType: 'song', itemId: `kw-unrelated${index}`, source: 'kw',
  })) })
  const newer = await favorite('newer', { name: '目标歌曲二' })
  expect((await service.listFavoriteSongs(alice, { limit: 100 })).list.map(song => song.songId)).not.toContain(older)
  const first = await service.listFavoriteSongs(alice, { query: '目标', limit: 1 })
  const second = await service.listFavoriteSongs(alice, { query: '目标', limit: 1, offset: 1 })
  expect(first.total).toBe(2)
  expect(second.total).toBe(2)
  expect(first.list.map(song => song.songId)).toEqual([newer])
  expect(second.list.map(song => song.songId)).toEqual([older])
})

it('只搜索当前用户的歌曲收藏，取消收藏后结果实时移除', async () => {
  await favorite('bob-song', {}, bob)
  const ownId = await favorite('own-song')
  await database.client!.favorite.create({ data: { userId: alice, itemType: 'album', itemId: 'kw-bob-song', source: 'kw' } })
  expect((await service.listFavoriteSongs(alice, { query: '晴天' })).list.map(song => song.songId)).toEqual([ownId])
  await service.unstarSong(alice, ownId)
  expect(await service.listFavoriteSongs(alice, { query: '晴天' })).toEqual({ list: [], total: 0 })
})

it('兼容尚未回填检索列的旧收藏，损坏的 JSON 不使搜索报错', async () => {
  const legacyId = await favorite('legacy')
  await database.client!.musicInfo.updateMany({ data: { name: null, singer: null, albumName: null } })
  await favorite('broken')
  await database.client!.musicInfo.updateMany({ where: { songmid: 'broken' }, data: { data: '{invalid', name: null, singer: null, albumName: null } })
  for (const query of ['晴天', '周杰伦', '叶惠美']) {
    const result = await service.listFavoriteSongs(alice, { query })
    expect(result.total).toBe(1)
    expect(result.list.map(song => song.songId)).toEqual([legacyId])
  }
})

it('百分号、下划线和 SQL 片段按普通字符匹配', async () => {
  const special = await favorite('special', { name: '100%_Love' })
  await favorite('ordinary', { name: '普通歌曲' })
  for (const query of ['%', '_']) {
    const result = await service.listFavoriteSongs(alice, { query })
    expect(result.list.map(song => song.songId)).toEqual([special])
  }
  expect(await service.listFavoriteSongs(alice, { query: "' OR 1=1 --" })).toEqual({ list: [], total: 0 })
})

it('空白搜索词沿用普通收藏列表', async () => {
  await favorite('1')
  expect(await service.listFavoriteSongs(alice, { query: '   ' })).toEqual(await service.listFavoriteSongs(alice))
})

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma'
import type { FavoritePlaylistInput } from '../api/favorite-playlists'

const database = vi.hoisted(() => ({ client: null as PrismaClient | null }))
vi.mock('@/lib/generated/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('../generated/prisma')>()
  return { ...actual, PrismaClient: class { constructor() { return database.client! } } }
})

let directory: string
let service: typeof import('./favorite-playlist-service')
let alice: number
let bob: number
const playlist: FavoritePlaylistInput = {
  source: 'wy', playlistId: '123', name: '晚间音乐', cover: '', author: '作者', songCount: 12,
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'holly-favorite-playlist-'))
  const databasePath = path.join(directory, 'test.db')
  await writeFile(databasePath, '')
  const url = `file:${databasePath.replaceAll(path.sep, '/')}`
  // 实际部署所有迁移，验证现有库升级路径，而非直接 db push。
  await promisify(execFile)(process.execPath, [
    path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
  ], { env: { ...process.env, DATABASE_URL: url } })
  const actual = await vi.importActual<typeof import('../generated/prisma')>('../generated/prisma')
  database.client = new actual.PrismaClient({ datasourceUrl: url })
  service = await import('./favorite-playlist-service')
}, 30000)

afterAll(async () => {
  await database.client?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  await database.client!.user.deleteMany()
  alice = (await database.client!.user.create({ data: { username: 'alice' } })).id
  bob = (await database.client!.user.create({ data: { username: 'bob' } })).id
})

it('并发重复收藏只保存一个引用，刷新展示信息且不复制曲目', async () => {
  await Promise.all(Array.from({ length: 3 }, () => service.saveFavoritePlaylist(alice, playlist)))
  const first = (await service.listFavoritePlaylists(alice)).list[0]
  await service.saveFavoritePlaylist(alice, { ...playlist, name: '新标题', songCount: 15 })
  expect((await service.listFavoritePlaylists(alice)).list).toEqual([
    { ...playlist, name: '新标题', songCount: 15, createdAt: first.createdAt },
  ])
  expect(await database.client!.playlist.count()).toBe(0)
  expect(await database.client!.playlistEntry.count()).toBe(0)
  expect(await database.client!.musicInfo.count()).toBe(0)
})

it('相同 ID 的平台歌单和不同用户互不影响，重复取消保持幂等', async () => {
  await service.saveFavoritePlaylist(alice, playlist)
  await service.saveFavoritePlaylist(alice, { ...playlist, source: 'tx' })
  await service.saveFavoritePlaylist(bob, playlist)
  expect((await service.listFavoritePlaylists(bob)).list).toHaveLength(1)
  await service.removeFavoritePlaylist(alice, 'wy', '123')
  await service.removeFavoritePlaylist(alice, 'wy', '123')
  expect((await service.listFavoritePlaylists(alice)).list.map(item => item.source)).toEqual(['tx'])
  expect((await service.listFavoritePlaylists(bob)).list).toHaveLength(1)
})

it('按收藏时间倒序返回，删除用户后清除其收藏', async () => {
  await service.saveFavoritePlaylist(alice, playlist)
  await database.client!.favoritePlaylist.updateMany({ where: { userId: alice }, data: { createdAt: new Date('2020-01-01') } })
  await service.saveFavoritePlaylist(alice, { ...playlist, playlistId: '456' })
  expect((await service.listFavoritePlaylists(alice)).list.map(item => item.playlistId)).toEqual(['456', '123'])
  await database.client!.user.delete({ where: { id: alice } })
  expect(await database.client!.favoritePlaylist.count()).toBe(0)
})

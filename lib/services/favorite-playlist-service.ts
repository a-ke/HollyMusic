import { PrismaClient, type FavoritePlaylist as FavoritePlaylistRecord } from '@/lib/generated/prisma'
import type { FavoritePlaylist, FavoritePlaylistInput } from '@/lib/api/favorite-playlists'
import type { DiscoverySource } from '@/lib/services/discovery-service'

const prisma = new PrismaClient()

function toFavorite(row: {
  source: string; playlistId: string; name: string; cover: string
  author: string; songCount: number; createdAt: Date
}): FavoritePlaylist {
  return {
    source: row.source as DiscoverySource,
    playlistId: row.playlistId,
    name: row.name,
    cover: row.cover,
    author: row.author,
    songCount: row.songCount,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listFavoritePlaylists(userId: number): Promise<{ list: FavoritePlaylist[] }> {
  const rows = await listFavoritePlaylistRecords(userId)
  return { list: rows.map(toFavorite) }
}

/** 服务端保留收藏记录 ID，供协议层生成与本地歌单不冲突的标识。 */
export async function listFavoritePlaylistRecords(userId: number): Promise<FavoritePlaylistRecord[]> {
  return prisma.favoritePlaylist.findMany({
    where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

export async function getFavoritePlaylistById(userId: number, id: number): Promise<FavoritePlaylistRecord | null> {
  return prisma.favoritePlaylist.findFirst({ where: { id, userId } })
}

export async function removeFavoritePlaylistById(userId: number, id: number): Promise<boolean> {
  const result = await prisma.favoritePlaylist.deleteMany({ where: { id, userId } })
  return result.count > 0
}

/** 只保存引用和展示快照，不创建本地歌单或复制曲目。 */
export async function saveFavoritePlaylist(userId: number, playlist: FavoritePlaylistInput): Promise<FavoritePlaylist> {
  const { source, playlistId, name, cover, author, songCount } = playlist
  const row = await prisma.favoritePlaylist.upsert({
    where: { userId_source_playlistId: { userId, source, playlistId } },
    create: { userId, source, playlistId, name, cover, author, songCount },
    update: { name, cover, author, songCount },
  })
  return toFavorite(row)
}

export async function removeFavoritePlaylist(userId: number, source: DiscoverySource, playlistId: string): Promise<{ removed: true }> {
  await prisma.favoritePlaylist.deleteMany({ where: { userId, source, playlistId } })
  return { removed: true }
}

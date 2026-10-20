import { apiDelete, apiGet, apiPost } from './client'
import type { DiscoverySource } from '@/lib/services/discovery-service'

export interface FavoritePlaylistInput {
  source: DiscoverySource
  playlistId: string
  name: string
  cover: string
  author: string
  songCount: number
}

export interface FavoritePlaylist extends FavoritePlaylistInput {
  createdAt: string
}

export function listFavoritePlaylists(): Promise<{ list: FavoritePlaylist[] }> {
  return apiGet('playlists/favorites')
}

export function saveFavoritePlaylist(playlist: FavoritePlaylistInput): Promise<FavoritePlaylist> {
  return apiPost('playlists/favorites', playlist)
}

export function removeFavoritePlaylist(source: DiscoverySource, playlistId: string): Promise<{ removed: true }> {
  return apiDelete('playlists/favorites', { source, playlistId })
}

import type { QualityType } from '@/lib/types/music'
import { offlineAudioCacheName, offlineAudioCacheKey } from '@/lib/playback-protocol'

export function getOfflineAudioCacheName(username: string): string {
  return offlineAudioCacheName(username)
}

export function getOfflineAudioCacheKey(uid: string, quality: QualityType): string {
  return offlineAudioCacheKey(uid, quality, window.location.origin)
}

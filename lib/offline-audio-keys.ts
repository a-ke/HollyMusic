import type { QualityType } from '@/lib/types/music'

export function getOfflineAudioCacheName(username: string): string {
  return `holly-audio-v1:${encodeURIComponent(username)}`
}

export function getOfflineAudioCacheKey(uid: string, quality: QualityType): string {
  return new URL(`/__offline_audio/${encodeURIComponent(uid)}/${quality}`, window.location.origin).href
}

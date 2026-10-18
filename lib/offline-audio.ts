import { buildAudioUrl } from '@/lib/api/music'
import { createBrowserStorage } from '@/lib/browser-storage'
import { parseTrack } from '@/lib/player-storage'
import { VALID_QUALITIES } from '@/lib/quality-options'
import { logger } from '@/lib/logger'
import type { Track } from '@/lib/types/player'
import type { QualityType } from '@/lib/types/music'

export const OFFLINE_CHANGED = 'holly-offline-changed'
export const CACHE_MB = 1_000_000
export const OFFLINE_MIN_LIMIT_BYTES = 100 * CACHE_MB
export const OFFLINE_DEFAULT_LIMIT_BYTES = 500 * CACHE_MB
const PREFIX = 'holly-audio-v1:'

// 仅作为本机离线资料的入口，不作为服务端登录凭据。
export const offlineIdentity = createBrowserStorage<string>('holly-offline-user', value =>
  typeof value === 'string' && value.length > 0 ? value : null)

export interface OfflineTrack {
  track: Track
  quality: QualityType
  size: number
  usedAt: number
  key: string
}

export interface OfflineCleanupPlan {
  entries: OfflineTrack[]
  bytes: number
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= OFFLINE_MIN_LIMIT_BYTES
}

function limitStorage(username: string) {
  return createBrowserStorage<number>(`holly-offline-limit:${encodeURIComponent(username)}`, value => validLimit(value) ? value : null)
}

export function getOfflineCacheLimit(username: string): number {
  return limitStorage(username).read() ?? OFFLINE_DEFAULT_LIMIT_BYTES
}

/** 从最久未使用的音频开始释放空间；reserveBytes 是即将写入的完整歌曲大小。 */
export function planOfflineCleanup(entries: OfflineTrack[], limit: number, reserveBytes = 0): OfflineCleanupPlan {
  const oldestFirst = [...entries].sort((a, b) => a.usedAt - b.usedAt)
  let total = entries.reduce((sum, entry) => sum + entry.size, 0) + reserveBytes
  const removed: OfflineTrack[] = []
  for (const entry of oldestFirst) {
    if (total <= limit) break
    removed.push(entry)
    total -= entry.size
  }
  return { entries: removed, bytes: removed.reduce((sum, entry) => sum + entry.size, 0) }
}

/** 需要清理时先返回计划；确认后重新核对，避免删除用户尚未确认的新条目。 */
export async function setOfflineCacheLimit(username: string, limit: number, approvedKeys?: string[]): Promise<{ saved: boolean; cleanup: OfflineCleanupPlan }> {
  if (!validLimit(limit)) throw new Error('缓存总容量不能低于 100 MB，且必须是有效大小')
  return withCacheLock(async () => {
    const cleanup = planOfflineCleanup(await listOfflineTracks(username), limit)
    const approved = new Set(approvedKeys)
    if (cleanup.entries.length && (approved.size !== cleanup.entries.length || cleanup.entries.some(entry => !approved.has(entry.key)))) {
      return { saved: false, cleanup }
    }
    if (!limitStorage(username).write(limit)) throw new Error('无法保存设置，请检查浏览器存储权限')
    cancelOfflineDownloads()
    try {
      if (cleanup.entries.length) {
        const cache = await caches.open(cacheName(username))
        for (const entry of cleanup.entries) await cache.delete(entry.key)
      }
    } finally { changed() }
    return { saved: true, cleanup }
  })
}

export function isOfflineStorageAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'caches' in window
}
function cacheName(username: string): string { return PREFIX + encodeURIComponent(username) }
function audioKey(uid: string, quality: QualityType): string {
  return new URL(`/__offline_audio/${encodeURIComponent(uid)}/${quality}`, window.location.origin).href
}
function changed(): void { window.dispatchEvent(new Event(OFFLINE_CHANGED)) }
async function withCacheLock<T>(action: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('holly-offline-audio', action) : action()
}
function metadata(response: Response, key: string): OfflineTrack | null {
  try {
    const track = parseTrack(JSON.parse(decodeURIComponent(response.headers.get('x-holly-track') || '')))
    const quality = response.headers.get('x-holly-quality') as QualityType
    const size = Number(response.headers.get('content-length'))
    const usedAt = Number(response.headers.get('x-holly-used'))
    return track && VALID_QUALITIES.includes(quality) && size > 0 && Number.isFinite(usedAt)
      ? { track, quality, size, usedAt, key } : null
  } catch { return null }
}

export async function listOfflineTracks(username: string): Promise<OfflineTrack[]> {
  if (!isOfflineStorageAvailable()) return []
  const cache = await caches.open(cacheName(username))
  const result = await Promise.all((await cache.keys()).map(async request => {
    const response = await cache.match(request)
    return response ? metadata(response, request.url) : null
  }))
  return result.filter((item): item is OfflineTrack => item !== null).sort((a, b) => b.usedAt - a.usedAt)
}

// 同一页面串行下载，避免后台缓存争抢当前音频带宽。账号切换、清空时取消未完成任务。
let pending = Promise.resolve()
let generation = 0
const queued = new Map<string, number>()
const controllers = new Set<AbortController>()
export function cancelOfflineDownloads(): void {
  generation++
  controllers.forEach(controller => controller.abort())
  controllers.clear()
}

export function cachePlayedTrack(username: string, track: Track, quality: QualityType): Promise<void> {
  if (!isOfflineStorageAvailable() || !navigator.onLine) return Promise.resolve()
  const storedTrack = parseTrack(track)
  if (!storedTrack) return Promise.resolve()
  const key = audioKey(track.uid, quality)
  const job = cacheName(username) + key
  const epoch = generation
  // 同一代任务去重；已取消但尚未结束的任务不能挡住恢复联网后的重试。
  if (queued.get(job) === epoch) return pending
  queued.set(job, epoch)
  const task = async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5 * 60_000)
    controllers.add(controller)
    try {
      if (epoch !== generation) return
      const cache = await caches.open(cacheName(username))
      const existing = await cache.match(key)
      if (existing) {
        await withCacheLock(async () => {
          if (epoch !== generation || !await cache.match(key)) return
          const headers = new Headers(existing.headers)
          headers.set('x-holly-used', String(Date.now()))
          await cache.put(key, new Response(existing.body, { headers }))
        })
        return
      }
      // 不带 Range，只有 200 完整音频才入库；浏览器流缓冲不等于离线缓存。
      const response = await fetch(buildAudioUrl(track.uid, quality), { signal: controller.signal, cache: 'no-store' })
      const type = response.headers.get('content-type') || ''
      const length = Number(response.headers.get('content-length'))
      if (response.status !== 200 || !/^(audio\/|application\/octet-stream)/i.test(type)
        || !Number.isSafeInteger(length) || length <= 0 || length > getOfflineCacheLimit(username)) {
        await response.body?.cancel()
        return
      }
      const blob = await response.blob()
      if (blob.size !== length || epoch !== generation) return
      await withCacheLock(async () => {
        if (epoch !== generation) return
        // 下载期间设置可能已在其他标签页变更，提交前重新读取；超大单曲不清理已有缓存。
        const limit = getOfflineCacheLimit(username)
        if (blob.size > limit) return
        const entries = (await listOfflineTracks(username)).filter(entry => entry.key !== key)
        const cleanup = planOfflineCleanup(entries, limit, blob.size)
        if (epoch !== generation || controller.signal.aborted) return
        const headers = new Headers({ 'content-type': type, 'content-length': String(blob.size),
          'x-holly-track': encodeURIComponent(JSON.stringify(storedTrack)), 'x-holly-quality': quality,
          'x-holly-used': String(Date.now()) })
        let written = false
        try {
          // 先写入，配额/存储失败时保留全部旧歌曲，不通过预先删除来重试。
          await cache.put(key, new Response(blob, { headers }))
          written = true
          if (epoch !== generation || controller.signal.aborted) {
            await cache.delete(key)
            return
          }
          // 从此处开始提交淘汰：即使任务被取消，也保留新歌曲并完成清理。
          // 清空缓存等后续操作会等待同一把锁，不能在删掉旧歌曲后再回滚新歌曲。
          for (const entry of cleanup.entries) await cache.delete(entry.key)
        } finally {
          // 清理失败或取消后也要刷新，避免列表展示已被删除的条目。
          if (written) changed()
        }
      })
    } catch (error) {
      if (!controller.signal.aborted) logger.warn('[offline] 歌曲缓存失败，不影响在线播放', error)
    } finally {
      clearTimeout(timeout)
      controllers.delete(controller)
      if (queued.get(job) === epoch) queued.delete(job)
    }
  }
  pending = pending.then(task, task)
  return pending
}

/** 本地完整 Blob 支持浏览器原生 seek；调用方负责 revokeObjectURL。 */
export async function getOfflineAudio(username: string, uid: string, quality: QualityType, allowed: QualityType[]): Promise<{ url: string; quality: QualityType } | null> {
  const entries = (await listOfflineTracks(username)).filter(entry => entry.track.uid === uid && allowed.includes(entry.quality))
  const entry = entries.find(item => item.quality === quality) ?? entries[0]
  if (!entry) return null
  const cache = await caches.open(cacheName(username))
  const response = await cache.match(entry.key)
  if (!response) return null
  const blob = await response.blob()
  if (blob.size !== entry.size) { await cache.delete(entry.key); return null }
  const headers = new Headers(response.headers)
  headers.set('x-holly-used', String(Date.now()))
  await withCacheLock(async () => {
    if (await cache.match(entry.key)) await cache.put(entry.key, new Response(blob, { headers }))
  }).catch(() => {})
  return { url: URL.createObjectURL(blob), quality: entry.quality }
}

export async function deleteOfflineTrack(username: string, key: string): Promise<void> {
  cancelOfflineDownloads()
  if (!isOfflineStorageAvailable()) return
  await withCacheLock(async () => { await (await caches.open(cacheName(username))).delete(key) })
  changed()
}
export async function clearOfflineTracks(username: string): Promise<void> {
  cancelOfflineDownloads()
  if (!isOfflineStorageAvailable()) return
  await withCacheLock(async () => { await caches.delete(cacheName(username)) })
  changed()
}

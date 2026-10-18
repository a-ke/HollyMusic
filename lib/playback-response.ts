import { isCacheStorageAvailable } from '@/lib/browser-storage'
import { getOfflineAudioCacheName, getOfflineAudioCacheKey } from '@/lib/offline-audio-keys'
import { VALID_QUALITIES } from '@/lib/quality-options'
import type { QualityType } from '@/lib/types/music'

/** 播放响应通过专属 MessagePort 返回，不在不同页面或账号间广播音频。 */
export interface PlaybackResponseCapture {
  ready: Promise<boolean>
  response: Promise<Response | null>
  cancel: (preservePlayback?: boolean) => void
  cached: () => void
}

const captures = new Map<string, PlaybackResponseCapture>()
const keyFor = (username: string, url: string) => `${username}:${url}`

/** 完整下载通知只携带分块清单，按需逐块读取，避免把整首音频带回页面内存。 */
async function readStagedAudio(cacheKey: string, captureId: string, limit: number): Promise<Response | null> {
  const cache = await caches.open('holly-playback-data-v1')
  const response = await cache.match(cacheKey)
  if (!response) return null
  const manifest = await response.json() as { version: number; size: number; headers: Record<string, string>; chunks: Array<{ key: string; length: number }> }
  if (manifest.version !== 1 || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > limit
    || !Array.isArray(manifest.chunks) || manifest.headers?.['content-length'] !== String(manifest.size)) return null
  const base = cacheKey.slice(0, -'complete'.length)
  let total = 0
  for (const [index, chunk] of manifest.chunks.entries()) {
    if (chunk.key !== `${base}${index}` || !base.endsWith(`/${captureId}/`)
      || !Number.isSafeInteger(chunk.length) || chunk.length <= 0 || chunk.length > 256 * 1024) return null
    total += chunk.length
  }
  if (total !== manifest.size) return null
  let index = 0
  let cancelled = false
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index === manifest.chunks.length) { controller.close(); return }
        const chunk = manifest.chunks[index++]
        const part = await cache.match(chunk.key)
        if (!part || Number(part.headers.get('content-length')) !== chunk.length) throw new Error('缓存分块不可用')
        const bytes = new Uint8Array(await part.arrayBuffer())
        if (cancelled) return
        if (bytes.byteLength !== chunk.length) throw new Error('缓存分块不完整')
        controller.enqueue(bytes)
      } catch (error) { if (!cancelled) controller.error(error) }
    },
    cancel() { cancelled = true },
  }), { headers: manifest.headers })
}

export function getPlaybackResponse(username: string, url: string): Promise<Response | null> | undefined {
  return captures.get(keyFor(username, url))?.response
}

export function markPlaybackCached(username: string, url: string): void {
  captures.get(keyFor(username, url))?.cached()
}

export function cancelPlaybackResponses(): void {
  for (const capture of captures.values()) capture.cancel(true)
}

/** 必须等待 ready，再设置 audio.src；旧 SW 或不支持 SW 时回退原有下载方式。 */
export function preparePlaybackResponse(username: string, url: string, limit: number): PlaybackResponseCapture | null {
  if (!isCacheStorageAvailable() || typeof navigator === 'undefined') return null
  const worker = navigator.serviceWorker?.controller
  if (!worker || typeof MessageChannel === 'undefined' || !url.startsWith('/api/audio?')) return null
  const audioUrl = new URL(url, window.location.origin)
  const uid = audioUrl.searchParams.get('uid')
  const quality = audioUrl.searchParams.get('quality') as QualityType
  if (!uid || !VALID_QUALITIES.includes(quality)) return null
  const captureId = crypto.randomUUID()
  const key = keyFor(username, url)
  captures.get(key)?.cancel()
  const channel = new MessageChannel()
  let resolveReady!: (ready: boolean) => void
  let resolveAvailable!: () => void
  let stored = false
  let source: { cacheName: string; cacheKey: string } | { response: Response } | null = null
  const ready = new Promise<boolean>(resolve => { resolveReady = resolve })
  const available = new Promise<void>(resolve => { resolveAvailable = resolve })
  const clearTimers = () => {
    clearTimeout(handshakeTimeout)
    clearTimeout(downloadTimeout)
  }
  const capture: PlaybackResponseCapture = {
    ready,
    // 只保存磁盘指针及无数据的就绪 Promise；不长期持有完整 Response/Blob。
    get response() {
      return available.then(async () => {
        if (!source) return null
        if ('response' in source) return source.response.clone()
        if (source.cacheName === 'holly-playback-data-v1') return readStagedAudio(source.cacheKey, captureId, limit)
        return (await caches.open(source.cacheName)).match(source.cacheKey).then(value => value ?? null)
      }).catch(() => null)
    },
    cached: () => {
      stored = true
      source = { cacheName: getOfflineAudioCacheName(username), cacheKey: getOfflineAudioCacheKey(uid, quality) }
      resolveAvailable()
      clearTimers()
      channel.port1.postMessage({ type: 'cached' })
      try {
        navigator.serviceWorker?.controller?.postMessage({ type: 'holly-cached-audio', url: audioUrl.href, captureId })
      } catch { /* 持久缓存已完成，SW 更新期间的通知失败不影响播放。 */ }
    },
    cancel: (preservePlayback = false) => {
      // 完整下载结束后仍需保留端口，以便切歌时释放 SW 为后续 Range 保留的数据。
      channel.port1.postMessage({ type: preservePlayback ? 'cancel-cache' : 'cancel' })
      // 端口属于旧 SW 运行实例，因此也通知当前 controller。
      // 仅真正释放播放源时撤销持久登记；取消缓存写入仍保留后续 Range 的读取路径。
      try {
        navigator.serviceWorker?.controller?.postMessage({ type: 'holly-release-audio',
          url: audioUrl.href, captureId, preservePlayback })
      } catch { /* 页面离开或 controller 已失效时，缓存取消仍须正常完成。 */ }
      source = null
      resolveAvailable()
      resolveReady(false)
      clearTimers()
      if (!preservePlayback) channel.port1.close()
      if (captures.get(key) === capture) captures.delete(key)
    },
  }
  const handshakeTimeout = setTimeout(capture.cancel, 300)
  // 缓存到期只能停止落盘，不能释放 Audio 正在读取的共享下载。
  const downloadTimeout = setTimeout(() => capture.cancel(true), 5 * 60_000)
  channel.port1.onmessage = event => {
    const data = event.data
    if (data?.type === 'ready') {
      clearTimeout(handshakeTimeout)
      resolveReady(true)
    } else if (data?.type === 'complete' && !stored) {
      if (data.cacheName === 'holly-playback-data-v1' && typeof data.cacheKey === 'string'
        && new URL(data.cacheKey, audioUrl).origin === audioUrl.origin
        && new URL(data.cacheKey, audioUrl).pathname.endsWith(`/${captureId}/complete`)) {
        source = { cacheName: data.cacheName, cacheKey: data.cacheKey }
      } else if (data.blob instanceof Blob && data.blob.size <= 8 * 1024 * 1024) {
        // 与旧 SW 的短暂兼容；现代协议不传完整 Blob。
        source = { response: new Response(data.blob, { headers: data.headers }) }
      }
      resolveAvailable()
      clearTimers()
    } else if (data?.type === 'unavailable' && !stored) {
      source = null
      resolveAvailable()
      resolveReady(false)
      clearTimers()
    }
  }
  channel.port1.onmessageerror = () => capture.cancel()
  captures.set(key, capture)
  try {
    worker.postMessage({ type: 'holly-capture-audio', url: audioUrl.href, limit, captureId,
      cacheName: getOfflineAudioCacheName(username), cacheKey: getOfflineAudioCacheKey(uid, quality) }, [channel.port2])
  } catch {
    capture.cancel()
    return null
  }
  return capture
}

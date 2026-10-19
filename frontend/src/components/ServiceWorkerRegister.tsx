import { useEffect } from 'react'
import { logger } from '@/lib/logger'
import { isCacheStorageAvailable } from '@/lib/browser-storage'
import { registerPwaInstall } from '@/hooks/usePwaInstall'
import { PLAYBACK_MESSAGE, isPlaybackDiagnostic, type PlaybackWorkerCommand } from '@/lib/playback-protocol'

/**
 * Service Worker 注册（Vite SPA 版）。
 * 同 Next.js 版逻辑，仅去掉 'use client' 指令。
 */
export function ServiceWorkerRegister() {
  useEffect(() => registerPwaInstall(), [])

  useEffect(() => {
    if (!isCacheStorageAvailable()) return
    if (!('serviceWorker' in navigator)) return

    const serviceWorker = navigator.serviceWorker
    const onDiagnostic = (event: MessageEvent) => {
      const data = event.data
      if (!event.source || event.source !== serviceWorker.controller || !isPlaybackDiagnostic(data)) return
      logger.warn(`[SW] ${data.operation.slice(0, 80)}`, { name: data.name.slice(0, 80), message: data.message.slice(0, 500) })
    }
    serviceWorker.addEventListener('message', onDiagnostic)

    const register = () => {
      navigator.serviceWorker
        .register(process.env.NODE_ENV === 'development' ? '/sw.js?mode=development' : '/sw.js', { scope: '/' })
        .then(registration => registration.active?.postMessage({ type: PLAYBACK_MESSAGE.PRUNE } satisfies PlaybackWorkerCommand))
        .catch((err) => {
          logger.warn('[SW] 注册失败:', err)
        })
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register)
    }
    return () => {
      window.removeEventListener('load', register)
      serviceWorker.removeEventListener('message', onDiagnostic)
    }
  }, [])

  return null
}

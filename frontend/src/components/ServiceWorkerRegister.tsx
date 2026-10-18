import { useEffect } from 'react'
import { logger } from '@/lib/logger'
import { isCacheStorageAvailable } from '@/lib/browser-storage'
import { registerPwaInstall } from '@/hooks/usePwaInstall'

/**
 * Service Worker 注册（Vite SPA 版）。
 * 同 Next.js 版逻辑，仅去掉 'use client' 指令。
 */
export function ServiceWorkerRegister() {
  useEffect(() => registerPwaInstall(), [])

  useEffect(() => {
    if (!isCacheStorageAvailable()) return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register(process.env.NODE_ENV === 'development' ? '/sw.js?mode=development' : '/sw.js', { scope: '/' })
        .then(registration => registration.active?.postMessage({ type: 'holly-prune-audio' }))
        .catch((err) => {
          logger.warn('[SW] 注册失败:', err)
        })
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register)
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}

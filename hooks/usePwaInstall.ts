import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface PwaInstallState {
  canInstall: boolean
  installing: boolean
  install: () => Promise<void>
}

let deferredPrompt: InstallPromptEvent | null = null
let installed = false
let listenerGeneration = 0

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** 安装事件在应用入口捕获，桌面侧栏和移动端抽屉共享同一个一次性提示。 */
export const usePwaInstall = create<PwaInstallState>((set, get) => ({
  canInstall: false,
  installing: false,
  install: async () => {
    if (!deferredPrompt || get().installing || installed || isStandalone()) return
    const prompt = deferredPrompt
    const generation = listenerGeneration
    deferredPrompt = null
    set({ canInstall: false, installing: true })
    try {
      // 在用户点击的同一调用栈调用 prompt，且每个事件只能消费一次。
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (generation === listenerGeneration && choice.outcome === 'accepted') {
        installed = true
        deferredPrompt = null
      }
    } catch (error) {
      if (generation === listenerGeneration) {
        logger.warn('[PWA] 无法打开安装提示', error)
        toast.error('无法打开安装提示，请稍后重试')
      }
    } finally {
      if (generation === listenerGeneration) {
        set({ installing: false, canInstall: !!deferredPrompt && !installed && !isStandalone() })
      }
    }
  },
}))

export function registerPwaInstall(): () => void {
  const generation = ++listenerGeneration
  deferredPrompt = null
  installed = isStandalone()
  usePwaInstall.setState({ canInstall: false, installing: false })
  const beforeInstall = (event: Event) => {
    if (installed || isStandalone() || typeof (event as InstallPromptEvent).prompt !== 'function') return
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
    usePwaInstall.setState({ canInstall: !usePwaInstall.getState().installing })
  }
  const appInstalled = () => {
    installed = true
    deferredPrompt = null
    usePwaInstall.setState({ canInstall: false })
  }
  window.addEventListener('beforeinstallprompt', beforeInstall)
  window.addEventListener('appinstalled', appInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', beforeInstall)
    window.removeEventListener('appinstalled', appInstalled)
    if (generation === listenerGeneration) {
      listenerGeneration++
      deferredPrompt = null
      installed = false
      usePwaInstall.setState({ canInstall: false, installing: false })
    }
  }
}

import { useEffect } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { logger } from '@/lib/logger'

/** 与播放引擎一起挂载一次；常亮只用于前台真实播放，不能阻止手动锁屏。 */
export function useScreenWakeLock(audio: HTMLAudioElement | null): void {
  const enabled = usePlayerStore(s => s.keepScreenAwake)
  const isPlaying = usePlayerStore(s => s.isPlaying)

  useEffect(() => {
    const setStatus = (wakeLockStatus: ReturnType<typeof usePlayerStore.getState>['wakeLockStatus']) => {
      usePlayerStore.setState({ wakeLockStatus })
    }
    if (!window.isSecureContext || !navigator.wakeLock?.request) {
      setStatus('unsupported')
      return
    }
    setStatus('idle')
    if (!enabled || !audio || !isPlaying) return

    let disposed = false
    let pageActive = true
    let pending = false
    let generation = 0
    let lock: WakeLockSentinel | null = null
    const eligible = () => !disposed && pageActive && document.visibilityState === 'visible' && !audio.paused && !audio.ended
    const release = () => {
      generation++
      const current = lock
      lock = null
      if (current && !current.released) void current.release().catch(error => logger.warn('[wake-lock] release failed', error))
    }
    const acquire = async () => {
      if (!eligible() || lock || pending) return
      pending = true
      const attempt = generation
      try {
        const acquired = await navigator.wakeLock.request('screen')
        // 请求返回时可能已暂停、切到后台或组件重建，不能泄漏旧请求的锁。
        if (attempt !== generation || !eligible()) {
          await acquired.release()
          return
        }
        lock = acquired.released ? null : acquired
        setStatus(acquired.released ? 'released' : 'active')
        acquired.addEventListener('release', () => {
          if (lock !== acquired) return
          lock = null
          if (!disposed) setStatus('released')
          // 系统可因低电量或用户锁屏释放；不循环抢锁。
        }, { once: true })
      } catch (error) {
        if (attempt === generation && eligible()) {
          setStatus('error')
          logger.warn('[wake-lock] request denied', error)
        }
      } finally {
        pending = false
        if (attempt !== generation && eligible()) void acquire()
      }
    }
    const sync = () => {
      if (eligible()) void acquire()
      else { release(); setStatus('idle') }
    }
    const onPageHide = () => { pageActive = false; release(); setStatus('idle') }
    const onPageShow = () => { pageActive = true; sync() }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('pagehide', onPageHide)
    for (const event of ['playing', 'pause', 'ended', 'emptied']) audio.addEventListener(event, sync)
    sync()
    return () => {
      disposed = true
      release()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('pagehide', onPageHide)
      for (const event of ['playing', 'pause', 'ended', 'emptied']) audio.removeEventListener(event, sync)
    }
  }, [audio, enabled, isPlaying])
}

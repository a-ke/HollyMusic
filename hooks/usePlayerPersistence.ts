import { useEffect } from 'react'
import { useAuthStore } from '@/hooks/useAuth'
import { startPlayerSession, syncPlayerPreferences } from '@/lib/player-persistence'
import { usePlayerStore } from '@/lib/store/player-store'

/** 必须在登录确认后恢复，并先于退出登录的 clearQueue effect 注册清理。 */
export function usePlayerPersistence(): boolean {
  const username = useAuthStore(s => s.authenticated ? s.username : s.offlineUsername)
  const restoredUsername = usePlayerStore(s => s.restoredForUsername)
  useEffect(syncPlayerPreferences, [])
  useEffect(() => {
    if (username) return startPlayerSession(username)
  }, [username])
  return !!username && restoredUsername === username
}

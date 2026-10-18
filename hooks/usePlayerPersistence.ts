import { useEffect } from 'react'
import { useAuthStore } from '@/hooks/useAuth'
import { startPlayerSession, syncPlayerPreferences } from '@/lib/player-persistence'

/** 必须在登录确认后恢复，并先于退出登录的 clearQueue effect 注册清理。 */
export function usePlayerPersistence(): void {
  const username = useAuthStore(s => s.authenticated ? s.username : s.offlineUsername)
  useEffect(syncPlayerPreferences, [])
  useEffect(() => {
    if (username) return startPlayerSession(username)
  }, [username])
}

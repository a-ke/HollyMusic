/**
 * 鉴权状态（zustand）
 * 启动时通过 getMe 获取会话；提供 login / logout。
 * authenticated 为 null 表示尚未加载完成（用于路由守卫区分"加载中"与"未登录"）。
 *
 * 已登录时启动心跳定时器（每 2 分钟上报一次，用于在线状态推断），登出/未登录时停止。
 * 心跳若返回 401（会话被服务端失效，如他处改密码），自动清空本地登录态强制下线。
 * // ponytail: 后台 tab 会节流 setInterval（~1分钟），TTL 5 分钟有容错。如需更精准可加 visibilitychange 即时上报。
 */

import { create } from 'zustand'
import { getMe, login as apiLogin, logout as apiLogout, heartbeat, changePassword as apiChangePassword, setup as apiSetup } from '@/lib/api/auth'
import { offlineIdentity, cancelOfflineDownloads } from '@/lib/offline-audio'

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let authRequestId = 0

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    heartbeat()
      .then((result) => {
        if (result === 'unauthorized') {
          // 服务端会话已失效（如该账号在别处改了密码），本地强制下线并停止心跳
          stopHeartbeat()
          offlineIdentity.remove()
          cancelOfflineDownloads()
          useAuthStore.setState({ authenticated: false, username: null, offlineUsername: null, mustChangePassword: false })
        }
      })
      .catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

interface AuthStore {
  /** 会话校验完成的版本；同账号重新认证也会变化。仅保存在内存。 */
  sessionRevision: number
  /** 仅能读取本机歌曲，不授予服务端会话权限。 */
  offlineUsername: string | null
  authenticated: boolean | null
  username: string | null
  /** 是否需要强制修改密码（首次登录/管理员重置后为 true） */
  mustChangePassword: boolean
  loading: boolean
  setupRequired: boolean | null
  setupRecoveryRequired: boolean
  setupTokenRequired: boolean
  error: string | null
  init: () => Promise<void>
  setup: (password: string, confirmPassword: string, setupToken: string) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** 自助改密，成功后清除 mustChangePassword */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  sessionRevision: 0,
  offlineUsername: null,
  authenticated: null,
  username: null,
  mustChangePassword: false,
  loading: false,
  setupRequired: null,
  setupRecoveryRequired: false,
  setupTokenRequired: false,
  error: null,

  init: async () => {
    const requestId = ++authRequestId
    set({ loading: true, error: null })
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TypeError('设备已离线')
      const me = await getMe()
      if (requestId !== authRequestId) return
      cancelOfflineDownloads()
      if (me.authenticated && me.username && !me.mustChangePassword) offlineIdentity.write(me.username)
      else offlineIdentity.remove()
      set(state => ({ authenticated: me.authenticated, username: me.username, mustChangePassword: me.mustChangePassword,
        offlineUsername: null,
        setupRequired: me.setupRequired, setupRecoveryRequired: me.setupRecoveryRequired,
        setupTokenRequired: me.setupTokenRequired, loading: false, error: null, sessionRevision: state.sessionRevision + 1 }))
      if (me.authenticated) startHeartbeat()
      else stopHeartbeat()
    } catch (error) {
      if (requestId !== authRequestId) return
      stopHeartbeat()
      cancelOfflineDownloads()
      if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403)) {
        offlineIdentity.remove()
        set({ authenticated: false, username: null, offlineUsername: null, loading: false, error: null })
        return
      }
      const offlineUsername = offlineIdentity.read()
      set({ authenticated: null, username: null, mustChangePassword: false, setupRequired: null,
        offlineUsername, loading: false, error: offlineUsername ? null : error instanceof Error ? error.message : '暂时无法连接服务' })
    }
  },

  setup: async (password, confirmation, token) => {
    ++authRequestId
    try {
      await apiSetup(password, confirmation, token)
      offlineIdentity.write('admin')
      set({ authenticated: true, username: 'admin', mustChangePassword: false,
        offlineUsername: null,
        setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false, error: null })
      startHeartbeat()
    } catch (error) {
      if ((error as { status?: number }).status === 409) await useAuthStore.getState().init()
      throw error
    }
  },

  login: async (username, password) => {
    ++authRequestId
    const res = await apiLogin(username, password)
    cancelOfflineDownloads()
    if (!res.mustChangePassword) offlineIdentity.write(res.username)
    else offlineIdentity.remove()
    set({ authenticated: true, username: res.username, offlineUsername: null, mustChangePassword: res.mustChangePassword, error: null })
    startHeartbeat()
  },

  logout: async () => {
    ++authRequestId
    stopHeartbeat()
    await apiLogout()
    offlineIdentity.remove()
    cancelOfflineDownloads()
    set({ authenticated: false, username: null, offlineUsername: null, mustChangePassword: false })
  },

  changePassword: async (currentPassword, newPassword) => {
    await apiChangePassword(currentPassword, newPassword)
    const username = useAuthStore.getState().username
    if (username) offlineIdentity.write(username)
    set({ mustChangePassword: false })
  },
}))

export const useAuth = useAuthStore

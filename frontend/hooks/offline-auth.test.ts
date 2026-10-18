import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/hooks/useAuth'
import { offlineIdentity } from '@/lib/offline-audio'
import * as offlineAudio from '@/lib/offline-audio'
import { getMe, logout } from '@/lib/api/auth'

vi.mock('@/lib/api/auth', () => ({
  getMe: vi.fn(), logout: vi.fn(async () => {}), heartbeat: vi.fn(async () => 'ok'),
  login: vi.fn(), setup: vi.fn(), changePassword: vi.fn(),
}))
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('断网冷启动只开放本机歌曲，不能伪造已登录会话', async () => {
  offlineIdentity.write('alice')
  vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'))
  await useAuthStore.getState().init()
  expect(useAuthStore.getState()).toMatchObject({ authenticated: null, username: null, offlineUsername: 'alice', error: null })
})

it('首次访问且无本地身份时保留连接失败页面', async () => {
  vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'))
  await useAuthStore.getState().init()
  expect(useAuthStore.getState().offlineUsername).toBeNull()
  expect(useAuthStore.getState().error).toBeTruthy()
})

it.each([401, 403])('收到明确的 %s 不进入离线身份', async status => {
  offlineIdentity.write('alice')
  vi.mocked(getMe).mockRejectedValue(Object.assign(new Error('unauthorized'), { status }))
  await useAuthStore.getState().init()
  expect(useAuthStore.getState()).toMatchObject({ authenticated: false, offlineUsername: null })
  expect(offlineIdentity.read()).toBeNull()
})

it('联网会话过期后撤销离线入口，防止下次断网恢复旧身份', async () => {
  offlineIdentity.write('alice')
  vi.mocked(getMe).mockResolvedValue({ authenticated: false, username: null, mustChangePassword: false,
    setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  await useAuthStore.getState().init()
  expect(offlineIdentity.read()).toBeNull()
  expect(useAuthStore.getState().offlineUsername).toBeNull()
})

it('主动登出后移除离线入口', async () => {
  offlineIdentity.write('alice')
  await useAuthStore.getState().logout()
  expect(logout).toHaveBeenCalled()
  expect(offlineIdentity.read()).toBeNull()
})

it('联网重新校验后恢复在线身份', async () => {
  useAuthStore.setState({ offlineUsername: 'alice' })
  vi.mocked(getMe).mockResolvedValue({ authenticated: true, username: 'alice', mustChangePassword: false,
    setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  await useAuthStore.getState().init()
  expect(useAuthStore.getState()).toMatchObject({ authenticated: true, username: 'alice', offlineUsername: null })
})

it('同账号重复认证成功也更新版本，失败时不触发成功版本', async () => {
  vi.mocked(getMe).mockResolvedValue({ authenticated: true, username: 'alice', mustChangePassword: false,
    setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  await useAuthStore.getState().init()
  const revision = useAuthStore.getState().sessionRevision
  await useAuthStore.getState().init()
  expect(useAuthStore.getState().sessionRevision).toBe(revision + 1)
  vi.mocked(getMe).mockRejectedValue(new TypeError('offline'))
  await useAuthStore.getState().init()
  expect(useAuthStore.getState().sessionRevision).toBe(revision + 1)
})

it.each(['same-account', 'different-account', 'expired', 'must-change-password'])('重新认证 %s 时按身份决定是否取消当前下载', async scenario => {
  useAuthStore.setState({ authenticated: true, username: 'alice', mustChangePassword: false })
  const cancel = vi.spyOn(offlineAudio, 'cancelOfflineDownloads')
  vi.mocked(getMe).mockResolvedValue({ authenticated: scenario !== 'expired',
    username: scenario === 'expired' ? null : scenario === 'different-account' ? 'bob' : 'alice',
    mustChangePassword: scenario === 'must-change-password',
    setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false })
  await useAuthStore.getState().init()
  expect(cancel).toHaveBeenCalledTimes(scenario === 'same-account' ? 0 : 1)
})

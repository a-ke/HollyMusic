import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/hooks/useAuth'
import { offlineIdentity } from '@/lib/offline-audio'
import * as offlineAudio from '@/lib/offline-audio'
import { getMe, login, logout, setup, type MeResponse } from '@/lib/api/auth'

vi.mock('@/lib/api/auth', () => ({
  getMe: vi.fn(), logout: vi.fn(async () => {}), heartbeat: vi.fn(async () => 'ok'),
  login: vi.fn(), setup: vi.fn(), changePassword: vi.fn(),
}))
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.mocked(login).mockReset().mockResolvedValue({ username: 'alice', mustChangePassword: false })
  vi.mocked(logout).mockReset().mockResolvedValue()
  vi.mocked(setup).mockReset().mockResolvedValue()
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

const signedOut: MeResponse = { authenticated: false, username: null, mustChangePassword: false,
  setupRequired: false, setupRecoveryRequired: false, setupTokenRequired: false }
const authActions = {
  login: () => useAuthStore.getState().login('alice', 'test-password'),
  logout: () => useAuthStore.getState().logout(),
  setup: () => useAuthStore.getState().setup('test-password', 'test-password', 'test-token'),
}

it.each(['login', 'logout', 'setup'] as const)('%s 接管未完成的会话校验后结束 loading，旧响应不能覆盖结果', async action => {
  let resolve!: (value: MeResponse) => void
  vi.mocked(getMe).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const validating = useAuthStore.getState().init()
  expect(useAuthStore.getState().loading).toBe(true)
  await authActions[action]()
  const expected = { authenticated: action !== 'logout', loading: false,
    username: action === 'login' ? 'alice' : action === 'setup' ? 'admin' : null }
  expect(useAuthStore.getState()).toMatchObject(expected)
  resolve({ ...signedOut, authenticated: true, username: 'stale-user' })
  await validating
  expect(useAuthStore.getState()).toMatchObject(expected)
})

it.each(['login', 'logout', 'setup'] as const)('%s 失败后也不残留已失效校验的 loading', async action => {
  let reject!: (error: Error) => void
  vi.mocked(getMe).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail }))
  const validating = useAuthStore.getState().init()
  const error = new Error('网络不可用')
  vi.mocked({ login, logout, setup }[action]).mockRejectedValueOnce(error)
  await expect(authActions[action]()).rejects.toBe(error)
  expect(useAuthStore.getState().loading).toBe(false)
  reject(new TypeError('旧请求失败'))
  await validating
  expect(useAuthStore.getState()).toMatchObject({ loading: false, error: null })
})

it('重连校验期间登出再登录后恢复可缓存的认证状态', async () => {
  let resolve!: (value: MeResponse) => void
  vi.mocked(getMe).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const validating = useAuthStore.getState().init()
  await authActions.logout()
  await authActions.login()
  resolve(signedOut)
  await validating
  expect(useAuthStore.getState()).toMatchObject({ authenticated: true, username: 'alice',
    offlineUsername: null, mustChangePassword: false, loading: false })
})

it('较早的登录失败不能结束后来发起的会话校验', async () => {
  let rejectLogin!: (error: Error) => void
  let resolveMe!: (value: MeResponse) => void
  vi.mocked(login).mockImplementationOnce(() => new Promise((_done, fail) => { rejectLogin = fail }))
  vi.mocked(getMe).mockImplementationOnce(() => new Promise(done => { resolveMe = done }))
  const signingIn = authActions.login()
  const validating = useAuthStore.getState().init()
  const error = new Error('登录失败')
  rejectLogin(error)
  await expect(signingIn).rejects.toBe(error)
  expect(useAuthStore.getState().loading).toBe(true)
  resolveMe(signedOut)
  await validating
  expect(useAuthStore.getState().loading).toBe(false)
})

it('初始化冲突仍重新校验会话，直到校验完成才结束 loading', async () => {
  let resolve!: (value: MeResponse) => void
  const error = Object.assign(new Error('已经初始化'), { status: 409 })
  vi.mocked(setup).mockRejectedValueOnce(error)
  vi.mocked(getMe).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const settingUp = authActions.setup()
  const rejected = expect(settingUp).rejects.toBe(error)
  await Promise.resolve()
  expect(useAuthStore.getState().loading).toBe(true)
  resolve(signedOut)
  await rejected
  expect(useAuthStore.getState()).toMatchObject({ loading: false, authenticated: false })
})

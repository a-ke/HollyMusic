import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock'
import { usePlayerStore } from '@/lib/store/player-store'
import { logger } from '@/lib/logger'

class ScreenLock extends EventTarget {
  released = false
  release = vi.fn(async () => { this.released = true; this.dispatchEvent(new Event('release')) })
}
class AudioState extends EventTarget { paused = false; ended = false }
let root: Root
let audio: AudioState
let visibility: DocumentVisibilityState
let request: ReturnType<typeof vi.fn<() => Promise<ScreenLock>>>
const locks: ScreenLock[] = []

function Harness() { useScreenWakeLock(audio as HTMLAudioElement); return null }
async function mount() { await act(async () => { root.render(<Harness />) }) }
async function visible(value: DocumentVisibilityState) {
  await act(async () => { visibility = value; document.dispatchEvent(new Event('visibilitychange')) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('isSecureContext', true)
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  locks.length = 0
  request = vi.fn(async () => { const lock = new ScreenLock(); locks.push(lock); return lock })
  vi.stubGlobal('navigator', { wakeLock: { request } })
  audio = new AudioState()
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), keepScreenAwake: true, isPlaying: true }, true)
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('真实播放才申请，暂停释放；再次播放恢复，关闭开关立即释放', async () => {
  audio.paused = true
  await mount()
  expect(request).not.toHaveBeenCalled()
  await act(async () => { audio.paused = false; audio.dispatchEvent(new Event('playing')) })
  expect(request).toHaveBeenCalledWith('screen')
  expect(usePlayerStore.getState().wakeLockStatus).toBe('active')
  await act(async () => { audio.paused = true; audio.dispatchEvent(new Event('pause')) })
  expect(locks[0].release).toHaveBeenCalledOnce()
  await act(async () => { audio.paused = false; audio.dispatchEvent(new Event('playing')) })
  expect(request).toHaveBeenCalledTimes(2)
  await act(async () => usePlayerStore.getState().setKeepScreenAwake(false))
  expect(locks[1].release).toHaveBeenCalledOnce()
  expect(usePlayerStore.getState().wakeLockStatus).toBe('idle')
})

it('进入后台释放，返回前台重新申请；系统主动释放后不循环抢锁', async () => {
  await mount()
  await visible('hidden')
  expect(locks[0].release).toHaveBeenCalledOnce()
  await visible('visible')
  expect(request).toHaveBeenCalledTimes(2)
  await act(async () => { await locks[1].release() })
  expect(usePlayerStore.getState().wakeLockStatus).toBe('released')
  expect(request).toHaveBeenCalledTimes(2)
  await visible('hidden')
  await visible('visible')
  expect(request).toHaveBeenCalledTimes(3)
})

it('关闭设置后才返回的申请立即释放，不把状态改回常亮', async () => {
  let finish!: (lock: ScreenLock) => void
  request.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await act(async () => usePlayerStore.getState().setKeepScreenAwake(false))
  const late = new ScreenLock()
  await act(async () => finish(late))
  expect(late.release).toHaveBeenCalledOnce()
  expect(usePlayerStore.getState().wakeLockStatus).toBe('idle')
})

it('旧申请跨越隐藏和恢复后被释放，只保留新申请', async () => {
  let finish!: (lock: ScreenLock) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await visible('hidden')
  await visible('visible')
  const late = new ScreenLock()
  await act(async () => finish(late))
  expect(late.release).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledTimes(2)
  expect(usePlayerStore.getState().wakeLockStatus).toBe('active')
})

it('pagehide 期间不会因旧申请返回而重新申请，pageshow 恢复', async () => {
  let finish!: (lock: ScreenLock) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await mount()
  await act(async () => window.dispatchEvent(new Event('pagehide')))
  const late = new ScreenLock()
  await act(async () => finish(late))
  expect(late.release).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledOnce()
  await act(async () => window.dispatchEvent(new Event('pageshow')))
  expect(request).toHaveBeenCalledTimes(2)
})

it('拒绝授权只报告失败，播放状态不变且不自动重试', async () => {
  request.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  await mount()
  expect(usePlayerStore.getState()).toMatchObject({ wakeLockStatus: 'error', isPlaying: true })
  expect(request).toHaveBeenCalledOnce()
})

it.each(['insecure', 'unavailable'])('%s 环境安全降级', async reason => {
  if (reason === 'insecure') vi.stubGlobal('isSecureContext', false)
  else vi.stubGlobal('navigator', {})
  await mount()
  expect(request).not.toHaveBeenCalled()
  expect(usePlayerStore.getState().wakeLockStatus).toBe('unsupported')
})

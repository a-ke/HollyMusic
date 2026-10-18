import { act, StrictMode, useEffect, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MemoryRouter, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLyricsHistory } from '../src/hooks/useLyricsHistory'
import { AppRouter } from '../src/components/AppRouter'
import { LyricsPanelContext, useLyricsPanel, type LyricsPanelState } from '@/hooks/useLyricsPanel'
import { usePlayerPersistence } from '@/hooks/usePlayerPersistence'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useAuthStore } from '@/hooks/useAuth'
import { playbackSessionStorage } from '@/lib/player-storage'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'

const track = toTrack({ uid: 'kw-song', musicInfo: { name: 'song', singer: 'artist', source: 'kw', songmid: 'song', interval: '3:00',
  types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} } })
let root: Root
let container: HTMLDivElement
let navigate: NavigateFunction
let location: Location
let panel: LyricsPanelState

function Controls({ closeImmediately = false }: { closeImmediately?: boolean }) {
  const value = useLyricsPanel()
  const currentNavigate = useNavigate()
  const currentLocation = useLocation()
  useKeyboardShortcuts()
  useLayoutEffect(() => {
    if (closeImmediately && value.isOpen) value.close()
  }, [closeImmediately, value])
  useEffect(() => {
    navigate = currentNavigate
    location = currentLocation
    panel = value
  }, [currentNavigate, currentLocation, value])
  return <>
    <button onClick={value.open}>打开</button>
    <button onClick={value.close}>收起</button>
    <output>{value.isOpen ? '展开' : '收起'}</output>
  </>
}

function TestApp({ ready = true, closeImmediately = false }: { ready?: boolean; closeImmediately?: boolean }) {
  const value = useLyricsHistory(ready)
  return <LyricsPanelContext.Provider value={value}><Controls closeImmediately={closeImmediately} /></LyricsPanelContext.Provider>
}

function RestoredApp() {
  const ready = usePlayerPersistence()
  return <TestApp ready={ready} />
}

const entries = ['/favorites', { pathname: '/search', search: '?q=music', hash: '#results', state: { source: 'test' } }]
async function mount(initialEntries = entries, ready = true) {
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={initialEntries}><TestApp ready={ready} /></MemoryRouter></StrictMode>)
  })
}
async function open() { await act(async () => { panel.open() }) }
async function close() { await act(async () => { panel.close() }) }
async function nativeBack(action = () => window.history.back()) {
  await act(async () => {
    const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }))
    action()
    await popped
  })
}
async function mountBrowser() {
  window.history.replaceState(null, '', '/search?q=music')
  await act(async () => { root.render(<StrictMode><AppRouter><TestApp /></AppRouter></StrictMode>) })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), currentTrack: track }, true)
  useAuthStore.setState({ authenticated: null, username: null, offlineUsername: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

it('用 lyrics=1 表示展开，保留查询参数、hash、路由状态，支持后退前进', async () => {
  await mount()
  const originalKey = location.key
  await open()
  expect(location).toMatchObject({ pathname: '/search', search: '?q=music&lyrics=1', hash: '#results', state: { source: 'test' } })
  expect(panel.isOpen).toBe(true)
  await act(async () => { void navigate(-1) })
  expect(panel.isOpen).toBe(false)
  expect(location.key).toBe(originalKey)
  await act(async () => { void navigate(1) })
  expect(panel.isOpen).toBe(true)
  await close()
  expect(location.key).toBe(originalKey)
  await act(async () => { void navigate(-1) })
  expect(location.pathname).toBe('/favorites')
})

it('反复收起不累积历史，按钮和 L 快捷键使用同一套路由操作', async () => {
  await mount()
  const originalKey = location.key
  for (let i = 0; i < 3; i++) {
    await act(async () => { container.querySelector('button')!.click() })
    expect(panel.isOpen).toBe(true)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })) })
    expect(panel.isOpen).toBe(false)
    expect(location.key).toBe(originalKey)
  }
  await act(async () => { void navigate(-1) })
  expect(location.pathname).toBe('/favorites')
})

it('直接访问带参数的链接，有当前歌曲也移除参数且不新增历史', async () => {
  await mount(['/favorites', '/search?q=music&lyrics=1#results'])
  expect(panel.isOpen).toBe(false)
  expect(location).toMatchObject({ pathname: '/search', search: '?q=music', hash: '#results' })
  expect(panel.isOpen).toBe(false)
  await act(async () => { void navigate(-1) })
  expect(location.pathname).toBe('/favorites')
})

it('直接访问带参数的链接，没有当前歌曲就替换 URL 去掉参数', async () => {
  usePlayerStore.setState({ currentTrack: null })
  await mount(['/favorites', '/search?q=music&lyrics=1#results'])
  expect(location).toMatchObject({ pathname: '/search', search: '?q=music', hash: '#results' })
  expect(panel.isOpen).toBe(false)
  await open()
  expect(location.search).toBe('?q=music')
  await act(async () => { void navigate(-1) })
  expect(location.pathname).toBe('/favorites')
})

it('播放恢复尚未完成时也直接移除参数', async () => {
  usePlayerStore.setState({ currentTrack: null })
  const initial = ['/favorites', '/search?lyrics=1']
  await mount(initial, false)
  expect(location.search).toBe('')
  expect(panel.isOpen).toBe(false)
  await mount(initial, true)
  expect(location.search).toBe('')
})

it('直达参数在登录前移除，之后恢复歌曲也不会自动展开', async () => {
  usePlayerStore.setState({ currentTrack: null })
  playbackSessionStorage('alice').write({ queue: [track], playNextQueue: [], currentTrack: track,
    currentIndex: 0, currentTime: 42, isCurrentTempPlay: false })
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={['/search?lyrics=1']}><RestoredApp /></MemoryRouter></StrictMode>)
  })
  expect(location.search).toBe('')
  expect(panel.isOpen).toBe(false)
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice' }) })
  expect(location.search).toBe('')
  expect(panel.isOpen).toBe(false)
  expect(usePlayerStore.getState()).toMatchObject({ currentTime: 42, isPlaying: false })
})

it('没有 lyrics=1 不展开，历史 state 中旧版歌词标记不再影响显隐', async () => {
  await mount(['/favorites', { pathname: '/search', search: '?lyrics=0', hash: '', state: { hollyLyricsOpen: true } }])
  expect(panel.isOpen).toBe(false)
})

it('登录后没有可恢复歌曲时，删除直达链接里的参数', async () => {
  usePlayerStore.setState({ currentTrack: null })
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={['/search?q=music&lyrics=1']}><RestoredApp /></MemoryRouter></StrictMode>)
  })
  expect(location.search).toBe('?q=music')
  await act(async () => { useAuthStore.setState({ authenticated: true, username: 'alice' }) })
  expect(location.search).toBe('?q=music')
  expect(panel.isOpen).toBe(false)
})

it('清空当前歌曲会移除参数，切换歌曲则保留展开状态', async () => {
  await mount()
  await open()
  await act(async () => { usePlayerStore.setState({ currentTrack: { ...track, uid: 'kw-other' } }) })
  expect(panel.isOpen).toBe(true)
  await act(async () => { usePlayerStore.getState().clearQueue() })
  expect(panel.isOpen).toBe(false)
  expect(new URLSearchParams(location.search).has('lyrics')).toBe(false)
})

it('打开与跳页在同一批更新中发生，目标页不继承歌词', async () => {
  await mount()
  await act(async () => { panel.open(); void navigate('/history') })
  expect(location.pathname).toBe('/history')
  expect(location.search).toBe('')
  expect(panel.isOpen).toBe(false)
  const key = location.key
  await open()
  await close()
  expect(location.key).toBe(key)
})

it('打开后同批返回原 key，不会卡住，后续开关仍可导航', async () => {
  await mount()
  const key = location.key
  await act(async () => { panel.open(); void navigate(-1) })
  expect(location.key).toBe(key)
  expect(panel.isOpen).toBe(false)
  await open()
  expect(panel.isOpen).toBe(true)
  expect(location.key).not.toBe(key)
  await close()
  expect(location.key).toBe(key)
})

it('新歌词路由提交时立即收起，不会自动弹回', async () => {
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={['/search']}><TestApp closeImmediately /></MemoryRouter></StrictMode>)
  })
  const key = location.key
  await open()
  expect(location.key).toBe(key)
  expect(panel.isOpen).toBe(false)
})

it('原生后退关闭歌词，保持播放状态，反复收起不累积历史', async () => {
  await mountBrowser()
  const key = location.key
  usePlayerStore.setState({ isPlaying: true, currentTime: 42 })
  await open()
  await nativeBack()
  expect(panel.isOpen).toBe(false)
  expect(location.key).toBe(key)
  expect(usePlayerStore.getState()).toMatchObject({ isPlaying: true, currentTime: 42 })
  for (let i = 0; i < 3; i++) {
    await open()
    await nativeBack(() => panel.close())
    expect(location.key).toBe(key)
    expect(panel.isOpen).toBe(false)
  }
})

it('点击展开在本次交互内提交，不等待低优先级路由任务', async () => {
  await mountBrowser()
  await act(async () => {
    flushSync(() => { container.querySelector('button')!.click() })
    expect(window.location.search).toBe('?q=music&lyrics=1')
    expect(container.querySelector('output')?.textContent).toBe('展开')
  })
})

it.each(['1', '0', 'other'])('直接打开链接会自动去掉 lyrics=%s，无需手动收起', async value => {
  window.history.replaceState(null, '', `/search?lyrics=${value}`)
  await act(async () => { root.render(<StrictMode><AppRouter><TestApp /></AppRouter></StrictMode>) })
  expect(window.location.search).toBe('')
  expect(container.querySelector('output')?.textContent).toBe('收起')
})

it('应用内收起在原生返回到达时提交，不再排入后台队列', async () => {
  await mountBrowser()
  await open()
  let visibleAtPop = ''
  await act(async () => {
    const popped = new Promise<void>(resolve => window.addEventListener('popstate', () => {
      // 只提交当前事件已有的紧急更新，不执行低优先级 transition。
      flushSync(() => {})
      visibleAtPop = container.querySelector('output')?.textContent ?? ''
      resolve()
    }, { once: true }))
    panel.close()
    await popped
  })
  expect(visibleAtPop).toBe('收起')
  expect(window.location.search).toBe('?q=music')
})

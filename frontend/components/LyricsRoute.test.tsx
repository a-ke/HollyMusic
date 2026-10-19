import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useLyricsPanel } from '@/hooks/useLyricsPanel'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlayerStore } from '@/lib/store/player-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { toTrack } from '@/lib/types/player'

vi.mock('../src/components/CachedHomePage', () => ({ CachedHomePage: () => null }))
vi.mock('../src/routes/HistoryPage', () => ({ HistoryPage: () => null }))
vi.mock('@/components/player/PlayerBar', () => ({ PlayerBar: () => null }))
vi.mock('@/components/player/QueuePanel', () => ({ QueuePanel: () => null }))
vi.mock('@/components/shared/SongContextMenu', () => ({ SongContextMenu: () => null }))
vi.mock('@/components/player/LyricsPanel', () => ({
  LyricsPanel: () => {
    const panel = useLyricsPanel()
    return <>
      <button data-open onClick={panel.open}>打开歌词</button>
      <button data-close onClick={panel.close}>收起歌词</button>
      <output data-lyrics>{panel.isOpen ? '展开' : '收起'}</output>
    </>
  },
}))

const track = toTrack({ uid: 'kw-song', musicInfo: { name: 'song', singer: 'artist', source: 'kw', songmid: 'song', interval: '3:00',
  types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} } })
let root: Root
let container: HTMLDivElement
const originalLoad = useFavoritesStore.getState().load

function Route() { return <output data-route>{useLocation().search}</output> }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({ ...useAuthStore.getInitialState(), authenticated: true, username: 'alice', init: async () => {} }, true)
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useFavoritesStore.setState({ load: async () => {} })
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  useFavoritesStore.setState({ load: originalLoad })
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

it.each([true, false])('直达链接立即去掉 lyrics，歌曲加载结果不影响面板，成功=%s', async success => {
  let finish!: () => void
  const playByUid = vi.fn(() => new Promise<void>((resolve, reject) => {
    finish = () => {
      if (success) { usePlayerStore.setState({ currentTrack: track }); resolve() }
      else reject(new Error('song unavailable'))
    }
  }))
  usePlayerStore.setState({ playByUid })
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={['/history?uid=kw-song&lyrics=1']}><App /><Route /></MemoryRouter></StrictMode>)
  })
  expect(playByUid).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[data-route]')?.textContent).toBe('?uid=kw-song')
  expect(container.querySelector('[data-lyrics]')?.textContent).toBe('收起')
  await act(async () => { finish() })
  expect(container.querySelector('[data-route]')?.textContent).toBe('?uid=kw-song')
  expect(container.querySelector('[data-lyrics]')?.textContent).toBe('收起')
})

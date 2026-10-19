import { act, StrictMode, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CachedHomePage } from '../src/components/CachedHomePage'
import { DiscoveryCollectionPage } from '../src/routes/DiscoveryCollectionPage'
import { useLyricsHistory } from '../src/hooks/useLyricsHistory'
import { LyricsPanelContext } from '@/hooks/useLyricsPanel'
import { getRecommendedPlaylistDetail, getToplistDetail } from '@/lib/api/discovery'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
import type { Song } from '@/lib/types/music'
import type { SongRow } from '@/components/shared/SongRow'
import { mockVirtualLayout } from './virtual-list-test-utils'

const { renderRow } = vi.hoisted(() => ({ renderRow: vi.fn() }))
vi.mock('@/lib/api/discovery', () => ({
  getToplists: vi.fn(async () => [{ id: 'top', name: '首页榜单', cover: '', description: '', source: 'kw' }] ),
  getRecommendedPlaylists: vi.fn(async () => [{ id: 'list', name: '首页歌单', cover: '', description: '', author: 'artist', playCount: 1, source: 'kw' }]),
  getRecommendedPlaylistDetail: vi.fn(), getToplistDetail: vi.fn(),
}))
vi.mock('@/components/shared/SongRow', () => ({ SongRow: (props: ComponentProps<typeof SongRow>) => {
  renderRow(props)
  return <button data-row={props.index} onClick={() => void usePlayerStore.getState().playTrack(props.track, props.queue)}>{props.track.name}</button>
} }))

const songs: Song[] = Array.from({ length: 2000 }, (_, index) => ({ uid: `kw-${index}`, name: `歌曲${index}`,
  singer: 'artist', source: 'kw', songmid: String(index), interval: '3:00',
  types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} }))
let root: Root
let container: HTMLDivElement
let playTrack: ReturnType<typeof vi.fn>
let layout: ReturnType<typeof mockVirtualLayout>

function TestApp() {
  const lyrics = useLyricsHistory(true)
  return <LyricsPanelContext.Provider value={lyrics}>
    <button data-open onClick={lyrics.open}>打开歌词</button>
    <button data-close onClick={lyrics.close}>收起歌词</button>
    <output>{lyrics.isOpen ? '展开' : '收起'}</output>
    <CachedHomePage />
    <main className="app-main" style={{ overflowY: 'auto' }}><Routes>
      <Route path="/" element={null} />
      <Route path="/discover/playlists/:id" element={<DiscoveryCollectionPage kind="playlists" />} />
      <Route path="/discover/toplists/:id" element={<DiscoveryCollectionPage kind="toplists" />} />
    </Routes></main>
  </LyricsPanelContext.Provider>
}
async function click(selector: string) {
  await act(async () => { container.querySelector<HTMLElement>(selector)!.click() })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  layout = mockVirtualLayout()
  vi.mocked(getRecommendedPlaylistDetail).mockReset().mockResolvedValue({ id: 'list', name: '首页歌单', cover: '', description: '', author: 'artist', tracks: songs })
  vi.mocked(getToplistDetail).mockReset().mockResolvedValue({ id: 'top', name: '首页榜单', cover: '', description: '', author: 'artist', tracks: songs })
  renderRow.mockClear()
  playTrack = vi.fn(async () => {})
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), playTrack, currentTrack: toTrack({ uid: songs[0].uid, musicInfo: songs[0] }) }, true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  layout.restore()
  vi.unstubAllGlobals()
})

it.each(['playlists/list', 'toplists/top'])('从首页进入 %s：只挂载可视行，开关歌词不再渲染歌曲行', async path => {
  await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={['/?source=kw&page=2']}><TestApp /></MemoryRouter></StrictMode>) })
  const home = container.querySelector('main')!
  home.scrollTop = 320
  await act(async () => { home.dispatchEvent(new Event('scroll', { bubbles: true })) })
  await click(`a[href="/discover/${path}?source=kw"]`)
  expect(container.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(60)
  const renders = renderRow.mock.calls.length
  for (let i = 0; i < 2; i++) {
    await click('[data-open]')
    expect(container.querySelector('output')?.textContent).toBe('展开')
    await click('[data-close]')
    expect(container.querySelector('output')?.textContent).toBe('收起')
  }
  expect(renderRow).toHaveBeenCalledTimes(renders)
  const fetchDetail = path.startsWith('playlists') ? getRecommendedPlaylistDetail : getToplistDetail
  expect(fetchDetail).toHaveBeenCalledTimes(1)
  const height = container.querySelector<HTMLElement>('.track-list')!.style.height
  // 第二个 main 是详情页滚动容器，首页缓存的 main 保持原位置。
  const detailMain = container.querySelectorAll<HTMLElement>('.app-main')[1]
  await act(async () => {
    detailMain.scrollTop = 240 + 100 * 62
    detailMain.dispatchEvent(new Event('scroll'))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
  expect(container.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(60)
  expect(container.querySelector<HTMLElement>('.track-list')!.style.height).toBe(height)
  await click('[data-row="100"]')
  expect(playTrack.mock.calls[0][1]).toHaveLength(2000)
  const backLink = [...container.querySelectorAll('a')].find(link => link.textContent?.trim() === '发现音乐')!
  await act(async () => { backLink.click() })
  expect(home.hidden).toBe(false)
  expect(home.scrollTop).toBe(320)
  expect(home.querySelector('[aria-selected="true"]')?.textContent).toBe('酷我音乐')
})

import { act, StrictMode, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlaylistDetailPage } from '../src/routes/PlaylistDetailPage'
import { useLyricsHistory } from '../src/hooks/useLyricsHistory'
import { LyricsPanelContext } from '@/hooks/useLyricsPanel'
import { getPlaylist, type PlaylistDetail } from '@/lib/api/playlists'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAuthStore } from '@/hooks/useAuth'
import { toTrack } from '@/lib/types/player'
import type { SongRow } from '@/components/shared/SongRow'
import { mockVirtualLayout, scrollList } from './virtual-list-test-utils'

const { renderRow } = vi.hoisted(() => ({ renderRow: vi.fn() }))
vi.mock('@/lib/api/playlists', () => ({ getPlaylist: vi.fn(), deletePlaylist: vi.fn(), updatePlaylist: vi.fn() }))
vi.mock('@/components/shared/SongRow', () => ({ SongRow: (props: ComponentProps<typeof SongRow>) => {
  renderRow(props)
  return <button data-row={props.index} onClick={() => void usePlayerStore.getState().playTrack(props.track, props.queue)}>{props.track.name}</button>
} }))

const detail: PlaylistDetail = {
  id: 1, name: '大歌单', username: 'alice', songCount: 2000, comment: null, owner: null, isPublic: false,
  duration: null, coverArt: null, coverSongUid: null, createdAt: '', allowedUsers: [],
  entries: Array.from({ length: 2000 }, (_, index) => ({
    id: index + 100, position: index, songId: `kw-${index}`, addedAt: '', addedBy: 'alice',
    musicInfo: { name: `歌曲${index}`, singer: 'artist', source: 'kw', songmid: String(index), interval: '3:00',
      types: [], _types: { '128k': {}, '320k': {}, flac: {}, flac24bit: {} }, typeUrl: {} },
  })),
}
let root: Root
let container: HTMLDivElement
let layout: ReturnType<typeof mockVirtualLayout>
let playTrack: ReturnType<typeof vi.fn>

function TestPage() {
  const lyrics = useLyricsHistory(true)
  return <LyricsPanelContext.Provider value={lyrics}>
    <button data-open onClick={lyrics.open}>打开歌词</button>
    <button data-close onClick={lyrics.close}>收起歌词</button>
    <output>{lyrics.isOpen ? '展开' : '收起'}{useLocation().search}</output>
    <main className="app-main" style={{ overflowY: 'auto' }}><Routes><Route path="/playlists/:id" element={<PlaylistDetailPage />} /></Routes></main>
  </LyricsPanelContext.Provider>
}
async function mount() {
  await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={['/playlists/1']}><TestPage /></MemoryRouter></StrictMode>) })
}
async function click(selector: string) {
  await act(async () => { container.querySelector<HTMLButtonElement>(selector)!.click() })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  layout = mockVirtualLayout()
  vi.mocked(getPlaylist).mockReset().mockResolvedValue(detail)
  renderRow.mockClear()
  playTrack = vi.fn(async () => {})
  usePlayerStore.setState({ ...usePlayerStore.getInitialState(), playTrack,
    currentTrack: toTrack({ uid: detail.entries[0].songId, musicInfo: detail.entries[0].musicInfo! }) }, true)
  useAuthStore.setState({ authenticated: true, username: 'alice' })
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  layout.restore()
  vi.unstubAllGlobals()
})

it('2000 首歌只挂载可视行，切换歌词和歌单菜单不会重新渲染歌曲行', async () => {
  await mount()
  expect(container.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(60)
  const renders = renderRow.mock.calls.length
  for (let i = 0; i < 2; i++) {
    await click('[data-open]')
    expect(container.querySelector('output')?.textContent).toBe('展开?lyrics=1')
    await click('[data-close]')
    expect(container.querySelector('output')?.textContent).toBe('收起')
  }
  await click('[aria-label="更多歌单操作"]')
  expect(renderRow).toHaveBeenCalledTimes(renders)
  expect(getPlaylist).toHaveBeenCalledTimes(1)
})

it('可直接滚到第 100 首，单曲和播放全部仍使用完整队列', async () => {
  await mount()
  const height = container.querySelector<HTMLElement>('.track-list')!.style.height
  await scrollList(container, 240 + 100 * 62)
  expect(container.querySelectorAll('[data-row]').length).toBeLessThanOrEqual(60)
  expect(container.querySelector<HTMLElement>('.track-list')!.style.height).toBe(height)
  await click('[data-row="100"]')
  expect(playTrack.mock.calls[0][1]).toHaveLength(2000)
  expect(playTrack.mock.calls[0][0].uid).toBe('kw-100')
  const row = renderRow.mock.calls.find(([props]) => props.index === 100)![0]
  expect(row.playlistEntry).toMatchObject({ playlistId: 1, entryId: 200 })
  await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent?.includes('播放全部'))!.click() })
  expect(playTrack.mock.calls[1][1]).toHaveLength(2000)
  expect(playTrack.mock.calls[1][0].uid).toBe('kw-0')
})

it('移除歌曲后重新加载仍会更新曲目、条目 ID 和完整播放队列', async () => {
  await mount()
  const row = renderRow.mock.calls[0][0]
  vi.mocked(getPlaylist).mockResolvedValue({ ...detail, songCount: 1999, entries: detail.entries.slice(1) })
  await act(async () => { await row.playlistEntry.onRemoved() })
  expect(getPlaylist).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[data-row="0"]')?.textContent).toBe('歌曲1')
  const updated = renderRow.mock.calls.filter(([props]) => props.index === 0).at(-1)![0]
  expect(updated.playlistEntry.entryId).toBe(101)
  await click('[data-row="0"]')
  expect(playTrack.mock.calls[0][1]).toHaveLength(1999)
})

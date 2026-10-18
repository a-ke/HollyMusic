import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SongList } from '@/components/shared/SongList'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAuthStore } from '@/hooks/useAuth'
import { toTrack } from '@/lib/types/player'

vi.mock('@/components/shared/CoverImage', () => ({ CoverImage: () => null }))
vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ download: vi.fn(), downloading: false, error: null }) }))

const track = toTrack({ uid: 'kw-1', musicInfo: { name: '歌曲', singer: '歌手', source: 'kw', songmid: '1',
  interval: '03:00', types: [], _types: {}, typeUrl: {},
} as Parameters<typeof toTrack>[0]['musicInfo'] })

afterEach(() => {
  usePlayerStore.setState(usePlayerStore.getInitialState(), true)
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

it('复用歌曲行样式，以缓存音质播放，并将在线操作替换为本地删除', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const playTrack = vi.fn(async () => {})
  const remove = vi.fn()
  usePlayerStore.setState({ playTrack, currentTrack: null })
  useAuthStore.setState({ authenticated: null, offlineUsername: 'alice' })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<SongList tracks={[track, track]} localPlayback={{ qualities: ['128k', '320k'], onRemove: remove }} />) })
    expect(container.querySelector('.track-list')).not.toBeNull()
    expect(container.textContent).toContain('128K')
    expect(container.textContent).toContain('3:00')
    expect(container.querySelector('[aria-label="收藏"]')).toBeNull()
    expect(container.querySelector('[aria-label="下载"]')).toBeNull()
    expect(container.querySelector('[aria-label="更多操作"]')).toBeNull()
    await act(async () => { (container.querySelector('[aria-label="播放 歌曲"]') as HTMLButtonElement).click() })
    const localTrack = { ...track, playback: { source: 'local', quality: '128k' } }
    const local320Track = { ...track, playback: { source: 'local', quality: '320k' } }
    expect(playTrack).toHaveBeenCalledWith(localTrack, [localTrack, local320Track], { offline: true, quality: '128k' })
    await act(async () => { (container.querySelectorAll('[aria-label="播放 歌曲"]')[1] as HTMLButtonElement).click() })
    expect(playTrack).toHaveBeenLastCalledWith(local320Track, [localTrack, local320Track], { offline: true, quality: '320k' })
    await act(async () => { (container.querySelector('[aria-label="删除 歌曲 的本地缓存"]') as HTMLButtonElement).click() })
    expect(remove).toHaveBeenCalledWith(0)
    await act(async () => { usePlayerStore.setState({ currentTrack: track, effectiveQuality: '128k', isPlaying: true, streamUrl: 'blob:local' }) })
    expect(container.querySelector('[data-current="true"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()) }
})

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '@/lib/store/player-store'
import type { LyricsPanelState } from '@/hooks/useLyricsPanel'

const LYRICS_RETURN_TO = 'hollyLyricsReturnTo'

/** URL 是歌词面板显隐的唯一来源；state 只用于区分收起时后退还是替换 URL。 */
export function useLyricsHistory(playbackReady: boolean): LyricsPanelState {
  const location = useLocation()
  const navigate = useNavigate()
  const track = usePlayerStore(s => s.currentTrack)
  const [initialKey] = useState(location.key)
  const initialLink = location.key === initialKey && new URLSearchParams(location.search).has('lyrics')
  const requested = new URLSearchParams(location.search).get('lyrics') === '1'

  const params = new URLSearchParams(location.search)
  params.delete('lyrics')
  const baseSearch = params.size ? `?${params}` : ''
  const baseUrl = location.pathname + baseSearch + location.hash

  const open = useCallback(() => {
    if (requested || !usePlayerStore.getState().currentTrack) return
    const params = new URLSearchParams(location.search)
    params.set('lyrics', '1')
    void navigate({ ...location, search: `?${params}` }, {
      state: { ...location.state, [LYRICS_RETURN_TO]: baseUrl },
    })
  }, [requested, location, navigate, baseUrl])

  const close = useCallback(() => {
    if (!requested) return
    if (location.state?.[LYRICS_RETURN_TO] === baseUrl) {
      void navigate(-1)
    } else {
      // 直接访问/分享链接没有应用内的来源记录，收起时留在当前页面。
      void navigate(baseUrl, { replace: true, state: location.state })
    }
  }, [requested, location.state, baseUrl, navigate])

  useEffect(() => {
    // 首次进入（含刷新）一律移除歌词参数，不等待登录、播放恢复或分享歌曲加载。
    if (initialLink) {
      void navigate(baseUrl, { replace: true, state: location.state })
      return
    }
    // 登录后恢复播放记录完成再判断，避免把可恢复的歌曲误判成空播放器。
    if (!playbackReady || !requested || usePlayerStore.getState().currentTrack) return
    void navigate(baseUrl, { replace: true, state: location.state })
  }, [initialLink, playbackReady, requested, track, baseUrl, location.state, navigate])

  const toggle = useCallback(() => { if (requested) close(); else open() }, [requested, close, open])
  return { isOpen: !initialLink && requested && playbackReady && !!track, open, close, toggle }
}

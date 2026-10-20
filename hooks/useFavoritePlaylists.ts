import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listFavoritePlaylists, removeFavoritePlaylist, saveFavoritePlaylist,
  type FavoritePlaylist, type FavoritePlaylistInput,
} from '@/lib/api/favorite-playlists'
import { useAuthStore } from '@/hooks/useAuth'

/** 页面挂载时向服务端读取；切换账号或卸载后，旧响应不能写回。 */
export function useFavoritePlaylists(enabled = true) {
  const username = useAuthStore(s => s.authenticated ? s.username : null)
  const sessionRevision = useAuthStore(s => s.sessionRevision)
  const [state, setState] = useState<{
    username: string | null; revision: number; list: FavoritePlaylist[]; loading: boolean; error: string | null
  }>({ username: null, revision: -1, list: [], loading: true, error: null })
  const [pending, setPending] = useState(false)
  const requestId = useRef(0)
  const busy = useRef(false)

  const isSessionCurrent = useCallback(() => {
    const auth = useAuthStore.getState()
    return enabled && auth.authenticated && auth.username === username && auth.sessionRevision === sessionRevision
  }, [enabled, username, sessionRevision])

  const reload = useCallback(async () => {
    if (!username || !isSessionCurrent() || busy.current) return
    const currentRequest = ++requestId.current
    setState({ username, revision: sessionRevision, list: [], loading: true, error: null })
    try {
      const { list } = await listFavoritePlaylists()
      if (requestId.current !== currentRequest || !isSessionCurrent()) return
      setState({ username, revision: sessionRevision, list, loading: false, error: null })
    } catch (error) {
      if (requestId.current !== currentRequest || !isSessionCurrent()) return
      setState({ username, revision: sessionRevision, list: [], loading: false,
        error: error instanceof Error ? error.message : '获取收藏歌单失败' })
    }
  }, [username, sessionRevision, isSessionCurrent])

  useEffect(() => {
    const activeRequest = requestId
    let cancelled = false
    busy.current = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setPending(false)
      return reload()
    })
    return () => { cancelled = true; activeRequest.current++ }
  }, [reload])

  const belongsToSession = state.username === username && state.revision === sessionRevision
  const list = belongsToSession && username ? state.list : []
  const loading = enabled && !!username && (!belongsToSession || state.loading)
  const error = belongsToSession ? state.error : null

  const setFavorite = useCallback(async (playlist: FavoritePlaylistInput, starred: boolean) => {
    if (!isSessionCurrent() || busy.current) return
    if (loading || error) throw new Error('收藏状态尚未加载，请重试')
    busy.current = true
    setPending(true)
    const currentRequest = requestId.current
    try {
      const saved = starred ? await saveFavoritePlaylist(playlist) : null
      if (!starred) await removeFavoritePlaylist(playlist.source, playlist.playlistId)
      if (currentRequest !== requestId.current || !isSessionCurrent()) return
      setState(previous => {
        const remaining = previous.list.filter(item => item.source !== playlist.source || item.playlistId !== playlist.playlistId)
        return { ...previous, list: saved ? [saved, ...remaining] : remaining }
      })
    } catch (error) {
      if (currentRequest === requestId.current && isSessionCurrent()) throw error
    } finally {
      if (currentRequest === requestId.current && isSessionCurrent()) {
        busy.current = false
        setPending(false)
      }
    }
  }, [error, loading, isSessionCurrent])

  return { playlists: list, loading, error, pending: belongsToSession && pending, reload, setFavorite }
}

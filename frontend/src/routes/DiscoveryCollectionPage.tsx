import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Music, Play, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { RemoteCoverImage } from '@/components/shared/RemoteCoverImage'
import { SongList } from '@/components/shared/SongList'
import { getRecommendedPlaylistDetail, getToplistDetail } from '@/lib/api/discovery'
import { usePlayerStore } from '@/lib/store/player-store'
import { toTrack } from '@/lib/types/player'
import type { DiscoveryCollectionDetail, DiscoverySource } from '@/lib/services/discovery-service'
import { FavoritePlaylistButton } from '@@/components/playlists/FavoritePlaylistButton'

export function DiscoveryCollectionPage({ kind }: { kind: 'toplists' | 'playlists' }) {
  const { id = '' } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const sourceParam = searchParams.get('source')
  const source: DiscoverySource = sourceParam === 'wy' || sourceParam === 'kw' || sourceParam === 'kg' || sourceParam === 'mg' ? sourceParam : 'tx'
  // 详情页可能来自首页搜索、筛选或翻页；返回时必须保留完整查询条件。
  const discoveryFrom: unknown = location.state?.discoveryFrom
  const fromFavorites = discoveryFrom === '/playlists?tab=favorites'
  const backTo = typeof discoveryFrom === 'string' && (fromFavorites || /^\/(?:[?#]|$)/.test(discoveryFrom))
    ? discoveryFrom : `/?source=${source}`
  const [detail, setDetail] = useState<DiscoveryCollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const playTrack = usePlayerStore(s => s.playTrack)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = kind === 'toplists' ? await getToplistDetail(source, id) : await getRecommendedPlaylistDetail(source, id)
      if (currentRequest !== requestId.current) return
      // 大歌单的列表更新允许被歌词开关等即时交互打断。
      startTransition(() => {
        setDetail(result)
        setLoading(false)
      })
    } catch (err) {
      if (currentRequest !== requestId.current) return
      setDetail(null)
      setError(err instanceof Error ? err.message : '加载失败')
      setLoading(false)
    }
  }, [id, kind, source])

  useEffect(() => {
    const activeRequest = requestId
    let cancelled = false
    // StrictMode 重建时取消首轮尚未发出的请求，避免重复下载整张歌单。
    void Promise.resolve().then(() => { if (!cancelled) return load() })
    return () => { cancelled = true; activeRequest.current++ }
  }, [load])

  const tracks = useMemo(() => (detail?.tracks ?? []).map(song => toTrack({ uid: song.uid, musicInfo: song })), [detail])

  if (loading) return <div className="page-shell"><LoadingSkeleton /></div>
  if (!detail) return (
    <div className="page-shell">
      <Link to={backTo} className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /> {fromFavorites ? '收藏的歌单' : '发现音乐'}</Link>
      <EmptyState icon={Music} title={kind === 'toplists' ? '排行榜暂时无法加载' : '歌单暂时无法加载'} description={error || '内容可能已删除、设为私密或暂时不可访问。'} />
      <div className="flex justify-center"><button type="button" onClick={() => void load()} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-accent">重试</button></div>
    </div>
  )

  return (
    <div className="page-shell">
      <Link to={backTo} className="mb-5 inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-primary"><ChevronLeft className="h-4 w-4" /> {fromFavorites ? '收藏的歌单' : '发现音乐'}</Link>
      <div className="feature-surface mb-7 grid grid-cols-[80px_minmax(0,1fr)] items-start gap-x-3 rounded-3xl border border-border/50 p-4 sm:flex sm:items-center sm:gap-6 sm:p-7">
        {detail.cover ? (
          <RemoteCoverImage src={detail.cover} alt="" className="cover-elevation row-span-3 h-20 w-20 shrink-0 rounded-2xl object-cover sm:h-40 sm:w-40 lg:h-44 lg:w-44" />
        ) : (
          <div className="cover-elevation row-span-3 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 sm:h-40 sm:w-40 lg:h-44 lg:w-44"><Music className="h-8 w-8 text-primary sm:h-12 sm:w-12" /></div>
        )}
        <div className="contents min-w-0 flex-1 sm:block">
          <p className="col-start-2 text-xs font-medium tracking-wider text-primary">{kind === 'toplists' ? '排行榜' : '推荐歌单'}</p>
          <h1 className="col-start-2 mt-2 break-words text-2xl font-bold leading-tight tracking-tight lg:text-4xl">{detail.name}</h1>
          <p className="col-start-2 mt-2 text-xs text-muted-foreground sm:mt-3 sm:text-sm">{detail.author}{detail.updateTime ? ` · 更新于 ${detail.updateTime}` : ''}</p>
          {detail.description && <p className="col-span-2 mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:mt-2 sm:text-sm">{detail.description}</p>}
          <div className="col-span-2 mt-4 flex flex-wrap gap-2 sm:mt-5">
            <button onClick={() => tracks[0] && playTrack(tracks[0], tracks)} disabled={tracks.length === 0} className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"><Play className="h-4 w-4 fill-current" /> 播放全部</button>
            {kind === 'playlists' && <FavoritePlaylistButton key={`${source}:${id}`} playlist={{
              source, playlistId: id, name: detail.name, cover: detail.cover,
              author: detail.author, songCount: tracks.length,
            }} />}
            <button onClick={() => void load()} className="rounded-full border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="刷新"><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex items-baseline gap-2"><h2 className="section-title">歌曲</h2><span className="text-xs text-muted-foreground">{tracks.length} 首</span></div>
      {tracks.length > 0 ? <SongList tracks={tracks} /> : <EmptyState icon={Music} title="暂无可播放歌曲" />}
    </div>
  )
}

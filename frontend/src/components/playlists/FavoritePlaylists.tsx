import { Heart, ListMusic } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFavoritePlaylists } from '@/hooks/useFavoritePlaylists'
import { toast } from '@/lib/toast'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { RemoteCoverImage } from '@/components/shared/RemoteCoverImage'
import { SourceBadge } from '@/components/shared/SourceBadge'

export function FavoritePlaylists() {
  const { playlists, loading, error, pending, reload, setFavorite } = useFavoritePlaylists()

  if (loading) return <LoadingSkeleton count={4} />
  if (error) return (
    <div className="flex flex-col items-center gap-3 py-12">
      <p role="alert" className="text-sm text-muted-foreground">{error}</p>
      <button type="button" onClick={() => void reload()} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-accent">重试</button>
    </div>
  )
  if (!playlists.length) return (
    <EmptyState icon={Heart} title="还没有收藏歌单" description="在发现音乐中打开喜欢的歌单，点击「收藏歌单」即可收进这里。" />
  )

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">共 {playlists.length} 个收藏 · 打开后查看原平台的歌单内容</p>
      <div className="library-grid -mx-2">
        {playlists.map(playlist => (
          <div key={`${playlist.source}:${playlist.playlistId}`} className="album-tile group relative min-w-0 rounded-2xl p-2">
            <Link to={`/discover/playlists/${encodeURIComponent(playlist.playlistId)}?source=${playlist.source}`}
              state={{ discoveryFrom: '/playlists?tab=favorites' }} className="flex flex-col gap-2">
              {playlist.cover ? (
                <RemoteCoverImage src={playlist.cover} alt="" className="cover-elevation aspect-square w-full rounded-xl object-cover" />
              ) : (
                <div className="cover-elevation flex aspect-square w-full items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/10">
                  <ListMusic className="h-1/3 w-1/3 text-primary/70" />
                </div>
              )}
              <div className="mt-1 truncate text-sm font-medium">{playlist.name}</div>
              <div className="flex items-center gap-2 pr-10 text-xs text-muted-foreground">
                <SourceBadge source={playlist.source} />
                <span className="truncate">{playlist.author || '未知作者'} · {playlist.songCount} 首</span>
              </div>
            </Link>
            <button type="button" aria-label={`取消收藏：${playlist.name}`} disabled={pending}
              onClick={() => {
                void setFavorite(playlist, false).catch(error => toast.error(error instanceof Error ? error.message : '取消收藏失败'))
              }}
              className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full text-primary hover:bg-accent disabled:opacity-50">
              <Heart className="h-4 w-4 fill-current" />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

import { Heart } from 'lucide-react'
import { useFavoritePlaylists } from '@/hooks/useFavoritePlaylists'
import type { FavoritePlaylistInput } from '@/lib/api/favorite-playlists'
import { toast } from '@/lib/toast'

export function FavoritePlaylistButton({ playlist }: { playlist: FavoritePlaylistInput }) {
  const { playlists, loading, error, pending, reload, setFavorite } = useFavoritePlaylists()
  const starred = playlists.some(item => item.source === playlist.source && item.playlistId === playlist.playlistId)

  if (error) return (
    <button type="button" onClick={() => void reload()} title={error}
      className="rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
      重试加载收藏
    </button>
  )

  return (
    <button type="button" aria-pressed={starred} disabled={loading || pending}
      onClick={() => {
        void setFavorite(playlist, !starred).catch(error => toast.error(error instanceof Error ? error.message : '收藏操作失败'))
      }}
      className={`flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50 ${starred ? 'text-primary' : 'text-muted-foreground'}`}>
      <Heart className={`h-4 w-4 ${starred ? 'fill-current' : ''}`} />
      {loading ? '加载收藏…' : pending ? '保存中…' : starred ? '已收藏' : '收藏歌单'}
    </button>
  )
}

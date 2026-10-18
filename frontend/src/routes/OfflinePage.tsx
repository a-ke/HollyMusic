import { useEffect, useState } from 'react'
import { HardDrive, RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/hooks/useAuth'
import { usePlayerStore } from '@/lib/store/player-store'
import { listOfflineTracks, deleteOfflineTrack, clearOfflineTracks, getOfflineCacheLimit, isOfflineStorageAvailable, OFFLINE_CHANGED, OFFLINE_DEFAULT_LIMIT_BYTES, type OfflineTrack } from '@/lib/offline-audio'
import { formatSize } from '@/lib/utils/format'
import { SongList } from '@/components/shared/SongList'
import { LoadingSkeleton } from '@/components/shared/LoadingSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { OfflineCacheSettings } from '../components/OfflineCacheSettings'

export function OfflinePage() {
  const username = useAuthStore(s => s.offlineUsername ?? s.username)
  const offline = useAuthStore(s => !!s.offlineUsername)
  const loading = useAuthStore(s => s.loading)
  const reconnect = useAuthStore(s => s.init)
  const playbackError = usePlayerStore(s => s.urlFetchError)
  const [tracks, setTracks] = useState<OfflineTrack[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [shellReady, setShellReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [limit, setLimit] = useState(() => username ? getOfflineCacheLimit(username) : OFFLINE_DEFAULT_LIMIT_BYTES)
  useEffect(() => {
    let active = true
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then(() => {
      if (active) setShellReady(true)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    let active = true
    let refreshId = 0
    const refresh = () => {
      if (!username) return
      setLimit(getOfflineCacheLimit(username))
      const id = ++refreshId
      void listOfflineTracks(username).then(items => {
        if (active && id === refreshId) { setTracks(items); setReady(true) }
      }).catch(() => { if (active && id === refreshId) { setError('无法读取本地缓存，请检查浏览器存储权限'); setReady(true) } })
    }
    refresh()
    window.addEventListener(OFFLINE_CHANGED, refresh)
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith('holly-offline-limit:')) refresh() }
    window.addEventListener('storage', onStorage)
    return () => { active = false; window.removeEventListener(OFFLINE_CHANGED, refresh); window.removeEventListener('storage', onStorage) }
  }, [username])

  const remove = async (key?: string) => {
    if (!username) return
    try {
      if (key) await deleteOfflineTrack(username, key)
      else await clearOfflineTracks(username)
      setError('')
    } catch { setError('删除失败，请重试') }
  }
  const total = tracks.reduce((sum, item) => sum + item.size, 0)
  return (
    <div className="page-shell">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title hidden desktop:block">本地歌曲</h1>
        <p className="text-sm text-muted-foreground desktop:hidden">缓存在此设备的音乐</p>
        <div className="ml-auto flex items-center gap-2">
          {offline && <button
            disabled={loading}
            onClick={() => void reconnect()}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? '正在连接…' : '重新连接'}
          </button>}
          <button onClick={() => setSettingsOpen(true)} aria-label="缓存设置" aria-haspopup="dialog" disabled={!username}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          ><Settings className="h-4 w-4" /> 设置</button>
          {tracks.length > 0 && <button
            onClick={() => { if (confirm('清空所有本地歌曲缓存？')) void remove() }}
            className="flex items-center gap-1 rounded-full border border-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
          ><Trash2 className="h-4 w-4" /> 清空</button>}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{tracks.length} 个音频 · 已使用 {formatSize(total, 1000)} / {formatSize(limit, 1000)}</span>
        {offline && <span role="status">离线模式 · {username}</span>}
      </div>
      <details className="mb-4 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer py-1">缓存说明</summary>
        <p className="mt-2 leading-relaxed">联网播放约 3 秒后自动保存完整歌曲，完成后可断网播放。仅限制缓存总大小，空间不足时优先清理最久未使用的歌曲，可在设置中调整容量。</p>
        <p className="mt-1 leading-relaxed">{shellReady ? '离线启动资源已就绪。' : '离线启动资源尚未就绪，请保持联网并稍后重试。'}清理浏览器数据后需重新缓存。</p>
      </details>
      {!isOfflineStorageAvailable() && <p role="alert" className="mb-4 text-sm text-destructive">当前浏览器无法保存离线歌曲，请检查存储权限，并通过 HTTPS 或 localhost 打开应用。</p>}
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {playbackError && <p role="alert" className="mb-4 text-sm text-destructive">{playbackError}</p>}
      {!ready ? <LoadingSkeleton /> : tracks.length > 0 ? (
        <SongList
          tracks={tracks.map(item => item.track)}
          localPlayback={{ qualities: tracks.map(item => item.quality), onRemove: index => { void remove(tracks[index].key) } }}
        />
      ) : (
        <EmptyState icon={HardDrive} title="暂无可离线播放的歌曲" description="联网播放并缓存完成的歌曲会自动保存到这里" />
      )}
      {settingsOpen && username && <OfflineCacheSettings key={username} username={username} limit={limit} used={total} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

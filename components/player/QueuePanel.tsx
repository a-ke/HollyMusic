import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { X, Trash2 } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'
import { upcomingQueueEntries } from '@/lib/player-queue'
import { CoverImage } from '@/components/shared/CoverImage'
import { ModalMask } from '@/components/shared/ModalMask'

export function QueuePanel() {
  const isOpen = usePlayerStore(s => s.isQueueOpen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const navigation = usePlayerStore(s => s.navigation)
  const playNextQueue = usePlayerStore(s => s.playNextQueue)
  const isCurrentTempPlay = usePlayerStore(s => s.isCurrentTempPlay)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const playFromQueue = usePlayerStore(s => s.playFromQueue)
  const playFromFuture = usePlayerStore(s => s.playFromFuture)
  const removeFromFuture = usePlayerStore(s => s.removeFromFuture)
  const removeFromQueue = usePlayerStore(s => s.removeFromQueue)
  const clearQueue = usePlayerStore(s => s.clearQueue)
  const playFromPlayNext = usePlayerStore(s => s.playFromPlayNext)
  const removeFromPlayNext = usePlayerStore(s => s.removeFromPlayNext)
  const clearPlayNext = usePlayerStore(s => s.clearPlayNext)
  const upcoming = useMemo(() => navigation ? upcomingQueueEntries(navigation) : [], [navigation])

  const scrollRef = useRef<HTMLDivElement>(null)
  // 当前歌曲固定在顶部；只在打开时复位，切歌不打断用户正在浏览的待播列表。
  useLayoutEffect(() => {
    if (isOpen && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [isOpen])

  // WAI-ARIA 对话框模式：Esc 关闭（输入框聚焦时除外，避免打断输入）
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      setQueueOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setQueueOpen])

  if (!isOpen) return null

  return (
    <ModalMask
      className="safe-screen fixed inset-0 z-[60] flex justify-end bg-black/50"
      onClose={() => setQueueOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="播放队列"
    >
      <div
        className="safe-area-top safe-area-bottom flex h-full w-full max-w-md flex-col bg-card"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="min-w-0 font-semibold">播放队列（{upcoming.length + playNextQueue.length} 首待播）</h2>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={clearQueue}
              className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="清空"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setQueueOpen(false)}
              className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {currentTrack && (
            <div className="mb-2 border-b border-border pb-2">
              <div className="px-2 pb-1 text-xs text-muted-foreground">{isCurrentTempPlay ? '正在播放 · 插播' : '正在播放'}</div>
              <div aria-current="true" className="flex items-center gap-3 rounded-md bg-accent p-2">
                <CoverImage uid={currentTrack.uid} className="h-10 w-10" />
                <div className="min-w-0">
                  <div className="truncate text-sm text-primary">{currentTrack.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{currentTrack.artist}</div>
                </div>
              </div>
            </div>
          )}
          {/* 手动插播区（"下一首播放"/"加入队列"），优先于主队列播放，播完即出队 */}
          {playNextQueue.length > 0 && (
            <div className="mb-2 border-b border-border pb-2">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-xs font-medium text-muted-foreground">
                  下一首播放（{playNextQueue.length}）
                </span>
                <button
                  onClick={clearPlayNext}
                  className="touch-target flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="清空下一首播放"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {playNextQueue.map((t, i) => (
                <div key={navigation?.manual[i]?.id ?? `manual-${i}`} className="group flex items-center gap-3 rounded-md p-2 hover:bg-accent/50">
                  <button
                    onClick={() => playFromPlayNext(i)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <CoverImage uid={t.uid} className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm">{t.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => removeFromPlayNext(i)}
                    className="touch-target flex items-center justify-center rounded-full text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100"
                    aria-label="移除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {upcoming.length === 0 && playNextQueue.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{currentTrack ? '暂无待播歌曲' : '队列为空'}</div>
          ) : (
            <div aria-label="接下来播放">
              {upcoming.length > 0 && <div className="px-2 pb-1 text-xs text-muted-foreground">接下来播放</div>}
              {upcoming.map(({ entry, kind, index }, i) => (
                <div
                  key={`${kind}-${entry.id}-${i}`}
                  className="group flex items-center gap-3 rounded-md p-2 hover:bg-accent/50"
                >
                  <button
                    onClick={() => kind === 'future' ? playFromFuture(index) : playFromQueue(index)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <CoverImage uid={entry.track.uid} cacheKey={entry.track.musicInfo.img} className="h-10 w-10" />
                    <div className="min-w-0">
                      <div className="truncate text-sm">
                        {entry.track.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{entry.track.artist}</div>
                    </div>
                  </button>
                  <button
                    onClick={() => kind === 'future' ? removeFromFuture(index) : removeFromQueue(index)}
                    className="touch-target flex items-center justify-center rounded-full text-muted-foreground opacity-70 hover:text-foreground focus-visible:opacity-100 hoverable:opacity-0 hoverable:group-hover:opacity-100 hoverable:group-focus-within:opacity-100"
                    aria-label="移除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalMask>
  )
}

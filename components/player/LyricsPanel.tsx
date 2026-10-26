
import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/lib/store/player-store'
import { useAppearanceStore } from '@/lib/store/appearance-store'
import { useFavoritesStore } from '@/lib/store/favorites-store'
import { toast } from '@/lib/toast'
import { useLyrics } from '@/hooks/useLyrics'
import { useLyricsPanel } from '@/hooks/useLyricsPanel'
import { CoverImage } from '@/components/shared/CoverImage'
import { AudioSpectrum } from './AudioSpectrum'
import { ChevronDown, Heart, ListMusic } from 'lucide-react'
import { SeekBar } from './SeekBar'
import { TransportButtons } from './TransportButtons'
import { PlayerButton } from './PlayerButton'
import { MobilePlayerMenu } from './MobilePlayerMenu'
import { PLAYBACK_MODE_CONFIG } from './playback-modes'

interface LyricsPanelProps {
  audio: HTMLAudioElement | null
  onOpenEqualizer?: () => void
}

export function LyricsPanel({ audio, onOpenEqualizer }: LyricsPanelProps) {
  const { isOpen, close } = useLyricsPanel()
  const coverAtmosphere = useAppearanceStore(s => s.coverAtmosphere)
  const track = usePlayerStore(s => s.currentTrack)
  const currentTime = usePlayerStore(s => s.currentTime)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const seek = usePlayerStore(s => s.seek)
  const toggleQueue = usePlayerStore(s => s.toggleQueue)
  const playbackMode = usePlayerStore(s => s.playbackMode)
  const cyclePlaybackMode = usePlayerStore(s => s.cyclePlaybackMode)
  const isFav = useFavoritesStore(s => track ? s.ids.has(track.uid) : false)
  const toggleFavorite = useFavoritesStore(s => s.toggle)
  const { lines, activeIndex, hasLyric, loading } = useLyrics(track?.uid, currentTime)

  const activeRef = useRef<HTMLDivElement>(null)

  // WAI-ARIA 对话框模式：Esc 关闭（歌词面板为全屏页，键盘用户需要退出路径）
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (usePlayerStore.getState().isQueueOpen) return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // 当前行变化 → 平滑滚动到中央
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      })
    }
  }, [activeIndex, isOpen])

  if (!isOpen || !track) return null
  const { icon: ModeIcon, label: modeLabel } = PLAYBACK_MODE_CONFIG[playbackMode]

  return (
    <div
      className={`safe-screen fixed inset-0 z-50 flex flex-col bg-background ${coverAtmosphere ? 'lyrics-atmosphere' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="歌词面板"
    >
      {coverAtmosphere && <div className="lyrics-cover-glow" aria-hidden="true"><CoverImage uid={track.uid} cacheKey={track.musicInfo.img} /></div>}
      {/* 顶部保留返回和次要设置入口，常用操作位于底部。 */}
      <div className="safe-header flex shrink-0 items-center justify-between px-2">
        <button
          onClick={close}
          className="touch-target flex items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="收起歌词"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
        <MobilePlayerMenu onOpenEqualizer={onOpenEqualizer} />
      </div>

      {/* 中部：歌词占据视觉中心 */}
      <div className="lyrics-scroll lyrics-layout flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 py-6 desktop:flex-row desktop:items-center desktop:justify-center desktop:gap-16 desktop:overflow-hidden desktop:px-12 desktop:py-8">
        <div className="mx-auto w-36 shrink-0 text-center desktop:mx-0 desktop:w-[min(30vw,22rem)] desktop:text-left">
          <CoverImage uid={track.uid} cacheKey={track.musicInfo.img} className="aspect-square w-full rounded-2xl shadow-xl" />
          <h2 className="mt-4 text-base font-semibold desktop:text-2xl">{track.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{track.artist}</p>
        </div>
        <div className="lyrics-scroll lyrics-lines min-h-0 w-full px-3 desktop:h-full desktop:max-w-2xl desktop:flex-1 desktop:overflow-y-auto desktop:py-16">
          {loading ? (
            <div className="text-center text-muted-foreground">加载歌词...</div>
          ) : hasLyric ? (
            <div className="mx-auto max-w-2xl space-y-5">
              {lines.map((line, i) => {
                // 纯文本回退行 time 为 NaN：不可点击跳转，样式退化为普通文本
                const seekable = Number.isFinite(line.time)
                return (
                  <div
                    key={i}
                    ref={i === activeIndex ? activeRef : undefined}
                    onClick={seekable ? () => seek(line.time) : undefined}
                    className={`text-center text-xl transition-all ${
                      seekable ? 'cursor-pointer ' : ''
                    }${
                      i === activeIndex
                        ? 'scale-105 font-bold text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {line.text}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center text-muted-foreground">暂无歌词</div>
          )}
        </div>
      </div>

      {/* 常用操作直接可见；进度和播放控制独立成行，适应窄屏。 */}
      <div className="lyrics-controls safe-area-bottom shrink-0 px-5 pt-2 desktop:px-10">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
          <div className="hidden w-full px-10 desktop:block"><AudioSpectrum audio={audio} isPlaying={isPlaying} className="h-3 opacity-70" /></div>
          <div className="flex w-full items-center gap-2"><SeekBar /></div>
          <div className="flex w-full items-center justify-between gap-2">
            <PlayerButton icon={ModeIcon} label={modeLabel} onClick={cyclePlaybackMode} />
            <TransportButtons />
            <PlayerButton icon={ListMusic} label="队列" onClick={toggleQueue} />
          </div>
          <button type="button" aria-label={isFav ? '取消收藏' : '收藏'} aria-pressed={isFav}
            onClick={() => { void toggleFavorite(track.uid).catch(() => toast.error('收藏操作失败，请重试')) }}
            className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm hover:bg-accent ${isFav ? 'text-primary' : 'text-muted-foreground'}`}>
            <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />{isFav ? '已收藏' : '收藏'}
          </button>
        </div>
      </div>
    </div>
  )
}

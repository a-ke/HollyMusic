import { Sun } from 'lucide-react'
import { usePlayerStore } from '@/lib/store/player-store'

export function ScreenWakeLockSetting() {
  const enabled = usePlayerStore(s => s.keepScreenAwake)
  const status = usePlayerStore(s => s.wakeLockStatus)
  const setEnabled = usePlayerStore(s => s.setKeepScreenAwake)
  const description = status === 'unsupported' ? '当前环境不支持，请使用 HTTPS 和支持常亮的浏览器'
    : !enabled ? '仅在前台播放时保持屏幕亮起，会增加耗电'
      : status === 'active' ? '已保持常亮，暂停或切到后台后恢复自动息屏'
        : status === 'error' || status === 'released' ? '系统暂未保持常亮，可关闭后重试'
          : '已开启，将在前台播放时生效'
  return <label className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-border p-3">
    <span>
      <span className="flex items-center gap-2 text-sm font-medium"><Sun className="h-4 w-4" />播放时屏幕常亮</span>
      <span className="mt-1 block text-xs text-muted-foreground" role="status">{description}</span>
    </span>
    <input type="checkbox" role="switch" aria-label="播放时屏幕常亮" checked={enabled}
      disabled={status === 'unsupported' && !enabled} onChange={event => setEnabled(event.target.checked)}
      className="appearance-switch shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" />
  </label>
}

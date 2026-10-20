import { Repeat, Repeat1, Shuffle, type LucideIcon } from 'lucide-react'
import type { PlaybackMode } from '@/lib/types/player'

/** 桌面与手机共用的播放模式展示；键名与已保存的偏好保持一致。 */
export const PLAYBACK_MODE_CONFIG = {
  sequence: { label: '列表循环', icon: Repeat },
  loop: { label: '单曲循环', icon: Repeat1 },
  random: { label: '随机播放', icon: Shuffle },
} satisfies Record<PlaybackMode, { label: string; icon: LucideIcon }>

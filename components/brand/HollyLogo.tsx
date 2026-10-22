import { Music2 } from 'lucide-react'
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings'

interface HollyMarkProps {
  className?: string
}

/** Logo 定稿前沿用原来的通用音符，页面统一从这里引用。 */
export function HollyMark({ className }: HollyMarkProps) {
  return <Music2 className={className} aria-hidden="true" focusable="false" />
}

/** 站名保持文本展示，支持管理员自定义名称。 */
export function HollyBrand({ name = DEFAULT_SITE_SETTINGS.name, compact = false, className = '' }: { name?: string; compact?: boolean; className?: string }) {
  return (
    <span role="img" aria-label={name} title={name} className={`holly-brand inline-flex min-w-0 items-center ${compact ? 'gap-2' : 'gap-2.5'} ${className}`}>
      {compact
        ? <HollyMark className="h-5 w-5 shrink-0 text-primary" />
        : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><HollyMark className="h-5 w-5" /></span>}
      <span className={`truncate text-base ${compact ? 'font-semibold' : 'font-bold tracking-tight'}`}>{name}</span>
    </span>
  )
}

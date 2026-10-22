import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useSiteSettingsStore } from '@/lib/store/site-settings-store'
import { HollyBrand } from '@/components/brand/HollyLogo'
import { AppearanceButton } from './AppearanceSettings'
import { getPageName } from './SiteMetadata'

export function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const { pathname } = useLocation()
  const siteName = useSiteSettingsStore(s => s.settings.name)
  const title = getPageName(pathname) ?? siteName

  return (
    <header className="glass-surface safe-header relative z-10 flex shrink-0 items-center gap-3 border-b border-border px-2 desktop:hidden">
      <button
        onClick={onMenuClick}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-accent"
        aria-label="打开菜单"
      >
        <Menu className="h-5 w-5" />
      </button>
      <HollyBrand name={title} compact />
      <AppearanceButton compact className="ml-auto shrink-0" />
    </header>
  )
}

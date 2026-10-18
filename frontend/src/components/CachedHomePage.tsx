import { useLayoutEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from '../routes/HomePage'

/** 只缓存访问过的首页；独立滚动容器与冻结的路由位置保留列表和筛选状态。 */
export function CachedHomePage() {
  const location = useLocation()
  const active = location.pathname === '/'
  const [savedLocation, setSavedLocation] = useState(active ? location : null)
  const scrollRef = useRef<HTMLElement>(null)
  const scrollTop = useRef(0)

  if (active && savedLocation !== location) setSavedLocation(location)

  useLayoutEffect(() => {
    if (active && scrollRef.current) scrollRef.current.scrollTop = scrollTop.current
  }, [active])

  const homeLocation = active ? location : savedLocation
  if (!homeLocation) return null

  return (
    <main ref={scrollRef} hidden={!active}
      className="app-main min-h-0 min-w-0 flex-1 overflow-y-auto" tabIndex={0} aria-label="首页内容"
      onScroll={event => { if (active) scrollTop.current = event.currentTarget.scrollTop }}>
      <Routes location={homeLocation}>
        <Route path="/" element={<HomePage active={active} />} />
      </Routes>
    </main>
  )
}

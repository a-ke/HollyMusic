import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'

export function AppRouter({ children }: { children: ReactNode }) {
  // 歌词显隐直接由 URL 驱动；持续更新的播放进度不能抢占它的提交。
  return <BrowserRouter useTransitions={false}>{children}</BrowserRouter>
}

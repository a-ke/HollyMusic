import { createContext, useContext } from 'react'

export interface LyricsPanelState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const LyricsPanelContext = createContext<LyricsPanelState>({
  isOpen: false, open: () => {}, close: () => {}, toggle: () => {},
})

/** 面板显隐与操作由应用路由提供，播放器不另存一份展开状态。 */
export function useLyricsPanel(): LyricsPanelState {
  return useContext(LyricsPanelContext)
}

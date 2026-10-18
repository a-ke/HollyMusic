import { useRef, type MouseEvent, type PointerEvent } from 'react'

function isMaskArea<T extends HTMLElement>(event: MouseEvent<T>): boolean {
  if (event.target !== event.currentTarget) return false
  // 原生 dialog 的 ::backdrop 事件会重定向到 dialog；其内部空白和滚动条不算背景。
  if (event.currentTarget.tagName !== 'DIALOG') return true
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientX < rect.left || event.clientX >= rect.right
    || event.clientY < rect.top || event.clientY >= rect.bottom
}

/** 背景按下、松开、点击必须属于同一次指针操作，避免文本选取和跨边界拖动误关闭。 */
export function useMaskClickClose<T extends HTMLElement>(onClose: () => void, closeOnMaskClick = true) {
  const gesture = useRef<{ pointerId: number; started: boolean; ended: boolean | null } | null>(null)
  return {
    onPointerDownCapture: (event: PointerEvent<T>) => {
      gesture.current = { pointerId: event.pointerId, started: closeOnMaskClick && event.button === 0
        && event.isPrimary !== false && isMaskArea(event), ended: null }
    },
    onPointerUpCapture: (event: PointerEvent<T>) => {
      const current = gesture.current
      if (current) current.ended = current.pointerId === event.pointerId && isMaskArea(event)
    },
    onPointerCancelCapture: () => { gesture.current = null },
    onClick: (event: MouseEvent<T>) => {
      const current = gesture.current
      // 原生 ::backdrop 的 pointerup 可能未经过 dialog，最终 click 的坐标仍能判断是否在遮罩上。
      const releasedOnMask = current?.ended === true
        || (current?.ended === null && event.currentTarget.tagName === 'DIALOG')
      const shouldClose = current?.started && releasedOnMask && isMaskArea(event)
      gesture.current = null
      if (shouldClose && closeOnMaskClick) onClose()
    },
  }
}

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

const DEFAULT_ROW_HEIGHT = 60
const DEFAULT_OVERSCAN = 8
const VIRTUAL_THRESHOLD = 60

export interface VirtualListProps<T> {
  items: readonly T[]
  renderItem: (item: T, index: number) => ReactNode
  itemKey: (item: T, index: number) => string | number
  /** 等高行的初始估值；挂载后按实际行高校准，支持字体和窗口大小变化。 */
  estimateRowHeight?: number
  gap?: number
  overscan?: number
  className?: string
  /** 不传时自动复用最近的滚动容器，页面内不额外嵌套滚动条。 */
  scrollParentRef?: RefObject<HTMLElement | null>
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement
  while (parent && parent !== document.body) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

/** 等高行虚拟列表：完整占位高度 + 可视区域窗口，播放/分页等业务由调用方提供。 */
export function VirtualList<T>(props: VirtualListProps<T>) {
  if (props.items.length <= VIRTUAL_THRESHOLD) {
    return <div className={props.className} role="list" style={{ display: 'flex', flexDirection: 'column', gap: props.gap ?? 0 }}>
      {props.items.map((item, index) => <div key={props.itemKey(item, index)} role="listitem">{props.renderItem(item, index)}</div>)}
    </div>
  }
  return <VirtualWindow {...props} />
}

function VirtualWindow<T>({ items, renderItem, itemKey, estimateRowHeight = DEFAULT_ROW_HEIGHT,
  gap = 0, overscan = DEFAULT_OVERSCAN, className, scrollParentRef }: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [windowState, setWindowState] = useState(() => ({
    start: 0,
    end: Math.min(items.length, Math.ceil((typeof window === 'undefined' ? 768 : window.innerHeight) / (estimateRowHeight + gap)) + overscan),
    rowHeight: estimateRowHeight,
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scrollParent = scrollParentRef?.current ?? findScrollParent(container)
    const scrollTarget = scrollParent ?? window
    let frame: number | null = null
    let disposed = false

    const measure = () => {
      frame = null
      if (disposed) return
      const rowHeight = rowRef.current?.getBoundingClientRect().height || estimateRowHeight
      const stride = rowHeight + gap
      const scrollBounds = scrollParent?.getBoundingClientRect()
      const viewportHeight = scrollParent?.clientHeight || scrollBounds?.height || window.innerHeight
      const top = (scrollBounds?.top ?? 0) - container.getBoundingClientRect().top
      const start = Math.max(0, Math.min(items.length - 1, Math.floor(top / stride) - overscan))
      const end = Math.min(items.length, Math.max(start + 1, Math.ceil((top + viewportHeight) / stride) + overscan))
      setWindowState(previous => previous.start === start && previous.end === end && previous.rowHeight === rowHeight
        ? previous : { start, end, rowHeight })
    }
    const scheduleMeasure = () => { if (frame === null) frame = requestAnimationFrame(measure) }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(container)
    if (scrollParent) observer?.observe(scrollParent)
    // 首次测量与 ResizeObserver 使用同一帧队列，避免重复布局读取。
    scheduleMeasure()
    scrollTarget.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      scrollTarget.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [items.length, estimateRowHeight, gap, overscan, scrollParentRef])

  // 字体/响应式样式可能改变行高；滚动窗口变化后继续观察当前第一行。
  useEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const height = row.getBoundingClientRect().height
      if (height > 0) setWindowState(previous => previous.rowHeight === height ? previous : { ...previous, rowHeight: height })
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [windowState.start])

  const start = Math.min(windowState.start, items.length - 1)
  const end = Math.min(items.length, Math.max(start + 1, windowState.end))
  const stride = windowState.rowHeight + gap
  return <div ref={containerRef} className={className} role="list"
    style={{ position: 'relative', height: items.length * stride - gap, overflowAnchor: 'none' }}>
    {items.slice(start, end).map((item, offset) => {
      const index = start + offset
      return <div key={itemKey(item, index)} ref={offset === 0 ? rowRef : undefined} role="listitem"
        aria-posinset={index + 1} aria-setsize={items.length}
        style={{ position: 'absolute', top: index * stride, left: 0, right: 0 }}>
        {renderItem(item, index)}
      </div>
    })}
  </div>
}

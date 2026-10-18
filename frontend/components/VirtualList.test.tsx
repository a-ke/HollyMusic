import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VirtualList } from '@/components/shared/VirtualList'
import { mockVirtualLayout, scrollList } from './virtual-list-test-utils'

let root: Root
let container: HTMLDivElement
let layout: ReturnType<typeof mockVirtualLayout>
const items = Array.from({ length: 2000 }, (_, index) => index)
const renderItem = (item: number) => <button data-item={item}>{item}</button>
const itemKey = (item: number) => item
async function mount(values = items) {
  await act(async () => {
    root.render(<main className="app-main" style={{ overflowY: 'auto' }}>
      <div style={{ height: 240 }}>页头</div>
      <VirtualList items={values} renderItem={renderItem} itemKey={itemKey} gap={2} className="virtual-test" />
    </main>)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  layout = mockVirtualLayout()
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  layout.restore()
  vi.unstubAllGlobals()
})

it('一开始占据全量高度，直接拖到底部可见最后一项，DOM 数量保持有界', async () => {
  await mount()
  const list = container.querySelector<HTMLElement>('.virtual-test')!
  expect(list.style.height).toBe('123998px')
  expect(container.querySelectorAll('[data-item]').length).toBeLessThan(60)
  await scrollList(container, 240 + 123998 - 620)
  expect(container.querySelector('[data-item="1999"]')).not.toBeNull()
  expect(container.querySelector('[data-item="0"]')).toBeNull()
  expect(list.style.height).toBe('123998px')
  expect(container.querySelectorAll('[data-item]').length).toBeLessThan(60)
  expect(container.querySelector('[aria-posinset="2000"]')?.getAttribute('aria-setsize')).toBe('2000')
  await scrollList(container, 0)
  expect(container.querySelector('[data-item="0"]')).not.toBeNull()
})

it('考虑列表前的页头偏移，拖到中间保持索引正确', async () => {
  await mount()
  await scrollList(container, 240 + 1000 * 62)
  expect(container.querySelector('[data-item="1000"]')).not.toBeNull()
  expect(container.querySelector('[data-item="0"]')).toBeNull()
})

it('没有 ResizeObserver 时仍支持滚动，小列表正常完整展示', async () => {
  vi.stubGlobal('ResizeObserver', undefined)
  await mount()
  await scrollList(container, 240 + 1500 * 62)
  expect(container.querySelector('[data-item="1500"]')).not.toBeNull()
  await mount([0, 1, 2])
  expect(container.querySelectorAll('[data-item]')).toHaveLength(3)
  expect(container.querySelector<HTMLElement>('.virtual-test')!.style.height).toBe('')
})

it('深处滚动后替换更短的数据，仍能显示有效条目', async () => {
  await mount()
  await scrollList(container, 240 + 1000 * 62)
  await mount(items.slice(0, 100))
  expect(container.querySelector('[data-item="99"]')).not.toBeNull()
  expect(container.querySelector('[data-item="1000"]')).toBeNull()
})

it('响应式行高变化后重新计算完整高度和行位置', async () => {
  await mount()
  layout.setRowHeight(80)
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
  expect(container.querySelector<HTMLElement>('.virtual-test')!.style.height).toBe('163998px')
  await scrollList(container, 240 + 1000 * 82)
  const row = container.querySelector<HTMLElement>('[data-item="1000"]')!.parentElement!
  expect(row.style.top).toBe('82000px')
})

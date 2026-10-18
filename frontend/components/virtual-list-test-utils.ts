import { act } from 'react'
import { vi } from 'vitest'

/** JSDOM 没有布局引擎，为虚拟列表提供带页头和外层滚动的真实坐标关系。 */
export function mockVirtualLayout({ headerHeight = 240, viewportHeight = 620, rowHeight = 60 } = {}) {
  let measuredRowHeight = rowHeight
  const original = HTMLElement.prototype.getBoundingClientRect
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.app-main')) return new DOMRect(0, 100, 400, viewportHeight)
    if (this.matches('.track-list, .virtual-test')) {
      const parent = this.closest<HTMLElement>('.app-main')
      return new DOMRect(0, 100 + headerHeight - (parent?.scrollTop ?? 0), 400, Number.parseFloat(this.style.height) || 0)
    }
    if (this.getAttribute('role') === 'listitem') return new DOMRect(0, 0, 400, measuredRowHeight)
    return original.call(this)
  })
  return { restore: () => bounds.mockRestore(), setRowHeight: (height: number) => { measuredRowHeight = height } }
}

export async function scrollList(container: HTMLElement, scrollTop: number) {
  const parent = container.querySelector<HTMLElement>('.app-main')!
  await act(async () => {
    parent.scrollTop = scrollTop
    parent.dispatchEvent(new Event('scroll'))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })
}

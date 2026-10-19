import { act, createRef, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Modal, type ModalProps } from '@/components/shared/Modal'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(props: Partial<ModalProps> = {}) {
  const onClose = vi.fn()
  await act(async () => root.render(<Modal open title="测试弹窗" onClose={onClose} {...props}><input aria-label="输入" /><button>内容操作</button></Modal>))
  return onClose
}
function pointer(target: Element, type: string) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
}
function clickMask(mask: Element) {
  pointer(mask, 'pointerdown'); pointer(mask, 'pointerup'); pointer(mask, 'click')
}

it('受控打开关闭，提供标题描述和独立滚动区，清理不会重复通知关闭', async () => {
  const onClose = vi.fn()
  await render({ open: false, onClose })
  expect(container.querySelector('dialog')).toBeNull()
  await render({ onClose, description: '帮助说明', footer: <button>保存</button> })
  const dialog = container.querySelector('dialog')!
  expect(dialog.open).toBe(true)
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('测试弹窗')
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('帮助说明')
  expect(container.querySelector('.overflow-y-auto')?.textContent).toContain('内容操作')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click())
  expect(onClose).toHaveBeenCalledTimes(1)
  await render({ open: false, onClose })
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(document.body.classList.contains('modal-scroll-locked')).toBe(false)
})

it('完整点击实际遮罩关闭，正文拖选到遮罩不关闭', async () => {
  const close = await render()
  const mask = container.querySelector('[data-modal-mask]')!
  const content = container.querySelector('input')!
  await act(async () => { pointer(content, 'pointerdown'); pointer(mask, 'pointerup'); pointer(mask, 'click') })
  expect(close).not.toHaveBeenCalled()
  await act(async () => clickMask(mask))
  expect(close).toHaveBeenCalledTimes(1)
})

it('Escape 关闭且不向播放器传播，原生 cancel 也受配置控制', async () => {
  const onClose = await render()
  const listener = vi.fn()
  window.addEventListener('keydown', listener)
  try {
    await act(async () => container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    const disabledClose = await render({ closeOnEscape: false })
    await act(async () => container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(disabledClose).not.toHaveBeenCalled()
  } finally { window.removeEventListener('keydown', listener) }
})

it('支持禁用遮罩关闭，忙碌状态统一禁止遮罩、Escape 和关闭按钮', async () => {
  const onClose = await render({ closeOnMaskClick: false })
  await act(async () => clickMask(container.querySelector('[data-modal-mask]')!))
  expect(onClose).not.toHaveBeenCalled()
  await render({ onClose, closeDisabled: true })
  await act(async () => {
    clickMask(container.querySelector('[data-modal-mask]')!)
    container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.click()
  })
  expect(onClose).not.toHaveBeenCalled()
  expect(container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!.disabled).toBe(true)
})

it('打开后可指定焦点，Tab 首尾循环，关闭后恢复到触发按钮', async () => {
  const inputRef = createRef<HTMLInputElement>()
  const view = (open: boolean) => <><button data-trigger>打开</button><Modal open={open} title="焦点" onClose={() => {}} initialFocusRef={inputRef}>
    <input ref={inputRef} /><button data-last>最后一个操作</button>
  </Modal></>
  await act(async () => root.render(view(false)))
  const trigger = container.querySelector<HTMLButtonElement>('[data-trigger]')!
  trigger.focus()
  await act(async () => root.render(view(true)))
  expect(document.activeElement).toBe(inputRef.current)
  const first = container.querySelector<HTMLButtonElement>('[aria-label="关闭弹窗"]')!
  const last = container.querySelector<HTMLButtonElement>('[data-last]')!
  last.focus()
  await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(last)
  await act(async () => root.render(view(false)))
  expect(document.activeElement).toBe(trigger)
})

it('嵌套弹窗关闭内层后继续锁定背景，Escape 不影响外层', async () => {
  const outerClose = vi.fn()
  const innerClose = vi.fn()
  const view = (inner: boolean) => <Modal open title="外层" onClose={outerClose}>
    <button>外层操作</button><Modal open={inner} title="内层" onClose={innerClose}><input /></Modal>
  </Modal>
  await act(async () => root.render(view(false)))
  await act(async () => root.render(view(true)))
  const dialogs = container.querySelectorAll('dialog')
  await act(async () => dialogs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(innerClose).toHaveBeenCalledTimes(1)
  expect(outerClose).not.toHaveBeenCalled()
  await act(async () => root.render(view(false)))
  expect(document.body.classList.contains('modal-scroll-locked')).toBe(true)
  await act(async () => root.render(null))
  expect(document.body.classList.contains('modal-scroll-locked')).toBe(false)
})

it('不覆盖其他组件更新的 body overflow，StrictMode 重建不产生关闭回调', async () => {
  const close = vi.fn()
  const previous = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  try {
    await act(async () => root.render(<StrictMode><Modal open title="设置" onClose={close}><input /></Modal></StrictMode>))
    expect(close).not.toHaveBeenCalled()
    document.body.style.overflow = 'auto'
    await act(async () => root.render(null))
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.classList.contains('modal-scroll-locked')).toBe(false)
    expect(close).not.toHaveBeenCalled()
  } finally { document.body.style.overflow = previous }
})

it('跟随手机软键盘可视区域缩放，关闭后移除监听', async () => {
  const viewport = Object.assign(new EventTarget(), { height: 640, offsetTop: 0 })
  vi.stubGlobal('visualViewport', viewport)
  await render()
  const dialog = container.querySelector('dialog')!
  expect(dialog.style.getPropertyValue('--modal-viewport-height')).toBe('640px')
  await act(async () => {
    Object.assign(viewport, { height: 320, offsetTop: 20 })
    viewport.dispatchEvent(new Event('resize'))
  })
  expect(dialog.style.getPropertyValue('--modal-viewport-height')).toBe('320px')
  expect(dialog.style.getPropertyValue('--modal-viewport-top')).toBe('20px')
  await act(async () => root.render(null))
  Object.assign(viewport, { height: 600 })
  viewport.dispatchEvent(new Event('resize'))
  expect(dialog.style.getPropertyValue('--modal-viewport-height')).toBe('320px')
})

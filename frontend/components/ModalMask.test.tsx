import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ModalMask } from '@/components/shared/ModalMask'
import { useMaskClickClose } from '@/hooks/useMaskClickClose'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function NativeDialog({ onClose, closeOnMaskClick }: { onClose: () => void; closeOnMaskClick?: boolean }) {
  const events = useMaskClickClose<HTMLDialogElement>(onClose, closeOnMaskClick)
  return <dialog {...events}><section onPointerDown={event => event.stopPropagation()}>可选中的文字</section></dialog>
}
function pointer(target: Element, type: string, id = 1, inside = false, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, button, clientX: inside ? 150 : 50, clientY: inside ? 150 : 50 })
  Object.defineProperty(event, 'pointerId', { value: id })
  target.dispatchEvent(event)
}

describe.each(['div', 'dialog'] as const)('%s 背景层', kind => {
  async function setup(closeOnMaskClick?: boolean) {
    const onClose = vi.fn()
    await act(async () => root.render(kind === 'div'
      ? <ModalMask onClose={onClose} closeOnMaskClick={closeOnMaskClick}><section onPointerDown={event => event.stopPropagation()}>可选中的文字</section></ModalMask>
      : <NativeDialog onClose={onClose} closeOnMaskClick={closeOnMaskClick} />))
    const mask = container.firstElementChild!
    const content = mask.firstElementChild!
    vi.spyOn(mask, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect)
    return { mask, content, onClose }
  }

  it('直接点击背景关闭，右键或未完成指针操作的 click 不关闭', async () => {
    const { mask, onClose } = await setup()
    await act(async () => {
      pointer(mask, 'click')
      pointer(mask, 'pointerdown', 1, false, 2)
      pointer(mask, 'pointerup', 1, false, 2)
      pointer(mask, 'click', 1, false, 2)
    })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { pointer(mask, 'pointerdown'); pointer(mask, 'pointerup'); pointer(mask, 'click') })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('内容选取拖到背景和背景拖到内容都不关闭，子元素停止冒泡也能识别起点', async () => {
    const { mask, content, onClose } = await setup()
    await act(async () => {
      pointer(content, 'pointerdown', 1, true)
      pointer(mask, 'pointerup')
      pointer(mask, 'click')
      pointer(mask, 'pointerdown')
      pointer(content, 'pointerup', 1, true)
      pointer(mask, 'click')
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('指针取消或另一根手指松开不关闭', async () => {
    const { mask, onClose } = await setup()
    await act(async () => {
      pointer(mask, 'pointerdown')
      pointer(mask, 'pointercancel')
      pointer(mask, 'pointerup')
      pointer(mask, 'click')
      pointer(mask, 'pointerdown', 1)
      pointer(mask, 'pointerup', 2)
      pointer(mask, 'click')
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('禁止背景关闭时保留弹窗', async () => {
    const { mask, onClose } = await setup(false)
    await act(async () => { pointer(mask, 'pointerdown'); pointer(mask, 'pointerup'); pointer(mask, 'click') })
    expect(onClose).not.toHaveBeenCalled()
  })
})

it('嵌套弹窗只关闭内层，外层保持打开', async () => {
  const outer = vi.fn()
  const inner = vi.fn()
  await act(async () => root.render(<ModalMask onClose={outer}>
    <section><ModalMask onClose={inner}><section>内层内容</section></ModalMask></section>
  </ModalMask>))
  const mask = container.querySelector('section > div')!
  await act(async () => { pointer(mask, 'pointerdown'); pointer(mask, 'pointerup'); pointer(mask, 'click') })
  expect(inner).toHaveBeenCalledTimes(1)
  expect(outer).not.toHaveBeenCalled()
})

it('原生 dialog 内部空白区域不被当成背景', async () => {
  const onClose = vi.fn()
  await act(async () => root.render(<NativeDialog onClose={onClose} />))
  const dialog = container.querySelector('dialog')!
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect)
  await act(async () => { pointer(dialog, 'pointerdown', 1, true); pointer(dialog, 'pointerup', 1, true); pointer(dialog, 'click', 1, true) })
  expect(onClose).not.toHaveBeenCalled()
})

it('原生 dialog 遮罩未捕获到 pointerup 时，完整的外部点击仍可关闭', async () => {
  const onClose = vi.fn()
  await act(async () => root.render(<NativeDialog onClose={onClose} />))
  const dialog = container.querySelector('dialog')!
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect)
  await act(async () => { pointer(dialog, 'pointerdown'); pointer(dialog, 'click', 1, true) })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { pointer(dialog.querySelector('section')!, 'pointerdown', 1, true); pointer(dialog, 'click') })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { pointer(dialog, 'pointerdown'); pointer(dialog, 'click') })
  expect(onClose).toHaveBeenCalledTimes(1)
})

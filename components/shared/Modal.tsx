import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModalMask } from './ModalMask'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnMaskClick?: boolean
  closeOnEscape?: boolean
  closeDisabled?: boolean
  closeButtonLabel?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  bodyClassName?: string
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' }
const scrollLocks = new WeakMap<Document, { count: number; unlock: () => void }>()

/** 用独立样式锁定滚动，避免覆盖移动侧栏等组件正在维护的 inline overflow。 */
function lockScroll(doc: Document): () => void {
  const existing = scrollLocks.get(doc)
  if (existing) {
    existing.count++
  } else {
    const win = doc.defaultView!
    const { scrollX, scrollY } = win
    const body = doc.body
    const hadClass = body.classList.contains('modal-scroll-locked')
    const offset = body.style.getPropertyValue('--modal-scroll-offset')
    body.style.setProperty('--modal-scroll-offset', `${-scrollY}px`)
    body.classList.add('modal-scroll-locked')
    scrollLocks.set(doc, { count: 1, unlock: () => {
      if (!hadClass) body.classList.remove('modal-scroll-locked')
      if (offset) body.style.setProperty('--modal-scroll-offset', offset)
      else body.style.removeProperty('--modal-scroll-offset')
      if (win.scrollX !== scrollX || win.scrollY !== scrollY) win.scrollTo(scrollX, scrollY)
    } })
  }
  return () => {
    const lock = scrollLocks.get(doc)
    if (lock && --lock.count === 0) { scrollLocks.delete(doc); lock.unlock() }
  }
}

function focusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
  )].filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
}

/** 原生 top layer 负责层级和背景 inert；实际遮罩使用 ModalMask，统一点击与拖选判定。 */
export function Modal({
  open, onClose, title, description, eyebrow, children, footer, size = 'md',
  closeOnMaskClick = true, closeOnEscape = true, closeDisabled = false,
  closeButtonLabel = '关闭弹窗', initialFocusRef, className, bodyClassName,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const activeRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current!
    const doc = dialog.ownerDocument
    const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
    const unlock = lockScroll(doc)
    const viewport = doc.defaultView?.visualViewport
    const syncViewport = () => {
      if (!viewport) return
      dialog.style.setProperty('--modal-viewport-height', `${viewport.height}px`)
      dialog.style.setProperty('--modal-viewport-top', `${viewport.offsetTop}px`)
    }
    syncViewport()
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)
    activeRef.current = true
    if (!dialog.open) dialog.showModal()
    ;(initialFocusRef?.current ?? closeButtonRef.current ?? panelRef.current)?.focus({ preventScroll: true })
    return () => {
      activeRef.current = false
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      if (dialog.open) dialog.close()
      unlock()
      if (previousFocus?.isConnected && !previousFocus.closest('dialog:not([open])')) previousFocus.focus({ preventScroll: true })
    }
  }, [open, initialFocusRef])

  const requestClose = () => { if (!closeDisabled) onClose() }
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (closeOnEscape) requestClose()
    } else if (event.key === 'Tab') {
      const dialog = dialogRef.current!
      const elements = focusableElements(dialog)
      const first = elements[0]
      const last = elements[elements.length - 1]
      const focused = dialog.ownerDocument.activeElement
      if (!first) { event.preventDefault(); panelRef.current?.focus() }
      else if (event.shiftKey && (focused === first || !elements.includes(focused as HTMLElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (focused === last || !elements.includes(focused as HTMLElement))) {
        event.preventDefault(); first.focus()
      }
    }
  }

  if (!open) return null
  return <dialog
    ref={dialogRef} className="modal-root" aria-modal="true" aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onKeyDown={handleKeyDown}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (closeOnEscape) requestClose() }}
    onClose={event => { if (event.target === event.currentTarget && activeRef.current && !event.currentTarget.open) onClose() }}
  >
    <ModalMask onClose={requestClose} closeOnMaskClick={closeOnMaskClick && !closeDisabled}
      data-modal-mask className="modal-mask safe-dialog-backdrop absolute inset-0 flex items-center justify-center">
      <div ref={panelRef} tabIndex={-1} className={cn('modal-panel flex max-h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none', SIZES[size], className)}>
        <div className="shrink-0 px-5 pb-5 pt-5 sm:px-7 sm:pt-7">
          {eyebrow && <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-widest text-primary">{eyebrow}</div>}
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 id={titleId} className="min-w-0 break-words text-xl font-semibold sm:text-2xl">{title}</h2>
            <button ref={closeButtonRef} type="button" onClick={requestClose} disabled={closeDisabled} aria-label={closeButtonLabel}
              className="touch-target flex shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"><X className="h-5 w-5" /></button>
          </div>
          {description && <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className={cn('min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-7 sm:pb-7', bodyClassName)}>{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-7">{footer}</div>}
      </div>
    </ModalMask>
  </dialog>
}

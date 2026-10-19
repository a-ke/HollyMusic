import type { HTMLAttributes } from 'react'
import { useMaskClickClose } from '@/hooks/useMaskClickClose'

type Props = Omit<HTMLAttributes<HTMLDivElement>,
  'onClose' | 'onClick' | 'onPointerDownCapture' | 'onPointerUpCapture' | 'onPointerCancelCapture'> & {
  onClose: () => void
  closeOnMaskClick?: boolean
}

/** 统一弹窗、抽屉和底部操作面板的背景关闭行为，不改变布局和显式关闭按钮。 */
export function ModalMask({ onClose, closeOnMaskClick = true, ...props }: Props) {
  const events = useMaskClickClose<HTMLDivElement>(onClose, closeOnMaskClick)
  return <div {...props} {...events} />
}

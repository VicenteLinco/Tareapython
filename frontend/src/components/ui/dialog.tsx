import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
  closeOnBackdrop?: boolean
}

export function Dialog({ open, onClose, title, children, className, closeOnBackdrop = true }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || closeOnBackdrop) return
    const onCancel = (e: Event) => e.preventDefault()
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [closeOnBackdrop])

  return (
    <dialog
      ref={dialogRef}
      className={cn('modal', open && 'modal-open')}
      onClose={onClose}
      onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
    >
      <div className={cn('modal-box max-w-lg', className)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  )
}

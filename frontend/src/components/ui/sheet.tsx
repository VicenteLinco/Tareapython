import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-250',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          'sheet-panel fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-base-200 bg-base-100 shadow-2xl',
          open ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-base-200 px-6 h-[60px]">
            <h2 className="text-base font-semibold truncate pr-4">{title}</h2>
            <button onClick={onClose} className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto p-6" style={{ height: title ? 'calc(100% - 60px)' : '100%' }}>
          {children}
        </div>
      </div>
    </>
  )
}

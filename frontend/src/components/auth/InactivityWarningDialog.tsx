import { useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'

interface Props {
  open: boolean
  secondsLeft: number
  onContinue: () => void
}

export function InactivityWarningDialog({ open, secondsLeft, onContinue }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Bloquear cierre con Escape
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (e: Event) => e.preventDefault()
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const countdown = `${minutes}:${String(seconds).padStart(2, '0')}`

  return (
    <dialog ref={dialogRef} className="modal">
      {/* Sin onClick en el backdrop — no cierra con click afuera */}
      <div className="modal-box max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
            <Clock className="h-7 w-7 text-warning" />
          </div>
        </div>
        <h3 className="font-bold text-lg mb-2">¿Sigues ahí?</h3>
        <p className="text-sm text-base-content/60 mb-1">
          Por seguridad, tu sesión se cerrará automáticamente.
        </p>
        <p className="text-3xl font-mono font-bold text-warning my-4">{countdown}</p>
        <button
          className="btn btn-primary w-full"
          onClick={onContinue}
        >
          Sí, continuar
        </button>
      </div>
    </dialog>
  )
}

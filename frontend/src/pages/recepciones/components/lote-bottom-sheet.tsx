// frontend/src/pages/recepciones/components/lote-bottom-sheet.tsx
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LoteBottomSheetProps {
  open: boolean
  productoNombre: string
  // When set (GS1 scan with lot but no expiry), the lot is locked and we ask only the expiry.
  prefillNumeroLote?: string
  onConfirm: (data: { numero_lote: string; fecha_vencimiento: string; cantidad: number }) => void
  onCancel: () => void
}

export function LoteBottomSheet({ open, productoNombre, prefillNumeroLote, onConfirm, onCancel }: LoteBottomSheetProps) {
  const [numeroLote, setNumeroLote] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const loteRef = useRef<HTMLInputElement>(null)
  const fechaRef = useRef<HTMLInputElement>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  const loteLocked = !!prefillNumeroLote

  // Resetear y enfocar al abrir
  useEffect(() => {
    if (open) {
      setNumeroLote(prefillNumeroLote ?? '')
      setFechaVencimiento('')
      setCantidad(1)
      // Pequeño delay para que la animación se vea antes del focus.
      // Con lote prellenado (GS1) saltamos directo al vencimiento.
      const t = setTimeout(() => (loteLocked ? fechaRef.current : loteRef.current)?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [open, prefillNumeroLote, loteLocked])

  const canConfirm = numeroLote.trim().length > 0 && fechaVencimiento.length > 0

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm({
      numero_lote: numeroLote.trim(),
      fecha_vencimiento: fechaVencimiento,
      cantidad,
    })
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onCancel}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-base-100 rounded-t-3xl shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-base-300" />
        </div>

        <div className="px-5 pb-8 pt-2 space-y-4">
          {/* Encabezado */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs opacity-40 uppercase tracking-widest">Producto detectado</p>
              <h3 className="font-bold text-base leading-snug mt-0.5">{productoNombre}</h3>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle -mt-1"
              onClick={onCancel}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Campos */}
          <div className="space-y-3">
            <div>
              <label className="label py-0.5">
                <span className="label-text text-xs font-semibold">Número de lote *</span>
                {loteLocked && (
                  <span className="label-text-alt text-xs text-success">Detectado por escaneo</span>
                )}
              </label>
              <input
                ref={loteRef}
                className={`input input-bordered input-sm w-full font-mono ${loteLocked ? 'input-disabled' : ''}`}
                placeholder="Ej: LOT-240115"
                value={numeroLote}
                readOnly={loteLocked}
                onChange={e => setNumeroLote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); fechaRef.current?.focus() }
                }}
              />
            </div>

            <div>
              <label className="label py-0.5">
                <span className="label-text text-xs font-semibold">Fecha de vencimiento *</span>
              </label>
              <input
                ref={fechaRef}
                type="date"
                className="input input-bordered input-sm w-full"
                value={fechaVencimiento}
                onChange={e => setFechaVencimiento(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); cantidadRef.current?.focus() }
                }}
              />
            </div>

            <div>
              <label className="label py-0.5">
                <span className="label-text text-xs font-semibold">Cantidad</span>
              </label>
              <input
                ref={cantidadRef}
                type="number"
                min={1}
                className="input input-bordered input-sm w-full"
                value={cantidad}
                onChange={e => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleConfirm() }
                }}
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Saltar
            </Button>
            <Button
              className="flex-1"
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              Agregar ítem
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// frontend/src/pages/recepciones/components/ReconciliacionModal.tsx
import { cn } from '@/lib/utils'
import type { DetalleLineUI } from './item-card'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SolicitudItemSimple {
  producto_id: string
  producto_nombre: string
  cantidad_base: number
  unidad: string
}

interface Props {
  open: boolean
  onClose: () => void
  solicitudItems: SolicitudItemSimple[]
  detalles: DetalleLineUI[]
  onConfirmar: (payload: unknown) => void
  pendingPayload: unknown | null
  nota: string
  onNotaChange: (nota: string) => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ReconciliacionModal({
  open,
  onClose,
  solicitudItems,
  detalles,
  onConfirmar,
  pendingPayload,
  nota,
  onNotaChange,
}: Props) {
  if (!open || !pendingPayload) return null

  // Calcular recibido por producto_id
  const recibidoMap: Record<string, number> = {}
  detalles.forEach(d => {
    const total = d.lotes.reduce((s, l) => s + (l.cantidad_presentacion * d.factor_conversion), 0)
    recibidoMap[d.producto_id] = (recibidoMap[d.producto_id] ?? 0) + total
  })

  const filas = solicitudItems.map(si => {
    const recibido = recibidoMap[si.producto_id] ?? 0
    const diff = si.cantidad_base > 0 ? Math.abs(recibido - si.cantidad_base) / si.cantidad_base : 0
    return { ...si, recibido, diff, critico: diff > 0.10 }
  })

  const hayCriticos = filas.some(f => f.critico)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-base-100 rounded-3xl shadow-2xl w-full max-w-lg border border-base-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-base-200">
          <h2 className="font-bold text-base">Comparar con solicitud vinculada</h2>
          <p className="text-xs opacity-50 mt-0.5">Revisa las diferencias antes de confirmar la recepción.</p>
        </div>
        <div className="px-6 py-4 space-y-2 max-h-72 overflow-y-auto">
          {filas.map(f => (
            <div key={f.producto_id} className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-xl border',
              f.critico ? 'bg-warning/5 border-warning/30' : 'bg-base-200/30 border-transparent'
            )}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{f.producto_nombre}</p>
                <p className="text-[10px] opacity-40">{f.unidad}</p>
              </div>
              <div className="text-right text-xs tabular-nums">
                <span className="opacity-50">Pedido: {Math.round(f.cantidad_base)}</span>
                <span className="mx-1.5 opacity-30">·</span>
                <span className="font-bold">Llegó: {Math.round(f.recibido)}</span>
              </div>
              {f.critico && (
                <span className="text-[9px] font-black text-warning bg-warning/15 px-1.5 py-0.5 rounded-full shrink-0">
                  {Math.round(f.diff * 100)}% dif.
                </span>
              )}
            </div>
          ))}
        </div>
        {hayCriticos && (
          <div className="px-6 pb-2">
            <p className="text-xs font-bold text-warning mb-1">Discrepancia &gt;10% — explica el motivo:</p>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full text-xs rounded-xl"
              placeholder="Ej: Proveedor entregó menos unidades por quiebre de stock…"
              rows={2}
              value={nota}
              onChange={e => onNotaChange(e.target.value)}
            />
          </div>
        )}
        <div className="px-6 py-4 border-t border-base-200 flex gap-2">
          <button className="btn btn-ghost btn-sm flex-1 rounded-xl" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary btn-sm flex-1 rounded-xl"
            disabled={hayCriticos && !nota.trim()}
            onClick={() => onConfirmar(pendingPayload)}
          >
            Confirmar recepción
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { cn, formatCantidad, formatDate } from '@/lib/utils'

export interface LoteDisponible {
  lote_id: string
  numero_lote: string
  stock: number
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
}

interface LoteSelectorProps {
  lotes: LoteDisponible[]
  cargandoLotes: boolean
  loteElegidoId: string | null  // null = FEFO automático
  unidad: string
  unidad_plural: string
  onChange: (loteId: string | null) => void
}

export function LoteSelector({ lotes, cargandoLotes, loteElegidoId, unidad, unidad_plural, onChange }: LoteSelectorProps) {
  const [open, setOpen] = useState(false)

  if (cargandoLotes) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-base-content/40">
        <span className="loading loading-spinner loading-xs" />
        <span>Cargando lotes…</span>
      </div>
    )
  }

  if (lotes.length === 0) {
    return (
      <p className="text-[11px] text-warning/80 font-medium">Sin lotes disponibles para esta área</p>
    )
  }

  // No mostrar selector si hay exactamente 1 lote (sin elección real)
  if (lotes.length === 1) return null

  const loteActual = lotes.find(l => l.lote_id === loteElegidoId)
  const label = loteActual ? loteActual.numero_lote : 'FEFO automático'

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-base-content/50 hover:text-base-content/80 transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
      >
        {!loteActual && <Sparkles className="h-3 w-3 text-success" />}
        <span className="font-medium">{label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-20 bg-base-100 border border-base-200 rounded-xl shadow-lg min-w-[200px] overflow-hidden">
          {/* Opción FEFO */}
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-base-200 transition-colors text-left',
              loteElegidoId === null && 'bg-success/10 text-success font-semibold'
            )}
            onClick={() => { onChange(null); setOpen(false) }}
          >
            <Sparkles className="h-3 w-3 flex-shrink-0" />
            <div>
              <div>FEFO automático</div>
              <div className="text-base-content/40 font-normal">El sistema elige el lote</div>
            </div>
          </button>
          <div className="border-t border-base-200" />
          {lotes.map(l => {
            const stockLabel = formatCantidad(l.stock, unidad, unidad_plural)
            return (
              <button
                key={l.lote_id}
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-base-200 transition-colors text-left',
                  loteElegidoId === l.lote_id && 'bg-primary/10 text-primary font-semibold'
                )}
                onClick={() => { onChange(l.lote_id); setOpen(false) }}
              >
                <div className="flex-1">
                  <div className="font-mono">{l.numero_lote}</div>
                  <div className="text-base-content/40 font-normal">{stockLabel} · vence {formatDate(l.fecha_vencimiento)}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

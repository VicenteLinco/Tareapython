import { AlertTriangle, Clock, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StockItem, EstadoAlerta } from '@/types'
import { cn, daysUntil } from '@/lib/utils'

// Singular/plural de "dia" para etiquetas de días (no es una unidad del backend).
const diasLabel = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

// Fallback de estado cuando el backend no lo envía (no debería ocurrir): se deriva
// sin mínimos manuales, sólo por vencimiento y stock.
function deriveEstado(item: StockItem): EstadoAlerta {
  const stock = item.stock_total ?? 0
  const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
  if (stock <= 0) return 'agotado'
  if (days !== null && days < 0) return 'vencido'
  if (days !== null && days <= 90) return 'por_vencer'
  return 'normal'
}

export function StockBadge({ item }: { item: StockItem }) {
  const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
  const estado: EstadoAlerta = item.estado_alerta ?? deriveEstado(item)
  const dias = item.dias_autonomia ?? null

  if (estado === 'agotado') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Info className="h-3 w-3" /> Agotado
      </Badge>
      <span className="text-[9px] font-bold text-error uppercase tracking-tighter italic">Reponer de inmediato</span>
    </div>
  )

  if (estado === 'vencido') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Clock className="h-3 w-3" /> Vencido
      </Badge>
      <span className="text-[9px] font-bold text-error uppercase">Retirar de stock</span>
    </div>
  )

  if (estado === 'critico') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
        <AlertTriangle className="h-3 w-3" /> Critico
      </Badge>
      <span className="text-[9px] font-bold text-error opacity-70 uppercase tracking-tighter">Quedan ~{diasLabel(Math.round(dias ?? 0))}</span>
    </div>
  )

  if (estado === 'reponer') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Clock className="h-3 w-3" /> Reponer
      </Badge>
      <span className="text-[9px] font-bold text-warning opacity-70 uppercase tracking-tighter">Quedan ~{diasLabel(Math.round(dias ?? 0))}</span>
    </div>
  )

  if (estado === 'riesgo_venc' || estado === 'por_vencer') {
    const pct = item.pct_por_vencer ?? null
    return (
      <div className="flex flex-col items-end gap-1">
        <Badge
          variant="warning"
          className={cn(
            'gap-1 text-[10px] font-bold uppercase px-2',
            estado === 'riesgo_venc'
              ? 'animate-pulse'
              : 'border-warning/30 bg-warning/10 text-warning',
          )}
        >
          <Clock className="h-3 w-3" /> {estado === 'riesgo_venc' ? 'Riesgo' : 'Por vencer'}
        </Badge>
        <span className="text-[9px] font-bold text-warning/80 uppercase">
          {pct !== null && `~${pct}% `}
          {days !== null ? `vence en ${diasLabel(days)}` : 'vencimiento cercano'}
        </span>
      </div>
    )
  }

  if (estado === 'sin_datos') return (
    <div className="flex flex-col items-end gap-1">
      <Badge
        variant="outline"
        className="text-[10px] font-bold uppercase px-2 text-base-content/50 border-base-300 bg-base-200/50"
        title="Sin historial de consumo suficiente para estimar la autonomía."
      >
        Sin datos
      </Badge>
      <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">Estimación no disponible</span>
    </div>
  )

  if (estado === 'no_gestionado') return (
    <div className="flex flex-col items-end gap-1">
      <Badge
        variant="outline"
        className="text-[10px] font-bold uppercase px-2 text-base-content/40 border-base-300 bg-base-200/40"
        title="Producto sin movimientos: nunca tuvo stock en el sistema."
      >
        Sin gestión
      </Badge>
      <span className="text-[9px] font-bold opacity-30 uppercase tracking-tighter">Nunca tuvo stock</span>
    </div>
  )

  // normal
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="outline" className="text-[10px] font-bold uppercase px-2 text-success border-success/20 bg-success/5">
        OK
      </Badge>
      <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">
        {dias !== null ? `~${diasLabel(Math.round(dias))}` : 'Sin consumo reciente'}
      </span>
    </div>
  )
}

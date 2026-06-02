import { AlertTriangle, Clock, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StockItem } from '@/types'
import { cn, daysUntil } from '@/lib/utils'

export function StockBadge({ item }: { item: StockItem }) {
  const stock = item.stock_total ?? 0
  const stockMinimo = item.stock_minimo ?? 0
  const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
  const estadoAlerta = item.estado_alerta ?? (
    stock <= 0
      ? 'sin_stock'
      : days !== null && days < 0
      ? 'vencido'
      : stockMinimo > 0 && stock < stockMinimo
      ? 'bajo_minimo'
      : days !== null && days <= 90
      ? 'vence_pronto'
      : 'normal'
  )
  const dias = item.dias_autonomia ?? null
  const diasConConsumo = item.dias_con_consumo ?? 0
  const pocosData = diasConConsumo > 0 && diasConConsumo < 14

  if (estadoAlerta === 'sin_stock') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Info className="h-3 w-3" /> Agotado
      </Badge>
      <span className="text-[9px] font-bold text-error uppercase tracking-tighter italic">Reponer de inmediato</span>
    </div>
  )

  if (estadoAlerta === 'vencido') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Clock className="h-3 w-3" /> Vencido
      </Badge>
      <span className="text-[9px] font-bold text-error uppercase">Retirar de stock</span>
    </div>
  )

  if (estadoAlerta === 'critico') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
        <AlertTriangle className="h-3 w-3" /> Critico
      </Badge>
      <span className="text-[9px] font-bold text-error opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias ?? 0)} dias</span>
    </div>
  )

  if (estadoAlerta === 'bajo_minimo') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2">
        <AlertTriangle className="h-3 w-3" /> Bajo minimo
      </Badge>
      <span className="text-[9px] font-bold text-warning opacity-80 uppercase tracking-tighter">
        {Math.round(stock)} / {Math.round(stockMinimo)}
      </span>
    </div>
  )

  if (estadoAlerta === 'reponer') return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Clock className="h-3 w-3" /> Reponer
      </Badge>
      <span className="text-[9px] font-bold text-warning opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias ?? 0)} dias</span>
    </div>
  )

  if (estadoAlerta === 'vence_pronto') return (
    <div className="flex flex-col items-end gap-1">
      <Badge
        variant="warning"
        className={cn(
          'gap-1 text-[10px] font-bold uppercase px-2',
          days !== null && days <= 30
            ? 'animate-pulse'
            : 'border-warning/30 bg-warning/10 text-warning',
        )}
      >
        <Clock className="h-3 w-3" /> {days !== null && days <= 30 ? 'Riesgo' : 'Por vencer'}
      </Badge>
      <span className="text-[9px] font-bold text-warning/80 uppercase">
        {days !== null ? `Vence en ${days} dias` : 'Vencimiento cercano'}
      </span>
    </div>
  )

  const tieneEstimacionPocaData = pocosData && dias !== null
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] font-bold uppercase px-2',
          tieneEstimacionPocaData
            ? 'text-base-content/50 border-base-300 bg-base-200/50'
            : 'text-success border-success/20 bg-success/5',
        )}
        title={tieneEstimacionPocaData ? `Estimado con solo ${diasConConsumo} dia(s) con consumo. Puede no ser preciso.` : undefined}
      >
        {tieneEstimacionPocaData ? '~OK' : 'OK'}
      </Badge>
      <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">
        {dias !== null ? `~${Math.round(dias)} dias${tieneEstimacionPocaData ? '*' : ''}` : 'Sin consumo reciente'}
      </span>
    </div>
  )
}

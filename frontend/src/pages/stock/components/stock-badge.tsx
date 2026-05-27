import { AlertTriangle, Clock, Info, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StockItem } from '@/types'
import { cn, daysUntil } from '@/lib/utils'

export function StockBadge({ item }: { item: StockItem }) {
  const stock = item.stock_total ?? 0
  const dias = item.dias_autonomia ?? null
  const diasPico = item.dias_autonomia_pico ?? null
  const diasConConsumo = item.dias_con_consumo ?? 0
  const leadTime = item.lead_time_propio ?? 3
  const pocosData = diasConConsumo > 0 && diasConConsumo < 14

  // 1. Sin stock
  if (stock <= 0) return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Info className="h-3 w-3" /> Agotado
      </Badge>
      <span className="text-[9px] font-bold text-error uppercase tracking-tighter italic">Reponer de inmediato</span>
    </div>
  )

  // 2. Vencido / por vencer
  if (item.proximo_vencimiento) {
    const days = daysUntil(item.proximo_vencimiento)
    if (days !== null && days <= 0) return (
      <div className="flex flex-col items-end gap-1">
        <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
          <Clock className="h-3 w-3" /> Vencido
        </Badge>
        <span className="text-[9px] font-bold text-error uppercase">Retirar de stock</span>
      </div>
    )
    if (days !== null && days <= 30) return (
      <div className="flex flex-col items-end gap-1">
        <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
          <Clock className="h-3 w-3" /> Riesgo
        </Badge>
        <span className="text-[9px] font-bold text-warning uppercase">Vence en {days} días</span>
      </div>
    )
  }

  // 3. Crítico: días base <= lead time
  if (dias !== null && dias <= leadTime) return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
        <AlertTriangle className="h-3 w-3" /> Crítico
      </Badge>
      <span className="text-[9px] font-bold text-error opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias)} días</span>
    </div>
  )

  // 4. Reponer pronto: días base <= lead time + 7
  if (dias !== null && dias <= leadTime + 7) return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2">
        <Clock className="h-3 w-3" /> Reponer
      </Badge>
      <span className="text-[9px] font-bold text-warning opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias)} días</span>
    </div>
  )

  // 5. Pico posible: días normales OK pero en pico entraría en zona crítica
  if (dias !== null && diasPico !== null && diasPico <= leadTime + 7) {
    const tooltip = `En tu mayor pico reciente agotarías el stock en ~${diasPico} días.\nConsumo normal: ~${dias} días.`
    return (
      <div className="flex flex-col items-end gap-1" title={tooltip}>
        <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2 border-warning/30 bg-warning/10 text-warning">
          <TrendingUp className="h-3 w-3" /> Pico posible
        </Badge>
        <span className="text-[9px] font-bold text-warning opacity-80 uppercase tracking-tighter">
          Normal ~{Math.round(dias)} · Pico ~{Math.round(diasPico)} d
        </span>
      </div>
    )
  }

  // 6. OK — con o sin suficiente historial
  const tieneEstimacionPocaData = pocosData && dias !== null
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] font-bold uppercase px-2",
          tieneEstimacionPocaData
            ? "text-base-content/50 border-base-300 bg-base-200/50"
            : "text-success border-success/20 bg-success/5"
        )}
        title={tieneEstimacionPocaData ? `Estimado con solo ${diasConConsumo} día(s) con consumo. Puede no ser preciso.` : undefined}
      >
        {tieneEstimacionPocaData ? '~OK' : 'OK'}
      </Badge>
      <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">
        {dias !== null
          ? `~${Math.round(dias)} días${tieneEstimacionPocaData ? '*' : ''}`
          : 'Sin consumo reciente'}
      </span>
    </div>
  )
}

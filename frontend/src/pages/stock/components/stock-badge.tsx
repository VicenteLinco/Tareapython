import { AlertTriangle, Clock, Info, PackagePlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StockItem, EstadoCantidad, EstadoVencimiento } from '@/types'
import { cn, daysUntil, formatCantidad } from '@/lib/utils'

// Singular/plural de "dia" para etiquetas de días (no es una unidad del backend).
const diasLabel = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`

// Modelo de dos ejes ortogonales (migration 002): el badge muestra hasta DOS chips
// apilados — cantidad ("¿comprar?") y vencimiento ("¿descartar?") — porque son
// hechos simultáneos e independientes. Nunca se pisan.

// Fallback cuando el backend no envía los ejes (datos viejos). Se deriva sin
// mínimos manuales, sólo por stock usable y vencimiento físico.
function deriveEjes(item: StockItem): {
  cantidad: EstadoCantidad
  vencimiento: EstadoVencimiento
} {
  const usable = item.stock_usable ?? item.stock_total ?? 0
  const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
  const hayVencido = (item.stock_vencido ?? 0) > 0
  const cantidad: EstadoCantidad = usable <= 0 ? 'agotado' : 'normal'
  const vencimiento: EstadoVencimiento = hayVencido
    ? 'vencido'
    : days !== null && days >= 0 && days <= 90
      ? days <= 30
        ? 'riesgo_venc'
        : 'por_vencer'
      : 'ok'
  return { cantidad, vencimiento }
}

type ChipVariant = 'destructive' | 'warning' | 'outline'

function Chip({
  variant,
  className,
  icon,
  label,
  sub,
  subClass,
}: {
  variant: ChipVariant
  className?: string
  icon: React.ReactNode
  label: string
  sub?: string
  subClass?: string
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Badge
        variant={variant}
        className={cn('gap-1 text-[10px] font-bold uppercase px-2', className)}
      >
        {icon} {label}
      </Badge>
      {sub && (
        <span className={cn('text-[9px] font-bold uppercase tracking-tighter', subClass)}>
          {sub}
        </span>
      )}
    </div>
  )
}

// Eje cantidad. Devuelve null cuando está sano ('normal') para no ensuciar la fila.
function renderCantidad(estado: EstadoCantidad, dias: number | null) {
  const quedan = `Quedan ~${diasLabel(Math.round(dias ?? 0))}`
  switch (estado) {
    case 'agotado':
      return (
        <Chip
          variant="destructive"
          icon={<Info className="h-3 w-3" />}
          label="Agotado"
          sub="Reponer de inmediato"
          subClass="text-error italic"
        />
      )
    case 'critico':
      return (
        <Chip
          variant="destructive"
          className="animate-pulse"
          icon={<AlertTriangle className="h-3 w-3" />}
          label="Critico"
          sub={quedan}
          subClass="text-error opacity-70"
        />
      )
    case 'reponer':
      return (
        <Chip
          variant="warning"
          icon={<Clock className="h-3 w-3" />}
          label="Reponer"
          sub={quedan}
          subClass="text-warning opacity-70"
        />
      )
    case 'exceso':
      return (
        <Chip
          variant="outline"
          className="text-info border-info/20 bg-info/5"
          icon={<PackagePlus className="h-3 w-3" />}
          label="Exceso"
          sub="Sobrestock"
          subClass="text-info/70"
        />
      )
    case 'sin_datos':
      return (
        <Chip
          variant="outline"
          className="text-base-content/50 border-base-300 bg-base-200/50"
          icon={null}
          label="Sin datos"
          sub="Estimación no disponible"
          subClass="opacity-40"
        />
      )
    case 'no_gestionado':
      return (
        <Chip
          variant="outline"
          className="text-base-content/40 border-base-300 bg-base-200/40"
          icon={null}
          label="Sin gestión"
          sub="Nunca tuvo stock"
          subClass="opacity-30"
        />
      )
    default:
      return null // 'normal'
  }
}

// Eje vencimiento. Devuelve null cuando está sano ('ok'). El stock vencido se
// informa SIEMPRE como contador para que la acción de descarte nunca desaparezca.
function renderVencimiento(
  estado: EstadoVencimiento,
  days: number | null,
  item: StockItem,
) {
  const vencido = item.stock_vencido ?? 0
  const porDescartar =
    vencido > 0
      ? `${formatCantidad(vencido, item.unidad, item.unidad_plural ?? undefined)} por descartar`
      : 'Retirar de stock'

  switch (estado) {
    case 'vencido':
      return (
        <Chip
          variant="destructive"
          icon={<Clock className="h-3 w-3" />}
          label="Vencido"
          sub={porDescartar}
          subClass="text-error"
        />
      )
    case 'riesgo_venc':
      return (
        <Chip
          variant="warning"
          className="animate-pulse"
          icon={<Clock className="h-3 w-3" />}
          label="Riesgo"
          sub={days !== null ? `vence en ${diasLabel(days)}` : 'vencimiento cercano'}
          subClass="text-warning/80"
        />
      )
    case 'por_vencer':
      return (
        <Chip
          variant="warning"
          className="border-warning/30 bg-warning/10 text-warning"
          icon={<Clock className="h-3 w-3" />}
          label="Por vencer"
          sub={days !== null ? `vence en ${diasLabel(days)}` : 'vencimiento cercano'}
          subClass="text-warning/80"
        />
      )
    default:
      return null // 'ok'
  }
}

export function StockBadge({ item }: { item: StockItem }) {
  const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
  const dias = item.dias_autonomia ?? null

  const fallback = deriveEjes(item)
  const cantidad = item.estado_cantidad ?? fallback.cantidad
  const vencimiento = item.estado_vencimiento ?? fallback.vencimiento

  const cantidadChip = renderCantidad(cantidad, dias)
  const vencimientoChip = renderVencimiento(vencimiento, days, item)

  // Ambos ejes sanos → un único "OK".
  if (!cantidadChip && !vencimientoChip) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Badge
          variant="outline"
          className="text-[10px] font-bold uppercase px-2 text-success border-success/20 bg-success/5"
        >
          OK
        </Badge>
        <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">
          {dias !== null ? `~${diasLabel(Math.round(dias))}` : 'Sin consumo reciente'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {cantidadChip}
      {vencimientoChip}
    </div>
  )
}

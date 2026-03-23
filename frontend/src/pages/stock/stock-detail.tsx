import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { formatDate, daysUntil, cn, autoPlural } from '@/lib/utils'
import type { StockItem } from '@/types'

interface LoteSummary {
  id: string
  numero_lote: string
  fecha_vencimiento: string
  stock_total: number | null
  proveedor_nombre: string | null
}

export function StockDetail({ item, areaId }: { item: StockItem; areaId: number | null }) {
  const { data: lotes, isLoading } = useQuery({
    queryKey: ['lotes', item.producto_id, { areaId, con_stock: true }],
    queryFn: () =>
      api.get<LoteSummary[]>('/lotes', {
        params: {
          producto_id: item.producto_id,
          con_stock: true,
          area_id: areaId || undefined,
        },
      }).then((r) => r.data),
  })

  const stockTotal = Math.round(item.stock_total ?? 0)
  const isLow = stockTotal > 0 && stockTotal <= item.stock_minimo
  const minimoLabel = Math.round(item.stock_minimo)

  // total from loaded lotes (used for percentages)
  const totalLotes = lotes?.reduce((s, l) => s + Math.round(l.stock_total ?? 0), 0) ?? stockTotal

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-48 rounded" />
        <div className="skeleton h-20 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    )
  }

  const sortedLotes = [...(lotes ?? [])].sort(
    (a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime()
  )

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap gap-1.5">
        {item.codigo_interno && (
          <span className="badge badge-sm badge-ghost font-mono">{item.codigo_interno}</span>
        )}
        {item.categoria && (
          <span className="badge badge-sm badge-ghost">{item.categoria}</span>
        )}
        {item.proveedor_nombre && (
          <span className="badge badge-sm badge-ghost flex items-center gap-1">
            <ProveedorIcon proveedor={{ nombre: item.proveedor_nombre, icono: item.proveedor_icono }} className="h-3.5 w-3.5" />
            {item.proveedor_nombre}
          </span>
        )}
      </div>

      {/* Stock summary */}
      <div className={cn(
        'rounded-xl p-5 border',
        isLow ? 'bg-warning/5 border-warning/20' : 'bg-base-200/50 border-base-200'
      )}>
        <p className="text-xs font-medium opacity-40 mb-1">Stock Total</p>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{stockTotal}</span>
          <span className="text-sm opacity-40">{stockTotal === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
        </div>
        <p className="text-xs opacity-35 mt-2">
          Mínimo: {minimoLabel} {minimoLabel === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}
        </p>
        {isLow && (
          <div className="mt-3 rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs font-medium text-warning">
            Stock por debajo del mínimo
          </div>
        )}
      </div>

      {/* Lots */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest opacity-35 mb-3">
          Lotes Activos
        </h3>
        {sortedLotes.length === 0 ? (
          <p className="text-sm opacity-40 py-4 text-center">Sin lotes con stock</p>
        ) : (
          <div className="space-y-2">
            {sortedLotes.map((lote, idx) => {
              const qty = Math.round(lote.stock_total ?? 0)
              const pct = totalLotes > 0 ? Math.round((qty / totalLotes) * 100) : 0
              const days = daysUntil(lote.fecha_vencimiento)
              const isExpired = days <= 0
              const isSoon = days > 0 && days <= 30

              return (
                <div
                  key={lote.id}
                  className={cn(
                    'rounded-xl border px-3 py-2.5',
                    isExpired
                      ? 'border-error/30 bg-error/5'
                      : isSoon
                      ? 'border-warning/30 bg-warning/5'
                      : 'border-base-200 bg-base-100'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-xs font-mono font-semibold">
                        Lote <span className="text-base-content">{lote.numero_lote}</span>
                      </p>
                      {lote.proveedor_nombre && (
                        <p className="text-[11px] opacity-40">{lote.proveedor_nombre}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="font-mono font-bold text-sm">{qty}</span>
                        <span className="text-xs opacity-40">{qty === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
                        <span className="text-[11px] opacity-50 ml-1">({pct}%)</span>
                      </div>
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        {isExpired && <Badge variant="destructive">Vencido</Badge>}
                        {isSoon && <Badge variant="warning">{days === 1 ? 'mañana' : `${days}d`}</Badge>}
                      </div>
                    </div>
                  </div>

                  {/* Expiry date explicit */}
                  <div className="flex items-center justify-between">
                    <p className={cn(
                      'text-[11px] font-medium',
                      isExpired ? 'text-error' : isSoon ? 'text-warning' : 'opacity-40'
                    )}>
                      Vence: {formatDate(lote.fecha_vencimiento)}
                      {!isExpired && (
                        <span className="ml-1 opacity-60">
                          ({days === 1 ? 'mañana' : `en ${days} días`})
                        </span>
                      )}
                    </p>
                    {/* Percentage bar */}
                    <div className="w-16 bg-base-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          isExpired ? 'bg-error' : isSoon ? 'bg-warning' : 'bg-primary'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

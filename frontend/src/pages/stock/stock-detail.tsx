import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import api from '@/lib/api'
import { formatDate, daysUntil, cn } from '@/lib/utils'

interface ProductoDetalle {
  id: number
  nombre: string
  codigo: string | null
  categoria_nombre: string
  unidad_base_nombre: string
  stock_minimo: number
  stock_por_area: {
    area_id: number
    area_nombre: string
    lotes: {
      lote_id: number
      codigo_lote: string
      fecha_vencimiento: string
      cantidad: number
    }[]
  }[]
}

export function StockDetail({ productoId, areaId }: { productoId: number; areaId: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['producto', productoId],
    queryFn: () => api.get<ProductoDetalle>(`/productos/${productoId}`).then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-6 w-48 rounded" />
        <div className="skeleton h-20 w-full rounded-lg" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    )
  }
  if (!data) return null

  const stockTotal = data.stock_por_area.flatMap((a) => a.lotes).reduce((sum, l) => sum + l.cantidad, 0)
  const areas = areaId ? data.stock_por_area.filter((a) => a.area_id === areaId) : data.stock_por_area
  const isLow = stockTotal > 0 && stockTotal <= data.stock_minimo

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap gap-1.5">
        {data.codigo && <span className="badge badge-sm badge-ghost font-mono">{data.codigo}</span>}
        <span className="badge badge-sm badge-ghost">{data.categoria_nombre}</span>
      </div>

      {/* Stock summary */}
      <div className={cn(
        'rounded-xl p-5 border',
        isLow ? 'bg-warning/5 border-warning/20' : 'bg-base-200/50 border-base-200'
      )}>
        <p className="text-xs font-medium opacity-40 mb-1">Stock Total</p>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{stockTotal}</span>
          <span className="text-sm opacity-40">{data.unidad_base_nombre}</span>
        </div>
        <p className="text-xs opacity-35 mt-2">
          Mínimo: {data.stock_minimo} {data.unidad_base_nombre}
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
        {areas.length === 0 ? (
          <p className="text-sm opacity-40 py-4 text-center">Sin stock</p>
        ) : (
          <div className="space-y-4">
            {areas.map((area) => (
              <div key={area.area_id}>
                <p className="text-xs font-semibold mb-2 opacity-60">{area.area_nombre}</p>
                <div className="space-y-1.5">
                  {area.lotes
                    .filter((l) => l.cantidad > 0)
                    .sort((a, b) => new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime())
                    .map((lote) => {
                      const days = daysUntil(lote.fecha_vencimiento)
                      return (
                        <div
                          key={lote.lote_id}
                          className="flex items-center justify-between rounded-lg border border-base-200 bg-base-100 px-3 py-2.5"
                        >
                          <div>
                            <p className="text-xs font-mono font-semibold">{lote.codigo_lote}</p>
                            <p className="text-[11px] opacity-35">{formatDate(lote.fecha_vencimiento)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm">{lote.cantidad}</span>
                            {days <= 0 && <Badge variant="destructive">Vencido</Badge>}
                            {days > 0 && days <= 30 && <Badge variant="warning">{days}d</Badge>}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { formatDate, daysUntil, cn, autoPlural, formatCantidad } from '@/lib/utils'
import type { StockItem, Movimiento, PaginatedResponse } from '@/types'
import { DiscardLoteDialog } from './discard-lote-dialog'
import { Trash2, ShoppingCart, AlertCircle, Play, History, Box, ArrowUpRight, ArrowDownLeft, FileText, User, TrendingUp, Info } from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'

interface LoteSummary {
  id: string
  numero_lote: string
  fecha_vencimiento: string
  stock_total: number | null
  proveedor_nombre: string | null
}

export function StockDetail({ item, areaId }: { item: StockItem; areaId: number | null }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'lotes' | 'historial'>('lotes')
  const [discardLote, setDiscardLote] = useState<{id: string, numeroLote: string} | null>(null)

  const { data: lotes, isLoading: isLoadingLotes } = useQuery({
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

  // Auto-open discard dialog if coming from dashboard alert
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'discard' && lotes && lotes.length > 0) {
      const oldestLote = [...lotes].sort((a, b) => 
        new Date(a.fecha_vencimiento).getTime() - new Date(b.fecha_vencimiento).getTime()
      )[0]
      
      if (oldestLote) {
        setDiscardLote({ id: oldestLote.id, numeroLote: oldestLote.numero_lote })
        const newParams = new URLSearchParams(searchParams)
        newParams.delete('action')
        setSearchParams(newParams, { replace: true })
      }
    }
  }, [lotes, searchParams, setSearchParams])

  const stockTotal = Math.round(item.stock_total ?? 0)
  const isLow = stockTotal <= item.stock_minimo && item.stock_minimo > 0
  const minimoLabel = Math.round(item.stock_minimo)
  const totalLotes = lotes?.reduce((s, l) => s + Math.round(l.stock_total ?? 0), 0) ?? stockTotal

  if (isLoadingLotes) {
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

  const buyAmount = Math.max(0, (minimoLabel * 2) - stockTotal)

  return (
    <div className="space-y-6">
      {/* Imagen + Meta */}
      <div className="flex items-start gap-3">
        <ProductoImage src={item.imagen_url} size="md" className="flex-shrink-0 mt-0.5" />
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
      </div>

      {/* Stock summary */}
      <div className={cn(
        'rounded-xl p-5 border',
        isLow ? 'bg-error/5 border-error/20' : 'bg-base-200/50 border-base-200'
      )}>
        <p className="text-xs font-medium opacity-40 mb-1">Stock Total</p>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{stockTotal}</span>
          <span className="text-sm opacity-40">{stockTotal === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
        </div>
        <p className="text-xs opacity-35 mt-2">
          Mínimo: {formatCantidad(minimoLabel, item.unidad, item.unidad_plural)}
        </p>

        {isLow && (
          <div className="mt-4 p-3 bg-error/10 rounded-xl border border-error/20 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-error uppercase">
              <AlertCircle className="w-3.5 h-3.5" />
              Resolución: Reponer Stock
            </div>
            <p className="text-[11px] leading-snug">Se recomienda comprar al menos <strong>{formatCantidad(buyAmount, item.unidad, item.unidad_plural)}</strong> para cubrir la demanda y mantener el stock de seguridad.</p>
            <button 
              className="btn btn-xs btn-error btn-block gap-2 h-8 rounded-lg"
              onClick={() => navigate(`/solicitudes-compra?select=${item.producto_id}`)}
            >
              <ShoppingCart className="w-3 h-3" />
              Generar Sugerencia de Compra
            </button>
          </div>
        )}
      </div>

      {/* Autonomía de stock */}
      {(item.dias_autonomia != null || item.dias_autonomia_pico != null) && (
        <div className="rounded-xl border border-base-200 bg-base-100 divide-y divide-base-200">
          {item.dias_autonomia != null && (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium opacity-50">Duración estimada</span>
                {(item.dias_con_consumo ?? 0) > 0 && (item.dias_con_consumo ?? 0) < 14 && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-300 bg-amber-50 px-1.5 py-0.5 rounded cursor-default"
                    title={`Estimado con solo ${item.dias_con_consumo} día(s) con consumo. El cálculo puede no ser preciso.`}
                  >
                    <Info className="w-2.5 h-2.5 inline mr-0.5" />
                    Pocos datos
                  </span>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums">
                ~{Math.round(item.dias_autonomia)} días
              </span>
            </div>
          )}
          {item.dias_autonomia_pico != null && (
            <div
              className="flex items-center justify-between px-4 py-3 bg-amber-50/60"
              title={`En tu mayor pico reciente agotarías el stock en ~${item.dias_autonomia_pico} días. Considera reponer si se acerca temporada alta (influenza, VRS).`}
            >
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-700">En pico máximo reciente</span>
              </div>
              <span className="text-sm font-bold text-amber-700 tabular-nums">
                ~{Math.round(item.dias_autonomia_pico)} días
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex p-1 bg-base-200 rounded-xl">
        <button
          onClick={() => setActiveTab('lotes')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all",
            activeTab === 'lotes' ? "bg-base-100 shadow-sm" : "opacity-40 hover:opacity-100"
          )}
        >
          <Box className="w-3.5 h-3.5" />
          Lotes Activos
        </button>
        <button
          onClick={() => setActiveTab('historial')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all",
            activeTab === 'historial' ? "bg-base-100 shadow-sm" : "opacity-40 hover:opacity-100"
          )}
        >
          <History className="w-3.5 h-3.5" />
          Historial
        </button>
      </div>

      {/* Content */}
      <div className="min-h-[200px]">
        {activeTab === 'lotes' ? (
          <div className="space-y-2">
            {sortedLotes.length === 0 ? (
              <p className="text-sm opacity-40 py-8 text-center">Sin lotes con stock</p>
            ) : (
              sortedLotes.map((lote) => {
                const qty = Math.round(lote.stock_total ?? 0)
                const pct = totalLotes > 0 ? Math.round((qty / totalLotes) * 100) : 0
                const days = daysUntil(lote.fecha_vencimiento)
                const isExpired = days !== null && days <= 0
                const isSoon = days !== null && days > 0 && days <= 90

                return (
                  <div
                    key={lote.id}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 transition-all',
                      isExpired
                        ? 'border-error/30 bg-error/5'
                        : isSoon
                        ? 'border-warning/30 bg-warning/5 ring-1 ring-warning/20 shadow-sm shadow-warning/10'
                        : 'border-base-200 bg-base-100'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-mono font-semibold">
                            Lote <span className="text-base-content">{lote.numero_lote}</span>
                          </p>
                          {isSoon && !isExpired && (
                            <span className="badge badge-warning badge-[10px] h-4 py-0 font-bold animate-pulse">
                              FEFO PRIORITARIO
                            </span>
                          )}
                        </div>
                        {lote.proveedor_nombre && (
                          <p className="text-[11px] opacity-40">{lote.proveedor_nombre}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-baseline gap-1 justify-end">
                          <span className="font-mono font-bold text-sm">{qty}</span>
                          <span className="text-xs opacity-40">{qty === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
                        </div>
                        <div className="flex items-center gap-1 justify-end mt-0.5">
                          {isExpired && <Badge variant="destructive">Vencido</Badge>}
                          {isSoon && !isExpired && <Badge variant="warning">{days === 1 ? 'mañana' : `${days}d`}</Badge>}
                        </div>
                      </div>
                    </div>

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
                      <div className="w-16 bg-base-200 rounded-full h-1.5 overflow-hidden hidden sm:block">
                        <div
                          className={cn(
                            'h-1.5 rounded-full transition-all',
                            isExpired ? 'bg-error' : isSoon ? 'bg-warning' : 'bg-primary'
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => navigate(`/consumos?search=${encodeURIComponent(item.producto_nombre)}`)}
                        className="btn btn-xs gap-1 h-7 btn-ghost hover:bg-primary/10 text-primary"
                      >
                        <Play className="w-3 h-3" />
                        Consumir
                      </button>
                      
                      <button
                        onClick={() => setDiscardLote({ id: lote.id, numeroLote: lote.numero_lote })}
                        className={cn(
                          "btn btn-xs gap-1 h-7 transition-all duration-300",
                          isExpired
                            ? "btn-error shadow-[0_0_15px_rgba(239,68,68,0.4)] animate-pulse border-none text-white hover:bg-error/90"
                            : isSoon
                            ? "btn-ghost text-warning hover:bg-warning/10"
                            : "btn-ghost text-base-content/40 hover:bg-base-200 hover:text-base-100"
                        )}
                      >
                        <Trash2 className="w-3 h-3" />
                        {isExpired ? 'Descartar Vencido' : 'Descartar'}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <ProductTimeline productoId={item.producto_id} areaId={areaId} />
        )}
      </div>

      {discardLote && (
        <DiscardLoteDialog
          open={!!discardLote}
          loteId={discardLote.id}
          numeroLote={discardLote.numeroLote}
          productoNombre={item.producto_nombre}
          defaultAreaId={areaId}
          onClose={() => setDiscardLote(null)}
        />
      )}
    </div>
  )
}

function ProductTimeline({ productoId, areaId }: { productoId: string; areaId: number | null }) {
  const { data: historial, isLoading } = useQuery({
    queryKey: ['historial-producto', productoId, areaId],
    queryFn: () => 
      api.get<PaginatedResponse<Movimiento>>('/movimientos', {
        params: { producto_id: productoId, area_id: areaId || undefined, per_page: 20 }
      }).then(r => r.data)
  })

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
      </div>
    )
  }

  const eventos = historial?.data || []

  if (eventos.length === 0) {
    return (
      <div className="py-12 text-center opacity-30">
        <History className="w-10 h-10 mx-auto mb-2" />
        <p className="text-sm font-medium">Sin movimientos registrados</p>
      </div>
    )
  }

  return (
    <div className="relative py-4 pl-4 space-y-6">
      {/* Vertical line */}
      <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-base-200" />

      {eventos.map((ev) => {
        const isEntrada = ev.tipo === 'entrada'
        const isSalida = ev.tipo === 'salida'
        const isDescarte = ev.tipo === 'descarte'
        
        return (
          <div key={ev.id} className="relative flex gap-4 items-start">
            {/* Dot/Icon */}
            <div className={cn(
              "relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-4 ring-base-100 shadow-sm",
              isEntrada ? "bg-success text-success-content" : 
              isDescarte ? "bg-error text-error-content" : 
              isSalida ? "bg-primary text-primary-content" : 
              "bg-base-300 text-base-content"
            )}>
              {isEntrada ? <ArrowDownLeft className="w-3 h-3" /> : 
               isSalida ? <ArrowUpRight className="w-3 h-3" /> :
               isDescarte ? <Trash2 className="w-3 h-3" /> :
               <Box className="w-3 h-3" />}
            </div>

            <div className="flex-1 min-w-0 bg-base-100/50 border border-base-200/50 rounded-2xl p-3 hover:bg-base-200/20 transition-colors">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">
                  {new Date(ev.created_at).toLocaleString('es-ES', { 
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
                  })}
                </span>
                <span className="text-[10px] font-mono opacity-30">#{ev.numero_documento?.slice(-6)}</span>
              </div>
              
              <div className="flex items-center gap-1.5 mb-1.5">
                <p className="text-xs font-bold capitalize">
                  {isEntrada ? 'Ingreso a Stock' : 
                   isSalida ? 'Consumo' : 
                   isDescarte ? 'Baja / Descarte' : 
                   ev.tipo.replace('_', ' ')}
                </p>
                <div className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-bold",
                  isEntrada ? "bg-success/10 text-success" : "bg-base-200 opacity-60"
                )}>
                  {isEntrada ? '+' : '-'}{Math.round(ev.cantidad)} {ev.unidad_base_nombre}
                </div>
              </div>

              {ev.notas && (
                <div className="flex items-start gap-1.5 mb-2 p-2 bg-base-200/50 rounded-lg">
                  <FileText className="w-3 h-3 mt-0.5 opacity-30" />
                  <p className="text-[11px] leading-snug italic opacity-70">{ev.notas}</p>
                </div>
              )}

              <div className="flex items-center gap-3 mt-2 text-[10px] opacity-40 font-medium">
                <span className="flex items-center gap-1">
                  <User className="w-2.5 h-2.5" />
                  {ev.usuario_nombre}
                </span>
                <span className="flex items-center gap-1">
                  <Box className="w-2.5 h-2.5" />
                  Lote: {ev.codigo_lote}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

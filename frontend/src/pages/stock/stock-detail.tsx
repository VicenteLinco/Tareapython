import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { formatDate, daysUntil, cn } from '@/lib/utils'
import { CantidadConUnidad } from '@/components/ui/cantidad'
import { LOTE_ROW_COLORS, STOCK_ALERT_COLORS } from '@/lib/theme'
import type { StockItem, Movimiento, PaginatedResponse } from '@/types'
import { DiscardLoteDialog } from './discard-lote-dialog'
import { Trash2, AlertCircle, Play, History, Box, ArrowUpRight, ArrowDownLeft, FileText, User, TrendingUp, Info } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { ProductoImage } from '@/components/ui/producto-image'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'

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
  const isLow = stockTotal < item.stock_minimo && item.stock_minimo > 0
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
        isLow ? STOCK_ALERT_COLORS.stockBajo : STOCK_ALERT_COLORS.normal
      )}>
        <p className="text-xs font-medium opacity-40 mb-1">Stock Total</p>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{stockTotal}</span>
          <span className="text-sm opacity-40">{stockTotal === 1 ? item.unidad : (item.unidad_plural ?? item.unidad)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <p className="text-xs opacity-35">
            Mínimo: <CantidadConUnidad qty={minimoLabel} unidad={item.unidad} pluralUnidad={item.unidad_plural} />
          </p>
          <MetricTooltip
            size="sm"
            position="right"
            text="Stock mínimo definido para el producto. Si el stock cae por debajo, el sistema genera una alerta."
          />
        </div>

        {isLow && (
          <div className="mt-4 p-3 bg-error/10 rounded-xl border border-error/20">
            <div className="flex items-center gap-2 text-xs font-bold text-error uppercase">
              <AlertCircle className="w-3.5 h-3.5" />
              Stock bajo mínimo
            </div>
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
                <MetricTooltip
                  size="sm"
                  text={`Días que durará el stock al ritmo de consumo actual (promedio móvil con EWMA). Lead time configurado: ${item.lead_time_propio ?? 3} días.`}
                />
                {(item.dias_con_consumo ?? 0) > 0 && (item.dias_con_consumo ?? 0) < 14 && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded cursor-default bg-warning/10 text-warning border-warning/30"
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
            <div className="flex items-center justify-between px-4 py-3 bg-warning/5">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-warning" />
                <span className="text-xs font-medium text-warning">En pico máximo reciente</span>
                <MetricTooltip
                  size="sm"
                  text={`Si el consumo alcanzara el pico más alto registrado recientemente, el stock duraría ~${item.dias_autonomia_pico} días. Útil para anticipar temporadas de alta demanda (influenza, VRS, etc.).`}
                />
              </div>
              <span className="text-sm font-bold text-warning tabular-nums">
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
                        ? LOTE_ROW_COLORS.vencido
                        : isSoon
                        ? LOTE_ROW_COLORS.proximo
                        : 'border-base-200 bg-base-100'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-mono font-semibold truncate">
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
                          <span className="text-xs opacity-40">{qty === 1 ? item.unidad : (item.unidad_plural ?? item.unidad)}</span>
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
          <ProductTimeline productoId={item.producto_id} areaId={areaId} unidad={item.unidad} />
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

type TipoFiltro = 'todos' | 'entradas' | 'consumos' | 'descartes'

function ProductTimeline({ productoId, areaId, unidad }: { productoId: string; areaId: number | null; unidad: string }) {
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')

  const desde = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  }, [])

  const { data: historial, isLoading } = useQuery({
    queryKey: ['historial-producto', productoId, areaId, desde],
    queryFn: () =>
      api.get<PaginatedResponse<Movimiento>>('/movimientos', {
        params: { producto_id: productoId, area_id: areaId || undefined, per_page: 200, desde },
      }).then(r => r.data),
  })

  const todosEventos = useMemo(() => historial?.data ?? [], [historial?.data])

  // Gráfico semanal: agrupar consumos (salida + descarte) por semana
  const chartData = useMemo(() => {
    const semanas: Record<string, { semana: string; consumo: number; entradas: number }> = {}
    todosEventos.forEach(ev => {
      const d = new Date(ev.created_at)
      // Inicio de semana (lunes)
      const day = d.getDay()
      const diff = (day === 0 ? -6 : 1) - day
      const lunes = new Date(d)
      lunes.setDate(d.getDate() + diff)
      const key = lunes.toISOString().split('T')[0]
      const label = lunes.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      if (!semanas[key]) semanas[key] = { semana: label, consumo: 0, entradas: 0 }
      if (ev.tipo === 'salida' || ev.tipo === 'descarte') semanas[key].consumo += Math.round(ev.cantidad)
      if (ev.tipo === 'entrada') semanas[key].entradas += Math.round(ev.cantidad)
    })
    return Object.entries(semanas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
  }, [todosEventos])

  const eventos = todosEventos.filter(ev => {
    if (tipoFiltro === 'entradas') return ev.tipo === 'entrada'
    if (tipoFiltro === 'consumos') return ev.tipo === 'salida'
    if (tipoFiltro === 'descartes') return ev.tipo === 'descarte'
    return true
  })

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mini gráfico semanal */}
      {chartData.length > 1 && (
        <div className="bg-base-200/40 rounded-2xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-30 mb-2">Consumo semanal (90 días)</p>
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={chartData} barSize={8} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
              <XAxis dataKey="semana" tick={{ fontSize: 8, opacity: 0.4 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 8, opacity: 0.4 }} tickLine={false} axisLine={false} />
              <RechartsTooltip
                contentStyle={{ fontSize: 10, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(val) => [`${val} ${unidad}`, 'Consumo']}
              />
              <Bar dataKey="consumo" radius={[3, 3, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill="hsl(var(--p))" opacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filtros de tipo */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { key: 'todos', label: 'Todos', count: todosEventos.length },
          { key: 'entradas', label: 'Entradas', count: todosEventos.filter(e => e.tipo === 'entrada').length },
          { key: 'consumos', label: 'Consumos', count: todosEventos.filter(e => e.tipo === 'salida').length },
          { key: 'descartes', label: 'Descartes', count: todosEventos.filter(e => e.tipo === 'descarte').length },
        ] as const).map(f => (
          <button
            key={f.key}
            onClick={() => setTipoFiltro(f.key as TipoFiltro)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all',
              tipoFiltro === f.key
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'border-base-300 opacity-50 hover:opacity-80'
            )}
          >
            {f.label}
            <span className="opacity-60">{f.count}</span>
          </button>
        ))}
        <span className="ml-auto text-[10px] opacity-30 self-center">Últimos 90 días</span>
      </div>

      {/* Timeline */}
      {eventos.length === 0 ? (
        <div className="py-10 text-center opacity-30">
          <History className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm font-medium">Sin movimientos</p>
        </div>
      ) : (
        <div className="relative py-2 pl-4 space-y-5">
          <div className="absolute left-[23px] top-4 bottom-4 w-0.5 bg-base-200" />
          {eventos.map(ev => {
            const isEntrada = ev.tipo === 'entrada'
            const isSalida = ev.tipo === 'salida'
            const isDescarte = ev.tipo === 'descarte'
            return (
              <div key={ev.id} className="relative flex gap-4 items-start">
                <div className={cn(
                  'relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-4 ring-base-100 shadow-sm',
                  isEntrada ? 'bg-success text-success-content' :
                  isDescarte ? 'bg-error text-error-content' :
                  isSalida ? 'bg-primary text-primary-content' :
                  'bg-base-300 text-base-content'
                )}>
                  {isEntrada ? <ArrowDownLeft className="w-3 h-3" /> :
                   isSalida ? <ArrowUpRight className="w-3 h-3" /> :
                   isDescarte ? <Trash2 className="w-3 h-3" /> :
                   <Box className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0 bg-base-100/50 border border-base-200/50 rounded-2xl p-3 hover:bg-base-200/20 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">
                      {new Date(ev.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[10px] font-mono opacity-30">#{ev.numero_documento?.slice(-6)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <p className="text-xs font-bold capitalize">
                      {isEntrada ? 'Ingreso a Stock' : isSalida ? 'Consumo' : isDescarte ? 'Baja / Descarte' : ev.tipo.replace('_', ' ')}
                    </p>
                    <div className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-bold',
                      isEntrada ? 'bg-success/10 text-success' : 'bg-base-200 opacity-60'
                    )}>
                      {isEntrada ? '+' : '-'}<CantidadConUnidad qty={Math.round(ev.cantidad)} unidad={ev.unidad_base_nombre ?? ''} pluralUnidad={ev.unidad_base_nombre_plural ?? undefined} />
                    </div>
                  </div>
                  {ev.notas && (
                    <div className="flex items-start gap-1.5 mb-2 p-2 bg-base-200/50 rounded-lg">
                      <FileText className="w-3 h-3 mt-0.5 opacity-30" />
                      <p className="text-[11px] leading-snug italic opacity-70">{ev.notas}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[10px] opacity-40 font-medium">
                    <span className="flex items-center gap-1"><User className="w-2.5 h-2.5" />{ev.usuario_nombre}</span>
                    <span className="flex items-center gap-1"><Box className="w-2.5 h-2.5" />Lote: {ev.codigo_lote}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

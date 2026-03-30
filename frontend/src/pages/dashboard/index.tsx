import { useQuery } from '@tanstack/react-query'
import { 
  Package, 
  AlertTriangle, 
  Clock, 
  TrendingDown, 
  ChevronRight, 
  History, 
  Info, 
  TrendingUp,
  ShoppingCart,
  Search,
  Eye,
  AlertCircle,
  BarChart3,
  Truck,
  CheckCircle2,
  ArrowDownLeft,
  User,
  Trash2
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse, StockItem, Movimiento } from '@/types'
import { daysUntil, autoPlural } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['stock-summary'],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', { params: { per_page: 1 } }).then((r) => r.data),
  })

  const { data: alertasResponse, isLoading: alertasLoading } = useQuery({
    queryKey: ['alertas'],
    queryFn: () => api.get<PaginatedResponse<Alerta>>('/stock/alertas', { params: { per_page: 100 } }).then((r) => r.data),
    refetchInterval: 60000,
  })

  // Log de Resoluciones (Movimientos recientes que corrigieron alertas)
  const { data: movimientosRecientes, isLoading: loadingMovimientos } = useQuery({
    queryKey: ['movimientos-recientes'],
    queryFn: () => api.get<PaginatedResponse<Movimiento>>('/movimientos', { params: { per_page: 20 } }).then(r => r.data)
  })

  const totalItems = stockData?.total ?? 0
  const alerts = alertasResponse?.data ?? []
  const criticos = alerts.filter(a => a.tipo_alerta === 'bajo_minimo' || a.tipo_alerta === 'agotamiento_proximo').length
  const porVencer = alerts.filter(a => a.tipo_alerta === 'vence_30d').length
  const vencidos = alerts.filter(a => a.tipo_alerta === 'vencido').length

  const alertaProductoIds = new Set(alerts.map(a => a.producto_id))

  const resoluciones = (movimientosRecientes?.data ?? [])
    .filter(m => !alertaProductoIds.has(m.producto_id))
    .slice(0, 5)

  const loadingResoluciones = alertasLoading || loadingMovimientos

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm opacity-50 mt-0.5">Resumen operativo y alertas prioritarias</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Insumos en Stock"
          value={totalItems}
          icon={<Package />}
          color="bg-primary/10 text-primary"
          loading={stockLoading}
        />
        <KpiCard
          label="Riesgo de Quiebre"
          value={criticos}
          icon={<TrendingDown />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={criticos > 0}
        />
        <KpiCard
          label="Próximos a Vencer"
          value={porVencer}
          icon={<Clock />}
          color="bg-warning/10 text-warning"
          loading={alertasLoading}
          alert={porVencer > 0}
        />
        <KpiCard
          label="Lotes Vencidos"
          value={vencidos}
          icon={<AlertTriangle />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={vencidos > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Alerts Section */}
        <div className="lg:col-span-2 rounded-3xl border border-base-200 bg-base-100 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-6 py-5 border-b border-base-200">
            <div>
                <h2 className="text-sm font-bold uppercase tracking-wider">Alertas Prioritarias</h2>
                <p className="text-[11px] opacity-40 mt-0.5 font-medium">Acciones requeridas para mantener la operación</p>
            </div>
            <button
                className="btn btn-ghost btn-xs gap-1 opacity-50 hover:opacity-100 font-bold"
                onClick={() => navigate('/stock')}
            >
                Ver inventario <ChevronRight className="h-3 w-3" />
            </button>
            </div>
            <div className="p-2">
            {alertasLoading ? (
                <div className="space-y-1 p-3">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-2xl" />)}
                </div>
            ) : (
                <AlertList alerts={alerts} />
            )}
            </div>
        </div>

        {/* Resolutions Log */}
        <div className="rounded-3xl border border-base-200 bg-base-100 overflow-hidden shadow-sm">
          <div className="flex items-center gap-3 px-6 py-5 border-b border-base-200 bg-base-200/20">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Resoluciones</h2>
          </div>
          <div className="p-4 space-y-4">
            {loadingResoluciones ? (
              [1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full rounded-2xl" />)
            ) : resoluciones.length === 0 ? (
              <div className="py-10 text-center opacity-30 italic text-xs">No hay resoluciones recientes</div>
            ) : (
              resoluciones.map(res => {
                const tipoConfig = {
                  entrada: { icon: <ArrowDownLeft className="w-3.5 h-3.5" />, bg: 'bg-success/10 text-success', label: 'Stock normalizado' },
                  descarte: { icon: <Trash2 className="w-3.5 h-3.5" />, bg: 'bg-error/10 text-error', label: 'Lote retirado' },
                  salida: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, bg: 'bg-primary/10 text-primary', label: 'Consumo registrado' },
                } as const
                const cfg = tipoConfig[res.tipo as keyof typeof tipoConfig] ?? tipoConfig.salida

                return (
                  <div key={res.id} className="flex gap-3 items-start group">
                    <div className={`p-2 rounded-xl mt-1 group-hover:scale-110 transition-transform ${cfg.bg}`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{res.producto_nombre || 'Movimiento'}</p>
                      <p className="text-[10px] opacity-50 mt-0.5 flex items-center gap-1">
                        <User className="w-2.5 h-2.5" /> {res.usuario_nombre}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-bold bg-base-200 px-1.5 py-0.5 rounded text-primary">
                          {res.tipo === 'entrada' ? '+' : '-'}{Math.round(res.cantidad)}
                        </span>
                        <span className="text-[9px] opacity-40 uppercase font-bold tracking-tighter">{cfg.label}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <button
              className="btn btn-ghost btn-block btn-sm text-[10px] font-bold opacity-40 hover:opacity-100"
              onClick={() => navigate('/movimientos')}
            >
              Ver historial completo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon,
  color,
  loading,
  alert,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
  loading: boolean
  alert?: boolean
}) {
  return (
    <div className={cn(
      'stat-card rounded-3xl border bg-base-100 p-6 transition-all shadow-sm',
      alert ? 'border-error/20 ring-1 ring-error/10' : 'border-base-200'
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">{label}</p>
          {loading ? (
            <div className="skeleton h-9 w-14 rounded-xl" />
          ) : (
            <p className={cn("text-3xl font-bold tabular-nums", alert && "text-error")}>{value}</p>
          )}
        </div>
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-2xl [&>svg]:h-6 [&>svg]:w-6', color)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function AlertList({ alerts }: { alerts?: Alerta[] }) {
  const navigate = useNavigate()

  if (!alerts) return null

  if (alerts.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="bg-success/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-success" />
        </div>
        <p className="text-sm font-bold opacity-40 uppercase tracking-widest">Estado Óptimo</p>
        <p className="text-xs opacity-25 mt-1 font-medium">Todo el inventario está bajo control</p>
      </div>
    )
  }

  const severityConfig = {
    vencido: { 
      label: 'Vencido', 
      bg: 'bg-error/10 text-error border-error/20', 
      icon: <AlertTriangle />,
      actionLabel: 'Descartar',
      actionIcon: <AlertTriangle className="w-3 h-3" />,
      actionClass: 'btn-error text-white hover:bg-error/90 border-none shadow-sm',
      path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}&action=discard`
    },
    agotamiento_proximo: { 
      label: 'Agotamiento crítico', 
      bg: 'bg-error/10 text-error border-error/20 ring-1 ring-error/30', 
      icon: <AlertCircle />,
      actionLabel: 'Pedir YA',
      actionIcon: <ShoppingCart className="w-3 h-3" />,
      actionClass: 'btn-error text-white animate-pulse shadow-lg border-none',
      path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}`
    },
    bajo_minimo: { 
      label: 'Stock bajo', 
      bg: 'bg-error/10 text-error border-error/20', 
      icon: <TrendingDown />,
      actionLabel: 'Pedir',
      actionIcon: <ShoppingCart className="w-3 h-3" />,
      actionClass: 'btn-primary text-primary-content hover:bg-primary/90 border-none shadow-sm',
      path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}`
    },
    vence_30d: { 
      label: 'Por vencer', 
      bg: 'bg-warning/10 text-warning border-warning/20', 
      icon: <Clock />,
      actionLabel: 'Priorizar',
      actionIcon: <TrendingUp className="w-3 h-3" />,
      actionClass: 'btn-warning text-white hover:bg-warning/90 border-none shadow-sm',
      path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}`
    },
    vence_90d: { 
      label: 'Aviso', 
      bg: 'bg-info/10 text-info border-info/20', 
      icon: <Info />,
      actionLabel: 'Revisar',
      actionIcon: <Eye className="w-3 h-3" />,
      actionClass: 'btn-info text-white hover:bg-info/90 border-none shadow-sm',
      path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}`
    },
    dead_stock: { 
      label: 'Sin movimiento', 
      bg: 'bg-base-300 text-base-content border-base-content/20', 
      icon: <History />,
      actionLabel: 'Evaluar',
      actionIcon: <Search className="w-3 h-3" />,
      actionClass: 'btn-ghost bg-base-300 hover:bg-base-content hover:text-base-100',
      path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}`
    },
    anomalia_consumo: { 
      label: 'Consumo inusual', 
      bg: 'bg-secondary/10 text-secondary border-secondary/20', 
      icon: <TrendingUp />,
      actionLabel: 'Auditar',
      actionIcon: <Search className="w-3 h-3" />,
      actionClass: 'btn-secondary text-secondary-content hover:bg-secondary/90 border-none shadow-sm',
      path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}`
    },
  }

  return (
    <div className="max-h-[500px] overflow-y-auto space-y-2 p-1 custom-scrollbar">
      {alerts.slice(0, 50).map((alerta, i) => {
        const config = severityConfig[alerta.tipo_alerta as keyof typeof severityConfig] ?? severityConfig.vence_90d
        const isBajoMinimo = alerta.tipo_alerta === 'bajo_minimo'
        const isAgotamiento = alerta.tipo_alerta === 'agotamiento_proximo'
        const isDeadStock = alerta.tipo_alerta === 'dead_stock'
        const isAnomalia = alerta.tipo_alerta === 'anomalia_consumo'
        const isVencidoAlerta = alerta.tipo_alerta === 'vencido'
        const days = alerta.proxima_fecha_venc ? daysUntil(alerta.proxima_fecha_venc) : null
        const isVencidoReal = days !== null && days <= 0
        const isVenceSoon = days !== null && days > 0

        const totalLabel = alerta.total !== null ? Math.round(alerta.total) : 0
        const minLabel = alerta.stock_minimo !== null ? Math.round(alerta.stock_minimo) : 0
        const unit = totalLabel === 1 ? (alerta.unidad || '') : (alerta.unidad_plural ?? autoPlural(alerta.unidad || ''))

        const hasEnoughData = (alerta.dias_con_consumo || 0) >= 3
        const isCalculating = !hasEnoughData && (alerta.dias_con_consumo || 0) > 0

        return (
          <div
            key={`${alerta.producto_id}-${alerta.tipo_alerta}-${i}`}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-base-200/50 bg-base-100/50 p-4 hover:bg-base-200/50 transition-all group"
          >
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn('inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider', config.bg)}>
                  {config.label}
                </span>
                <span className="text-sm font-bold truncate group-hover:text-primary transition-colors" title={alerta.nombre}>{alerta.nombre}</span>
                {alerta.es_anomalia && (
                  <span className="badge badge-secondary badge-outline text-[8px] font-bold h-4">ANOMALÍA</span>
                )}
                {alerta.tiene_pedido_pendiente && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-info/10 text-info border border-info/20 text-[8px] font-bold">
                    <Truck className="w-2.5 h-2.5" />
                    EN CAMINO
                  </div>
                )}
              </div>
              <p className="text-[11px] opacity-60 font-medium">
                {isAgotamiento ? (
                  <>
                    Stock actual: <span className="font-bold text-error">{totalLabel}</span> {unit} |{' '}
                    <span className="text-error font-bold italic underline">Quedan ~{alerta.dias_autonomia} días</span>
                  </>
                ) : isAnomalia ? (
                  <>Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} | <span className="text-secondary font-bold">Pico de consumo detectado</span></>
                ) : isBajoMinimo ? (
                  <>
                    Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} <span className="opacity-40">(Mín: {minLabel})</span>
                    {isCalculating && <span className="ml-2 text-[9px] italic opacity-40 flex items-center gap-1 inline-flex"><BarChart3 className="w-2.5 h-2.5" /> Calculando...</span>}
                    {hasEnoughData && alerta.dias_autonomia && <span className="ml-2 text-[9px] font-bold opacity-50 flex items-center gap-1 inline-flex text-primary"><BarChart3 className="w-2.5 h-2.5" /> Dura ~{alerta.dias_autonomia}d</span>}
                  </>
                ) : isDeadStock ? (
                  <>Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} | <span className="text-error font-medium">Sin movimientos hace {alerta.dias_inactivo || '90+'} días</span></>
                ) : (
                  <>
                    Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} |{' '}
                    {isVencidoReal || isVencidoAlerta ? (
                      <span className="text-error font-bold uppercase">Venció hace {Math.abs(days || 0)} días</span>
                    ) : isVenceSoon ? (
                      <span className="text-warning font-bold">Vence en {days} días</span>
                    ) : (
                      <span>Vence el {alerta.proxima_fecha_venc}</span>
                    )}
                  </>
                )}
              </p>
            </div>
            <button
              className={cn(
                "btn btn-sm gap-2 shrink-0 h-10 px-5 rounded-xl font-bold transition-all active:scale-95 shadow-sm", 
                alerta.tiene_pedido_pendiente && !isAgotamiento && !isVencidoAlerta ? "btn-ghost opacity-40" : config.actionClass
              )}
              onClick={() => navigate(config.path(alerta))}
            >
              {config.actionIcon}
              {config.actionLabel}
            </button>
          </div>
        )
      })}    </div>
  )
}

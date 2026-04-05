import React from 'react'
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
  Truck,
  CheckCircle2,
  ArrowDownLeft
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse, StockItem, Movimiento } from '@/types'
import { cn, daysUntil, autoPlural } from '@/lib/utils'

// Helpers nativos para evitar dependencias externas
const formatStock = (val: number | string | null) => {
  if (val === null || val === undefined) return '0'
  const num = Number(val)
  if (isNaN(num)) return '0'
  return Math.abs(num - Math.round(num)) < 0.0001 ? Math.round(num).toString() : num.toFixed(2)
}

const formatDate = (dateStr: string) => {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(date);
  } catch (e) {
    return dateStr;
  }
}

const formatRelative = (dateStr: string) => {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const now = new Date();
    const diffInDays = Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
    
    if (Math.abs(diffInDays) < 30) {
      return rtf.format(diffInDays, 'day');
    } else {
      const diffInMonths = Math.round(diffInDays / 30);
      return rtf.format(diffInMonths, 'month');
    }
  } catch (e) {
    return '';
  }
}

const formatDistanceSimple = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMins = Math.round(diffInMs / (1000 * 60));
    
    if (diffInMins < 60) return `hace ${diffInMins} min`;
    const diffInHours = Math.round(diffInMins / 60);
    if (diffInHours < 24) return `hace ${diffInHours} h`;
    const diffInDays = Math.round(diffInHours / 24);
    return `hace ${diffInDays} d`;
  } catch (e) {
    return '';
  }
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['stock-summary'],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', { params: { per_page: 1 } }).then((r) => r.data),
  })

  const { data: alertasResponse, isLoading: alertasLoading, isError: alertasError } = useQuery({
    queryKey: ['alertas'],
    queryFn: () => api.get<PaginatedResponse<Alerta>>('/stock/alertas', { params: { per_page: 100 } }).then((r) => r.data),
    refetchInterval: 60000,
    retry: 1,
  })

  const { data: movimientosRecientes, isLoading: loadingMovimientos } = useQuery({
    queryKey: ['movimientos-recientes'],
    queryFn: () => api.get<PaginatedResponse<Movimiento>>('/movimientos', { params: { per_page: 40 } }).then(r => r.data),
    refetchInterval: 60000
  })
const totalItems = stockData?.total ?? 0
const alerts = alertasResponse?.data ?? []

// Métricas para las tarjetas superiores - Alineado con lógica de Backend
const criticos = alerts.filter(a => 
  a.tipo_alerta === 'sin_stock' || 
  a.tipo_alerta === 'agotamiento_proximo' || 
  a.tipo_alerta === 'bajo_minimo'
).length

const porVencer = alerts.filter(a => 
  a.tipo_alerta === 'vencido' || 
  a.tipo_alerta === 'vence_30d' || 
  a.tipo_alerta === 'vence_90d'
).length

const quebrados = alerts.filter(a => a.tipo_alerta === 'sin_stock').length


  const alertaProductoIds = new Set(alerts.map(a => a.producto_id))
  
  const resoluciones = (movimientosRecientes?.data ?? []).filter(m => {
      const tiposResolucion = ['ENTRADA', 'AJUSTE_POSITIVO', 'RECEPCION']
      return tiposResolucion.includes(m.tipo) && !alertaProductoIds.has(m.producto_id)
  }).slice(0, 8)

  const loadingResoluciones = alertasLoading || loadingMovimientos

  return (
    <div className="p-4 sm:p-6 space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-base-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-base-content flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Package className="w-7 h-7 text-primary" />
            </div>
            Panel de Control
          </h1>
          <p className="text-sm text-base-content/50 mt-1">Gestión inteligente de inventario y alertas prioritarias</p>
        </div>
        <div className="flex items-center gap-2">
           <button 
             onClick={() => navigate('/stock')}
             className="btn btn-ghost btn-sm gap-2 font-bold opacity-70 hover:opacity-100"
           >
             <Search className="w-4 h-4" />
             Consultar Stock
           </button>
           <button 
             onClick={() => navigate('/solicitudes-compra')}
             className="btn btn-primary btn-sm gap-2 shadow-lg shadow-primary/20"
           >
             <ShoppingCart className="w-4 h-4" />
             Nuevo Pedido
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Insumos Activos"
          value={totalItems}
          icon={<Package className="w-5 h-5" />}
          color="bg-primary/10 text-primary"
          loading={stockLoading}
          onClick={() => navigate('/stock')}
        />
        <StatCard
          label="Sin Stock"
          value={quebrados}
          icon={<AlertCircle className="w-5 h-5" />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={quebrados > 0}
          onClick={() => navigate('/stock?filter=sin-stock')}
        />
        <StatCard
          label="Stock Crítico"
          value={criticos}
          icon={<TrendingDown className="w-5 h-5" />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={criticos > 0}
          onClick={() => navigate('/stock?alertas=true&filter=critico')}
        />
        <StatCard
          label="Por Vencer"
          value={porVencer}
          icon={<Clock className="w-5 h-5" />}
          color="bg-warning/10 text-warning"
          loading={alertasLoading}
          alert={porVencer > 0}
          onClick={() => navigate('/stock?alertas=true&filter=vencimiento')}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-base font-bold flex items-center gap-2">
              Alertas que requieren atención
              {alerts.length > 0 && (
                <span className="badge badge-error badge-sm font-bold text-white">{alerts.length}</span>
              )}
            </h2>
            <button 
              onClick={() => navigate('/stock?alertas=true')}
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
            >
              Ver todo el historial <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="bg-base-100/40 rounded-3xl border border-base-200/60 overflow-hidden shadow-sm backdrop-blur-sm">
            {alertasLoading ? (
              <div className="p-20 flex flex-col items-center gap-4 opacity-40">
                <span className="loading loading-spinner loading-lg text-primary"></span>
                <p className="font-bold text-sm">Analizando inventario...</p>
              </div>
            ) : alertasError ? (
              <div className="p-16 flex flex-col items-center justify-center text-center gap-3">
                <div className="p-4 bg-warning/10 text-warning rounded-full">
                  <AlertTriangle className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-warning">Error al cargar alertas</h3>
                  <p className="text-xs opacity-50 mt-1 max-w-xs mx-auto">No se pudo conectar con el servicio de alertas. Verifica que el backend esté funcionando correctamente.</p>
                </div>
                <button
                  className="btn btn-sm btn-ghost border border-warning/30 text-warning hover:bg-warning/10 rounded-xl"
                  onClick={() => window.location.reload()}
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <AlertList alerts={alerts} />
            )}
          </div>
        </div>

        <div className="xl:col-span-4 space-y-6">
          <div className="bg-base-100/40 rounded-3xl border border-base-200/60 p-5 shadow-sm backdrop-blur-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide opacity-50 mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Recuperaciones Recientes
            </h2>
            
            {loadingResoluciones ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-base-200/50 rounded-xl animate-pulse" />)}
              </div>
            ) : resoluciones.length === 0 ? (
              <div className="py-8 text-center opacity-30 italic text-sm">Sin acciones recientes</div>
            ) : (
              <div className="space-y-3">
                {resoluciones.map((res) => (
                  <div key={res.id} className="flex items-center gap-3 p-3 rounded-2xl bg-success/5 border border-success/10 group hover:bg-success/10 transition-colors">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <ArrowDownLeft className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate text-success">{res.producto_nombre}</p>
                      <p className="text-xs opacity-60 font-medium">Stock normalizado por {res.tipo}</p>
                    </div>
                    <div className="text-xs opacity-40 font-bold">
                       {res.created_at && formatDistanceSimple(res.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-primary/5 rounded-3xl border border-primary/10 p-5 relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
               <TrendingUp className="w-20 h-20" />
             </div>
             <div className="relative z-10">
               <h3 className="text-primary font-black text-sm mb-1 uppercase tracking-tight">Estado Operativo</h3>
               <p className="text-xs opacity-70 mb-4 font-medium italic">Todo el sistema está sincronizado correctamente.</p>
               <div className="flex items-center gap-4">
                  <div className="text-center px-4 border-r border-primary/10">
                    <p className="text-xl font-black text-primary">{totalItems}</p>
                    <p className="text-xs font-bold uppercase opacity-50">SKUs</p>
                  </div>
                  <div className="text-center px-4">
                    <p className="text-xl font-black text-error">{quebrados}</p>
                    <p className="text-xs font-bold uppercase opacity-50">Críticos</p>
                  </div>
               </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color, loading, alert, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "relative overflow-hidden group p-5 rounded-3xl border transition-all cursor-pointer",
        alert ? "bg-error/5 border-error/20 ring-1 ring-error/10 animate-subtle-pulse" : "bg-base-100/40 border-base-200/60 hover:border-primary/40 hover:bg-base-100/80 shadow-sm backdrop-blur-sm",
        "flex flex-col gap-1"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={cn("p-2.5 rounded-2xl transition-transform group-hover:scale-110 duration-300", color)}>
          {icon}
        </div>
        {alert && (
          <div className="w-2 h-2 rounded-full bg-error animate-ping" />
        )}
      </div>
      
      {loading ? (
        <div className="h-8 w-16 bg-base-300/30 animate-pulse rounded-lg mb-1" />
      ) : (
        <p className={cn("text-2xl font-bold tabular-nums", alert && "text-error")}>{value}</p>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</p>
      
      <div className="absolute top-0 right-0 -mr-4 -mt-4 opacity-5 group-hover:opacity-10 transition-opacity">
        {icon && React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: "w-24 h-24" })}
      </div>
    </div>
  )
}

function AlertList({ alerts }: { alerts?: Alerta[] }) {
  const navigate = useNavigate()
  
  if (!alerts) return null

  if (alerts.length === 0) {
    return (
      <div className="p-20 flex flex-col items-center justify-center text-center gap-4">
        <div className="p-4 bg-success/10 text-success rounded-full">
          <CheckCircle2 className="w-12 h-12" />
        </div>
        <div>
          <h3 className="text-lg font-bold italic">¡Todo bajo control!</h3>
          <p className="text-sm opacity-40 max-w-xs mx-auto">No hay alertas críticas en este momento. El inventario está operando normalmente.</p>
        </div>
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
    sin_stock: {
      label: 'Sin Stock',
      bg: 'bg-error/10 text-error border-error/20 ring-1 ring-error/30',
      icon: <AlertCircle />,
      actionLabel: 'Comprar YA',
      actionIcon: <ShoppingCart className="w-3 h-3" />,
      actionClass: 'btn-error text-white animate-pulse shadow-lg border-none',
      path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}`
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

  const groupedAlerts = Object.values(
    alerts.reduce((acc, alerta) => {
      if (!acc[alerta.producto_id]) acc[alerta.producto_id] = []
      acc[alerta.producto_id].push(alerta)
      return acc
    }, {} as Record<string, Alerta[]>)
  )

  return (
    <div className="max-h-[600px] overflow-y-auto space-y-2 p-2 custom-scrollbar">
      {groupedAlerts.slice(0, 50).map((group, i) => {
        const alerta = group[0]
        const config = severityConfig[alerta.tipo_alerta as keyof typeof severityConfig] ?? severityConfig.vence_90d
        
        const isBajoMinimo = group.some(a => a.tipo_alerta === 'bajo_minimo')
        const isAgotamiento = group.some(a => a.tipo_alerta === 'agotamiento_proximo')
        const isSinStock = group.some(a => a.tipo_alerta === 'sin_stock')
        const isDeadStock = group.some(a => a.tipo_alerta === 'dead_stock')
        const isAnomalia = group.some(a => a.tipo_alerta === 'anomalia_consumo')
        const isVencidoAlerta = group.some(a => a.tipo_alerta === 'vencido')
        const days = alerta.proxima_fecha_venc ? daysUntil(alerta.proxima_fecha_venc) : null
        const isVencidoReal = days !== null && days <= 0
        const isVenceSoon = days !== null && days > 0

        const totalLabel = formatStock(alerta.total)
        const minLabel = formatStock(alerta.stock_minimo)
        const isPlural = (alerta.total || 0) !== 1
        const unit = isPlural ? (alerta.unidad_plural ?? autoPlural(alerta.unidad || '')) : (alerta.unidad || '')

        return (
          <div
            key={`${alerta.producto_id}-${i}`}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-base-200/50 bg-base-100/50 p-4 hover:bg-base-200 hover:shadow-md transition-all group relative overflow-hidden"
          >
            <div className={cn("absolute left-0 top-0 bottom-0 w-1", config.bg.split(' ')[0])} />

            <div className="flex flex-col gap-1.5 min-w-0 flex-1 pl-2">
              <div className="flex flex-wrap items-center gap-2">
                {group.map(a => {
                   const aConfig = severityConfig[a.tipo_alerta as keyof typeof severityConfig] ?? severityConfig.vence_90d
                   return (
                     <span key={a.tipo_alerta} className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider', aConfig.bg)}>
                       {aConfig.label}
                     </span>
                   )
                })}
                <span className="text-sm font-bold truncate group-hover:text-primary transition-colors" title={alerta.nombre}>{alerta.nombre}</span>
              </div>

              <p className="text-sm opacity-60 font-medium">
                {isSinStock ? (
                  <span className="font-bold text-error uppercase italic ring-1 ring-error/20 px-1 rounded bg-error/5 flex items-center gap-1 w-fit">
                    <AlertCircle className="w-3 h-3" /> ¡Producto totalmente agotado!
                  </span>
                ) : isAgotamiento ? (
                  <>
                    Stock actual: <span className="font-bold text-error">{totalLabel}</span> {unit} |{' '}
                    <span className="text-error font-bold italic underline">Queda poco tiempo</span>
                  </>
                ) : isAnomalia && group.length === 1 ? (
                  <>Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} | <span className="text-secondary font-bold">Pico de consumo detectado</span></>
                ) : isBajoMinimo ? (
                  <>
                    Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} <span className="opacity-40">(Mín: {minLabel})</span>
                  </>
                ) : isDeadStock ? (
                    <span className="text-slate-500 font-bold">Sin movimientos hace {alerta.dias_inactivo || '90+'} días</span>
                ) : (
                  <>
                    Stock actual: <span className="font-bold text-base-content">{totalLabel}</span> {unit} |{' '}
                    {isVencidoReal || isVencidoAlerta ? (
                      <span className="text-error font-bold uppercase">Venció {alerta.proxima_fecha_venc && formatRelative(alerta.proxima_fecha_venc)}</span>
                    ) : isVenceSoon ? (
                      <span className="text-warning font-bold">Vence {alerta.proxima_fecha_venc && formatRelative(alerta.proxima_fecha_venc)}</span>
                    ) : (
                      <span>Vence el {alerta.proxima_fecha_venc && formatDate(alerta.proxima_fecha_venc)}</span>
                    )}
                  </>
                )}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
               {alerta.tiene_pedido_pendiente && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-info/10 text-info border border-info/20 text-xs font-bold animate-pulse">
                    <Truck className="w-3 h-3" /> EN CAMINO
                  </div>
                )}
                <button
                onClick={() => navigate(config.path(alerta))}
                className={cn(
                    "btn btn-sm h-10 px-4 rounded-xl font-black transition-all flex items-center gap-2",
                    config.actionClass || "btn-ghost border-base-200"
                )}
                >
                {config.actionIcon || <ChevronRight className="w-3.5 h-3.5" />}
                <span>{config.actionLabel || 'Ver detalles'}</span>
                </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

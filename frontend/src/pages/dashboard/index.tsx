import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Package,
  AlertTriangle,
  Clock,
  TrendingDown,
  ChevronRight,
  ShoppingCart,
  Search,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse, StockItem } from '@/types'
import { cn, daysUntil, autoPlural } from '@/lib/utils'

// Helpers nativos para evitar dependencias externas
const formatStock = (val: number | string | null) => {
  if (val === null || val === undefined) return '0'
  const num = Number(val)
  if (isNaN(num)) return '0'
  return Math.abs(num - Math.round(num)) < 0.0001 ? Math.round(num).toString() : num.toFixed(2)
}

// Formato compacto sin año: "15 ene" — distinto de formatDate en utils (que incluye año)
const formatDateShort = (dateStr: string) => {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(date);
  } catch {
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
  } catch {
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
          onClick={() => navigate('/stock?estado=sin_stock')}
        />
        <StatCard
          label="Stock Crítico"
          value={criticos}
          icon={<TrendingDown className="w-5 h-5" />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={criticos > 0}
          onClick={() => navigate('/stock?estado=critico')}
        />
        <StatCard
          label="Por Vencer"
          value={porVencer}
          icon={<Clock className="w-5 h-5" />}
          color="bg-warning/10 text-warning"
          loading={alertasLoading}
          alert={porVencer > 0}
          onClick={() => navigate('/stock?estado=vencimiento')}
        />
      </div>

      <div className="space-y-4">
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
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
  loading?: boolean
  alert?: boolean
  onClick?: () => void
}

function StatCard({ label, value, icon, color, loading, alert, onClick }: StatCardProps) {
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
          <h3 className="text-base font-bold">Todo bajo control</h3>
          <p className="text-sm opacity-40 max-w-xs mx-auto mt-1">No hay alertas en este momento.</p>
        </div>
      </div>
    )
  }

  const severityConfig = {
    vencido:           { label: 'Vencido',            bg: 'bg-error/10 text-error border-error/20',              path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}` },
    sin_stock:         { label: 'Sin Stock',           bg: 'bg-error/10 text-error border-error/20 ring-1 ring-error/30', path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}` },
    agotamiento_proximo: { label: 'Agotamiento',       bg: 'bg-error/10 text-error border-error/20 ring-1 ring-error/30', path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}` },
    bajo_minimo:       { label: 'Stock bajo',          bg: 'bg-error/10 text-error border-error/20',              path: (a: Alerta) => `/solicitudes-compra?select=${a.producto_id}` },
    vence_30d:         { label: 'Por vencer',          bg: 'bg-warning/10 text-warning border-warning/20',        path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}` },
    vence_90d:         { label: 'Aviso vencimiento',  bg: 'bg-info/10 text-info border-info/20',                 path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}` },
    dead_stock:        { label: 'Sin movimiento',      bg: 'bg-base-300 text-base-content border-base-content/20', path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}` },
    anomalia_consumo:  { label: 'Consumo inusual',     bg: 'bg-secondary/10 text-secondary border-secondary/20', path: (a: Alerta) => `/stock?search=${encodeURIComponent(a.nombre)}&select=${a.producto_id}` },
  }

  const groupedAlerts = Object.values(
    alerts.reduce((acc, alerta) => {
      if (!acc[alerta.producto_id]) acc[alerta.producto_id] = []
      acc[alerta.producto_id].push(alerta)
      return acc
    }, {} as Record<string, Alerta[]>)
  )

  return (
    <div className="max-h-[600px] overflow-y-auto space-y-1.5 p-2">
      {groupedAlerts.slice(0, 50).map((group, i) => {
        const alerta = group[0]
        const config = severityConfig[alerta.tipo_alerta as keyof typeof severityConfig] ?? severityConfig.vence_90d

        const isBajoMinimo    = group.some(a => a.tipo_alerta === 'bajo_minimo')
        const isAgotamiento   = group.some(a => a.tipo_alerta === 'agotamiento_proximo')
        const isSinStock      = group.some(a => a.tipo_alerta === 'sin_stock')
        const isDeadStock     = group.some(a => a.tipo_alerta === 'dead_stock')
        const isAnomalia      = group.some(a => a.tipo_alerta === 'anomalia_consumo')
        const isVencidoAlerta = group.some(a => a.tipo_alerta === 'vencido')
        const days = alerta.proxima_fecha_venc ? daysUntil(alerta.proxima_fecha_venc) : null
        const isVencidoReal = days !== null && days <= 0
        const isVenceSoon   = days !== null && days > 0

        const totalLabel = formatStock(alerta.total)
        const minLabel   = formatStock(alerta.stock_minimo)
        const isPlural   = (alerta.total || 0) !== 1
        const unit       = isPlural ? (alerta.unidad_plural ?? autoPlural(alerta.unidad || '')) : (alerta.unidad || '')

        return (
          <div
            key={alerta.producto_id}
            onClick={() => navigate(config.path(alerta))}
            className="cursor-pointer flex items-center gap-3 rounded-xl border border-base-200/50 bg-base-100/50 px-4 py-3 hover:bg-base-200 transition-colors group relative overflow-hidden"
          >
            <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', config.bg.split(' ')[0])} />

            <div className="flex flex-col gap-1 min-w-0 flex-1 pl-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {group.map(a => {
                  const aConfig = severityConfig[a.tipo_alerta as keyof typeof severityConfig] ?? severityConfig.vence_90d
                  return (
                    <span key={a.tipo_alerta} className={cn('inline-flex items-center rounded border px-1.5 py-px text-xs font-semibold uppercase tracking-wide', aConfig.bg)}>
                      {aConfig.label}
                    </span>
                  )
                })}
                <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors" title={alerta.nombre}>
                  {alerta.nombre}
                </span>
              </div>

              <p className="text-xs text-base-content/50">
                {isSinStock ? (
                  <span className="text-error font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Totalmente agotado
                  </span>
                ) : isAgotamiento ? (
                  <>Stock: <span className="font-semibold text-error">{totalLabel}</span> {unit} — queda poco</>
                ) : isAnomalia && group.length === 1 ? (
                  <>Stock: <span className="font-semibold">{totalLabel}</span> {unit} — pico de consumo detectado</>
                ) : isBajoMinimo ? (
                  <>Stock: <span className="font-semibold">{totalLabel}</span> {unit} <span className="opacity-60">(mín. {minLabel})</span></>
                ) : isDeadStock ? (
                  <>Sin movimientos hace {alerta.dias_inactivo || '90+'} días</>
                ) : (
                  <>
                    Stock: <span className="font-semibold">{totalLabel}</span> {unit} —{' '}
                    {isVencidoReal || isVencidoAlerta ? (
                      <span className="text-error font-semibold">venció {alerta.proxima_fecha_venc && formatRelative(alerta.proxima_fecha_venc)}</span>
                    ) : isVenceSoon ? (
                      <span className="text-warning font-semibold">vence {alerta.proxima_fecha_venc && formatRelative(alerta.proxima_fecha_venc)}</span>
                    ) : (
                      <>vence el {alerta.proxima_fecha_venc && formatDateShort(alerta.proxima_fecha_venc)}</>
                    )}
                  </>
                )}
              </p>
            </div>

            <ChevronRight className="w-4 h-4 opacity-20 flex-shrink-0 group-hover:opacity-60 transition-opacity" />
          </div>
        )
      })}
    </div>
  )
}

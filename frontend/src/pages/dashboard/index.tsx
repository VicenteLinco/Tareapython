import React from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  Package,
  AlertTriangle,
  Clock,
  TrendingDown,
  ChevronRight,
  ShoppingCart,
  AlertCircle,
  CheckCircle2,
  Activity,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse } from '@/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/page-state'

// ─── Tipos locales ────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Componentes de UI ────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
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
        'relative overflow-hidden group p-5 rounded-3xl border transition-all cursor-pointer',
        alert && value > 0
          ? 'bg-error/5 border-error/20 ring-1 ring-error/10'
          : 'bg-base-100/40 border-base-200/60 hover:border-primary/40 hover:bg-base-100/80 shadow-sm backdrop-blur-sm',
        'flex flex-col gap-1',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={cn('p-2.5 rounded-2xl transition-transform group-hover:scale-110 duration-300', color)}>
          {icon}
        </div>
        {alert && value > 0 && <div className="w-2 h-2 rounded-full bg-error animate-ping" />}
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-base-300/30 animate-pulse rounded-lg mb-1" />
      ) : (
        <p className={cn('text-2xl font-bold tabular-nums', alert && value > 0 && 'text-error')}>{value}</p>
      )}
      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</p>
      <div className="absolute top-0 right-0 -mr-4 -mt-4 opacity-5 group-hover:opacity-10 transition-opacity">
        {icon && React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-24 h-24' })}
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()

  const results = useQueries({
    queries: [
      {
        queryKey: ['stock-summary'],
        queryFn: () =>
          api.get<PaginatedResponse<unknown>>('/stock', { params: { per_page: 1 } }).then((r) => r.data),
      },
      {
        queryKey: ['alertas'],
        queryFn: () =>
          api.get<PaginatedResponse<Alerta>>('/stock/alertas', { params: { per_page: 200 } }).then((r) => r.data),
        refetchInterval: 60000,
        retry: 1,
      },
    ],
  })

  const [stockQ, alertasQ] = results
  const loading = results.some((r) => r.isLoading)

  const totalItems = stockQ.data?.total ?? 0
  const alerts = alertasQ.data?.data ?? []

  // ── Métricas de salud ────────────────────────────────────────────────────────
  const sinStock = alerts.filter((a) => a.tipo_alerta === 'sin_stock').length
  const criticos = alerts.filter(
    (a) => a.tipo_alerta === 'agotamiento_proximo' || a.tipo_alerta === 'bajo_minimo',
  ).length
  const porVencer = alerts.filter(
    (a) => a.tipo_alerta === 'vencido' || a.tipo_alerta === 'vence_30d' || a.tipo_alerta === 'vence_90d',
  ).length

  return (
    <div className="p-4 sm:p-6 space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500">
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-base-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-base-content flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            Panel de Control
          </h1>
          <p className="text-sm text-base-content/50 mt-1">Estado del inventario y acciones prioritarias</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/stock')}
            className="btn btn-ghost btn-sm gap-2 opacity-70 hover:opacity-100"
          >
            <Package className="w-4 h-4" />
            Stock
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

      {/* Sección: Salud del sistema */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <div className="p-1.5 rounded-lg bg-base-200/60 text-base-content/60">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-base-content/90 leading-none">Salud del sistema</h2>
            <p className="text-xs text-base-content/40 mt-0.5">Métricas generales del inventario</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Insumos Activos"
            value={totalItems}
            icon={<Package className="w-5 h-5" />}
            color="bg-primary/10 text-primary"
            loading={stockQ.isLoading}
            onClick={() => navigate('/stock')}
          />
          <StatCard
            label="Sin Stock"
            value={sinStock}
            icon={<AlertCircle className="w-5 h-5" />}
            color="bg-error/10 text-error"
            loading={alertasQ.isLoading}
            alert
            onClick={() => navigate('/stock?estado=sin_stock')}
          />
          <StatCard
            label="Stock Crítico"
            value={criticos}
            icon={<TrendingDown className="w-5 h-5" />}
            color="bg-warning/10 text-warning"
            loading={alertasQ.isLoading}
            alert
            onClick={() => navigate('/stock?estado=critico')}
          />
          <StatCard
            label="Por Vencer"
            value={porVencer}
            icon={<Clock className="w-5 h-5" />}
            color="bg-warning/10 text-warning"
            loading={alertasQ.isLoading}
            alert
            onClick={() => navigate('/stock?estado=vencimiento')}
          />
        </div>
      </div>

      {/* Alertas activas — enlace rápido */}
      {alerts.length > 0 && !alertasQ.isLoading && (
        <div className="flex items-center justify-between px-1 pt-2 border-t border-base-200">
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span>
              <span className="font-bold text-base-content">{alerts.length}</span> alertas activas en el
              inventario
            </span>
          </div>
          <button
            onClick={() => navigate('/stock?alertas=true')}
            className="btn btn-ghost btn-xs gap-1 font-semibold"
          >
            Ver todas <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {alertasQ.isError && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 flex items-center gap-3 text-warning/80">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="text-sm">No se pudo cargar el servicio de alertas. Verifica que el backend esté disponible.</span>
          <button
            className="ml-auto btn btn-xs btn-ghost border border-warning/30 text-warning"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && alerts.length === 0 && !alertasQ.isError && (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6 text-success" />}
          title="Inventario en buen estado"
          description="No hay alertas activas en ningún área."
          className="border-success/20 bg-success/5"
        />
      )}
    </div>
  )
}

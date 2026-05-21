import React, { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Package,
  PackageMinus,
  ShoppingCart,
  TrendingDown,
  X,
  Zap,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse } from '@/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/page-state'

interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'primary' | 'error' | 'warning' | 'info'
  loading?: boolean
  alert?: boolean
  onClick?: () => void
}

const statToneClasses = {
  primary: 'bg-primary/10 text-primary',
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/10 text-info',
} as const

function StatCard({ label, value, icon, tone, loading, alert, onClick }: StatCardProps) {
  const activeAlert = alert && value > 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-box border border-base-300 bg-base-100 px-4 py-3 text-left shadow-sm transition hover:border-primary/40 hover:bg-base-100 focus:outline-none focus:ring-2 focus:ring-primary/25',
        activeAlert && 'border-error/30 bg-error/5',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('rounded-lg p-2', statToneClasses[tone])}>{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-base-content/60">{label}</p>
          {loading ? <div className="skeleton mt-1 h-7 w-14" /> : <p className={cn('text-2xl font-bold leading-none tabular-nums', activeAlert && 'text-error')}>{value}</p>}
        </div>
      </div>
    </button>
  )
}

interface QuickActionProps {
  label: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}

function QuickAction({ label, description, icon, onClick }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2.5 text-left shadow-sm transition hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/25"
    >
      <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-base-content/55">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-base-content/35 transition group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const [alertBannerDismissed, setAlertBannerDismissed] = useState(() =>
    sessionStorage.getItem('dashboard_alert_dismissed') === '1',
  )
  const dismissAlertBanner = () => {
    sessionStorage.setItem('dashboard_alert_dismissed', '1')
    setAlertBannerDismissed(true)
  }

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

  const sinStock = alerts.filter((a) => a.tipo_alerta === 'sin_stock').length
  const criticos = alerts.filter(
    (a) => a.tipo_alerta === 'agotamiento_proximo' || a.tipo_alerta === 'bajo_minimo',
  ).length
  const porVencer = alerts.filter(
    (a) => a.tipo_alerta === 'vencido' || a.tipo_alerta === 'vence_30d' || a.tipo_alerta === 'vence_90d',
  ).length

  const alertasCriticas = alerts.filter((a) => ['sin_stock', 'vencido'].includes(a.tipo_alerta))
  const alertasWarning = alerts.filter((a) =>
    ['agotamiento_proximo', 'bajo_minimo', 'vence_30d'].includes(a.tipo_alerta),
  )
  const hayUrgencias = alertasCriticas.length > 0 || alertasWarning.length > 0
  const severidadBanner = alertasCriticas.length > 0 ? 'critica' : 'warning'
  const alertasMostradas = alertasCriticas.length > 0 ? alertasCriticas : alertasWarning
  const totalAlertasPrioritarias = alertasCriticas.length + alertasWarning.length

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="flex flex-col gap-3 border-b border-base-300 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <Activity className="h-4 w-4" />
            Inventario laboratorio
          </div>
          <h1 className="t-h1 text-base-content">Panel de control</h1>
          <p className="mt-1 max-w-2xl text-sm text-base-content/60">
            Estado operativo del inventario, alertas y accesos directos para las tareas del día.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate('/stock')} className="btn btn-outline btn-sm gap-2">
            <Package className="h-4 w-4" />
            Stock
          </button>
          <button
            type="button"
            onClick={() => navigate('/solicitudes-compra')}
            className="btn btn-primary btn-sm gap-2"
          >
            <ShoppingCart className="h-4 w-4" />
            Nuevo pedido
          </button>
        </div>
      </section>

      {hayUrgencias && !alertBannerDismissed && (
        <div className="relative overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
          <div
            className={cn(
              'absolute inset-y-0 left-0 w-1',
              severidadBanner === 'critica' ? 'bg-error' : 'bg-warning',
            )}
          />
          <div className="flex items-start gap-3 px-4 py-3 pl-5">
            <div
              className={cn(
                'mt-0.5 rounded-lg p-2',
                severidadBanner === 'critica' ? 'bg-error/10 text-error' : 'bg-warning/15 text-warning',
              )}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-base-content">
                  {alertasCriticas.length > 0
                    ? `${alertasCriticas.length} alerta${alertasCriticas.length !== 1 ? 's' : ''} crítica${alertasCriticas.length !== 1 ? 's' : ''}`
                    : `${alertasWarning.length} insumo${alertasWarning.length !== 1 ? 's' : ''} con stock bajo`}
                </h2>
                <span className="text-xs text-base-content/55">requiere revisión</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {alertasMostradas.slice(0, 4).map((a, i) => (
                  <button
                    type="button"
                    key={`${a.nombre}-${i}`}
                    onClick={() => navigate('/stock?alertas=true')}
                    className="max-w-full truncate rounded-full border border-base-300 bg-base-200/50 px-2.5 py-1 text-xs font-medium text-base-content/75 transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  >
                    {a.nombre}
                  </button>
                ))}
                {alertasMostradas.length > 4 && (
                  <button
                    type="button"
                    onClick={() => navigate('/stock?alertas=true')}
                    className="rounded-full border border-base-300 bg-base-200/50 px-2.5 py-1 text-xs font-medium text-base-content/65 transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  >
                    +{alertasMostradas.length - 4} más
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/stock?alertas=true')}
              className="btn btn-ghost btn-xs hidden shrink-0 gap-1 sm:inline-flex"
            >
              Ver
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={dismissAlertBanner} className="btn btn-ghost btn-xs btn-square shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Insumos activos"
          value={totalItems}
          icon={<Package className="h-4 w-4" />}
          tone="primary"
          loading={stockQ.isLoading}
          onClick={() => navigate('/stock')}
        />
        <StatCard
          label="Alertas"
          value={totalAlertasPrioritarias}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={totalAlertasPrioritarias > 0 ? 'warning' : 'info'}
          loading={alertasQ.isLoading}
          alert
          onClick={() => navigate('/stock?alertas=true')}
        />
        <StatCard
          label="Sin stock"
          value={sinStock}
          icon={<AlertCircle className="h-4 w-4" />}
          tone="error"
          loading={alertasQ.isLoading}
          alert
          onClick={() => navigate('/stock?estado=sin_stock')}
        />
        <StatCard
          label="Stock crítico"
          value={criticos}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="warning"
          loading={alertasQ.isLoading}
          alert
          onClick={() => navigate('/stock?estado=critico')}
        />
        <StatCard
          label="Por vencer"
          value={porVencer}
          icon={<Clock className="h-4 w-4" />}
          tone="info"
          loading={alertasQ.isLoading}
          alert
          onClick={() => navigate('/stock?estado=vence_pronto')}
        />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-base-content">Acciones frecuentes</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            label="Registrar consumo"
            description="Salida por uso"
            icon={<Zap className="h-5 w-5" />}
            onClick={() => navigate('/consumos')}
          />
          <QuickAction
            label="Nueva recepción"
            description="Ingreso de insumos"
            icon={<PackageMinus className="h-5 w-5" />}
            onClick={() => navigate('/recepciones')}
          />
          <QuickAction
            label="Nuevo descarte"
            description="Merma o vencimiento"
            icon={<TrendingDown className="h-5 w-5" />}
            onClick={() => navigate('/descartes')}
          />
          <QuickAction
            label="Nueva solicitud"
            description="Pedido a proveedor"
            icon={<ClipboardList className="h-5 w-5" />}
            onClick={() => navigate('/solicitudes-compra')}
          />
        </div>
      </section>

      {alertasQ.isError && (
        <div className="alert alert-warning rounded-box">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-sm">No se pudo cargar el servicio de alertas. Verifica que el backend esté disponible.</span>
          <button className="btn btn-ghost btn-xs" onClick={() => window.location.reload()}>
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

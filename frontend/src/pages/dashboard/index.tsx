import React, { useState } from 'react'
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
  X,
  Zap,
  PackageMinus,
  ClipboardList,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse } from '@/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/page-state'
import { Button } from '@/components/ui/button'

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

  const [alertBannerDismissed, setAlertBannerDismissed] = useState(() =>
    sessionStorage.getItem('dashboard_alert_dismissed') === '1'
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

  // ── Métricas de salud ────────────────────────────────────────────────────────
  const sinStock = alerts.filter((a) => a.tipo_alerta === 'sin_stock').length
  const criticos = alerts.filter(
    (a) => a.tipo_alerta === 'agotamiento_proximo' || a.tipo_alerta === 'bajo_minimo',
  ).length
  const porVencer = alerts.filter(
    (a) => a.tipo_alerta === 'vencido' || a.tipo_alerta === 'vence_30d' || a.tipo_alerta === 'vence_90d',
  ).length

  // ── Clasificación de alertas por severidad ───────────────────────────────────
  const alertasCriticas = alerts.filter((a) =>
    ['sin_stock', 'vencido'].includes(a.tipo_alerta)
  )
  const alertasWarning = alerts.filter((a) =>
    ['agotamiento_proximo', 'bajo_minimo', 'vence_30d'].includes(a.tipo_alerta)
  )
  const hayUrgencias = alertasCriticas.length > 0 || alertasWarning.length > 0
  const severidadBanner = alertasCriticas.length > 0 ? 'critica' : 'warning'
  const alertasMostradas = alertasCriticas.length > 0 ? alertasCriticas : alertasWarning

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto animate-in fade-in duration-500">
      {/* Encabezado */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-base-200 pb-6 mb-6">
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

      <div className="space-y-6">
        {/* ── Zona 1: Banner de alertas ─────────────────────────────────────────── */}
        {hayUrgencias && !alertBannerDismissed && (
          <div className={cn(
            'rounded-xl border p-4 relative',
            severidadBanner === 'critica'
              ? 'bg-destructive/10 border-destructive/30 text-destructive'
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
          )}>
            <button type="button" onClick={dismissAlertBanner}
              className="absolute top-3 right-3 opacity-60 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm mb-2">
                  {alertasCriticas.length > 0
                    ? `${alertasCriticas.length} alerta${alertasCriticas.length !== 1 ? 's' : ''} crítica${alertasCriticas.length !== 1 ? 's' : ''}`
                    : `${alertasWarning.length} insumo${alertasWarning.length !== 1 ? 's' : ''} con stock bajo`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {alertasMostradas.slice(0, 5).map((a, i) => (
                    <button type="button" key={i}
                      onClick={() => navigate('/stock')}
                      className="text-xs underline underline-offset-2 hover:no-underline">
                      {a.nombre}
                    </button>
                  ))}
                  {alertasMostradas.length > 5 && (
                    <button type="button" onClick={() => navigate('/stock')}
                      className="text-xs underline underline-offset-2 hover:no-underline">
                      +{alertasMostradas.length - 5} más
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Zona 2: Métricas ──────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Estado del inventario</h2>
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

        {/* ── Zona 3: Acceso rápido ─────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Acciones frecuentes</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Button variant="outline" className="h-auto py-4 flex-col gap-2 items-start"
              onClick={() => navigate('/consumos')}>
              <Zap className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">Registrar consumo</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2 items-start"
              onClick={() => navigate('/recepciones')}>
              <PackageMinus className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">Nueva recepción</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2 items-start"
              onClick={() => navigate('/descartes')}>
              <TrendingDown className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">Nuevo descarte</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2 items-start"
              onClick={() => navigate('/solicitudes-compra')}>
              <ClipboardList className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">Nueva solicitud</span>
            </Button>
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
    </div>
  )
}

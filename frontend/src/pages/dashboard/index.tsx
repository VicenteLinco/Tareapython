import { useQuery } from '@tanstack/react-query'
import { Package, AlertTriangle, Clock, TrendingDown, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { AlertasResponse, PaginatedResponse, StockItem } from '@/types'
import { daysUntil } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ['stock-summary'],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', { params: { per_page: 1 } }).then((r) => r.data),
  })

  const { data: alertas, isLoading: alertasLoading } = useQuery({
    queryKey: ['alertas'],
    queryFn: () => api.get<AlertasResponse>('/stock/alertas').then((r) => r.data),
    refetchInterval: 60000,
  })

  const totalItems = stockData?.total ?? 0
  const criticos = alertas?.bajo_minimo?.length ?? 0
  const porVencer = alertas?.por_vencer_30d?.length ?? 0
  const vencidos = alertas?.vencidos?.length ?? 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm opacity-50 mt-0.5">Resumen general del inventario</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Productos en Stock"
          value={totalItems}
          icon={<Package />}
          color="bg-primary/10 text-primary"
          loading={stockLoading}
        />
        <KpiCard
          label="Stock Bajo Mínimo"
          value={criticos}
          icon={<TrendingDown />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={criticos > 0}
        />
        <KpiCard
          label="Por Vencer (30d)"
          value={porVencer}
          icon={<Clock />}
          color="bg-warning/10 text-warning"
          loading={alertasLoading}
          alert={porVencer > 0}
        />
        <KpiCard
          label="Vencidos"
          value={vencidos}
          icon={<AlertTriangle />}
          color="bg-error/10 text-error"
          loading={alertasLoading}
          alert={vencidos > 0}
        />
      </div>

      {/* Alerts Section */}
      <div className="rounded-xl border border-base-200 bg-base-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <div>
            <h2 className="text-sm font-semibold">Alertas Activas</h2>
            <p className="text-xs opacity-40 mt-0.5">Productos que requieren atención</p>
          </div>
          <button
            className="btn btn-ghost btn-xs gap-1 opacity-50 hover:opacity-100"
            onClick={() => navigate('/stock')}
          >
            Ver inventario <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="p-2">
          {alertasLoading ? (
            <div className="space-y-1 p-3">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
            </div>
          ) : (
            <AlertList alertas={alertas} />
          )}
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
      'stat-card rounded-xl border bg-base-100 p-5',
      alert ? 'border-error/20' : 'border-base-200'
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium opacity-50 mb-1">{label}</p>
          {loading ? (
            <div className="skeleton h-9 w-14 rounded" />
          ) : (
            <p className="text-3xl font-bold tabular-nums">{value}</p>
          )}
        </div>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]', color)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function AlertList({ alertas }: { alertas?: AlertasResponse }) {
  if (!alertas) return null

  type Severity = 'vencido' | 'critico' | 'urgente' | 'aviso'
  const allAlerts: { producto_id: number; producto_nombre: string; tipo: string; detalle: string; severity: Severity }[] = [
    ...alertas.vencidos.map((a) => ({ ...a, severity: 'vencido' as const })),
    ...alertas.bajo_minimo.map((a) => ({ ...a, severity: 'critico' as const })),
    ...alertas.por_vencer_30d.map((a) => ({ ...a, severity: 'urgente' as const })),
    ...alertas.por_vencer_90d.map((a) => ({ ...a, severity: 'aviso' as const })),
  ]

  if (allAlerts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm opacity-40">Sin alertas activas</p>
        <p className="text-xs opacity-25 mt-1">Todo el inventario está en orden</p>
      </div>
    )
  }

  const severityConfig = {
    vencido: { label: 'Vencido', bg: 'bg-error/10 text-error border-error/20' },
    critico: { label: 'Stock bajo', bg: 'bg-error/10 text-error border-error/20' },
    urgente: { label: 'Por vencer', bg: 'bg-warning/10 text-warning border-warning/20' },
    aviso: { label: 'Aviso', bg: 'bg-info/10 text-info border-info/20' },
  }

  return (
    <div className="max-h-80 overflow-y-auto space-y-0.5">
      {allAlerts.slice(0, 50).map((alerta, i) => {
        const config = severityConfig[alerta.severity]
        const days = alerta.tipo === 'por_vencer_30d' || alerta.tipo === 'por_vencer_90d'
          ? daysUntil(alerta.detalle)
          : null
        return (
          <div
            key={`${alerta.producto_id}-${alerta.tipo}-${i}`}
            className="alert-item flex items-center justify-between rounded-lg px-4 py-3 hover:bg-base-200/60 cursor-default"
          >
            <div className="flex items-center gap-3">
              <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold', config.bg)}>
                {config.label}
              </span>
              <span className="text-sm font-medium">{alerta.producto_nombre}</span>
            </div>
            <span className="text-xs font-mono opacity-40">
              {days !== null ? `${days}d` : alerta.detalle}
            </span>
          </div>
        )
      })}
    </div>
  )
}

import { useState } from 'react'
import { Plus, ClipboardCheck, ChevronRight, CheckCircle2, Clock, XCircle, AlertCircle, CalendarClock, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useConteoList } from '@/features/conteo/hooks/use-conteo-list'
import { formatDate, cn } from '@/lib/utils'
import { PageLoading } from '@/components/ui/page-state'
import { EmptyState } from '@/components/ui/empty-state'
import { EstadoBadge } from '@/components/ui/estado-badge'
import { KeyboardLegend } from '@/components/ui/keyboard-legend'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import type { SesionConteo } from '@/types'

const ESTADO_CONFIG = {
  borrador:     { label: 'Borrador',    icon: AlertCircle,  className: 'badge-warning', tooltip: 'Sesión creada pero no iniciada. Puedes editarla o eliminarla.' },
  en_progreso:  { label: 'En progreso', icon: Clock,        className: 'badge-info',    tooltip: 'Sesión activa. Se están registrando conteos.' },
  confirmado:   { label: 'Confirmado',  icon: CheckCircle2, className: 'badge-success', tooltip: 'Sesión cerrada. Los ajustes ya se aplicaron al stock.' },
  cancelado:    { label: 'Cancelado',   icon: XCircle,      className: 'badge-ghost',   tooltip: 'Sesión cancelada. No se aplicaron ajustes.' },
} as const

interface AreaUrgencia {
  pct: number
  color: 'error' | 'warning' | 'success'
  label: string
}

function getAreaUrgencia(area: { conteo_frecuencia_dias: number }, pendiente: { dias_desde_ultimo: number | null } | undefined, periodoMax: number): AreaUrgencia {
  // Si el área no aparece en la lista de pendientes, fue contada recientemente y está al día
  if (pendiente === undefined) return { pct: 0, color: 'success', label: 'Al día' }
  const periodo = area.conteo_frecuencia_dias > 0 ? area.conteo_frecuencia_dias : periodoMax
  const dias = pendiente.dias_desde_ultimo
  if (dias === null) return { pct: 100, color: 'error', label: 'Nunca contada' }
  const pct = Math.min((dias / periodo) * 100, 120)
  if (pct >= 100) return { pct, color: 'error', label: `${Math.round(dias)}d · límite ${periodo}d` }
  if (pct >= 70) return { pct, color: 'warning', label: `${Math.round(dias)} de ${periodo} días` }
  return { pct, color: 'success', label: `${Math.round(dias)} de ${periodo} días` }
}

export default function ConteoPage() {
  const navigate = useNavigate()
  const { sesiones, isLoading, areas, areaStockStatus, pendientes, filters, actions, isCreating, periodoGlobalDias } = useConteoList()
  const [showModal, setShowModal] = useState(false)
  const [selectedAreaIds, setSelectedAreaIds] = useState<number[]>([])
  const [ocultarSinStock, setOcultarSinStock] = useState(true)

  // Atajos de teclado
  useKeyboardShortcut({ key: 'n', onKeyDown: () => setShowModal(true) })
  useKeyboardShortcut({
    key: 'Escape',
    ignoreInputs: false,
    onKeyDown: () => {
      if (showModal) {
        setShowModal(false)
        setSelectedAreaIds([])
      } else if (filters.areaId !== null) {
        actions.setArea(null)
      }
    },
  })

  const toggleArea = (id: number) => {
    setSelectedAreaIds(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const handleCrear = (overrideAreaId?: number) => {
    if (overrideAreaId != null) {
      actions.crear(overrideAreaId)
      return
    }
    if (selectedAreaIds.length === 0) return
    actions.crearMultiple(selectedAreaIds)
    setShowModal(false)
    setSelectedAreaIds([])
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="t-h1">Conteo de Inventario</h1>
            <p className="text-sm opacity-50">Sesiones de conteo físico</p>
          </div>
        </div>
        <KeyboardLegend shortcuts={[
          { keys: ['n'], description: 'Nueva sesión de conteo' },
          { keys: ['Esc'], description: 'Cerrar modal / limpiar filtro de área' },
        ]} />
      </div>

      {/* Áreas pendientes */}
      {pendientes.length > 0 ? (
        <div className="mb-5 bg-base-100 border border-base-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-base-200 bg-base-200/40">
            <CalendarClock className="h-4 w-4 text-warning" />
            <span className="text-sm font-bold">
              {pendientes.length} área{pendientes.length !== 1 ? 's' : ''} pendiente{pendientes.length !== 1 ? 's' : ''} de contar
            </span>
          </div>
          <div className="divide-y divide-base-200">
            {pendientes
              .slice()
              .sort((a, b) => (b.dias_desde_ultimo ?? 9999) - (a.dias_desde_ultimo ?? 9999))
              .map((p) => {
                const dias = p.dias_desde_ultimo
                const stockStatus = areaStockStatus[p.area_id]
                const isCheckingStock = stockStatus === 'loading'
                const sinStock = stockStatus === 'sin-stock'
                const isAtrasada = dias === null || dias > (p.frecuencia_dias ?? 30)
                const isProxima = !isAtrasada && dias !== null && dias >= (p.frecuencia_dias ?? 30) * 0.7
                const urgenciaLabel = dias === null
                  ? 'Nunca contada'
                  : isAtrasada
                    ? `Atrasada ${Math.round(dias)} días`
                    : isProxima
                      ? `Vence en ${Math.round((p.frecuencia_dias ?? 30) - dias)} días`
                      : `Hace ${Math.round(dias)} días`
                return (
                  <div key={p.area_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-base-200/30 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <MapPin className="h-3.5 w-3.5 opacity-30 shrink-0" />
                      <span className="text-sm font-medium truncate">{p.area_nombre}</span>
                      <span className={cn(
                        "text-[10px] font-bold shrink-0",
                        isAtrasada || dias === null ? "text-error" : isProxima ? "text-warning" : "text-base-content/40"
                      )}>
                        {urgenciaLabel}
                      </span>
                      {sinStock && <span className="badge badge-xs badge-ghost shrink-0">Sin stock</span>}
                    </div>
                    <button
                      className={cn(
                        "btn btn-xs shrink-0",
                        isAtrasada || dias === null ? "btn-error" : isProxima ? "btn-warning" : "btn-ghost"
                      )}
                      disabled={isCreating || isCheckingStock || sinStock}
                      onClick={() => handleCrear(p.area_id)}
                    >
                      {isCheckingStock ? 'Verificando...' : '+ Crear sesión'}
                    </button>
                  </div>
                )
              })}
          </div>
        </div>
      ) : (
        <div className="mb-5 bg-success/5 border border-success/20 rounded-xl px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <span className="text-sm text-success font-medium">Todas las áreas al día en conteo</span>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col gap-2 mb-4">
        <select
          className="select select-bordered select-sm w-48"
          value={filters.areaId ?? ''}
          onChange={(e) => actions.setArea(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Todas las áreas</option>
          {areas.filter((a) => a.activa).map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['', 'borrador', 'en_progreso', 'confirmado', 'cancelado'] as const).map((e) => (
            <button
              key={e}
              onClick={() => actions.setEstado(e)}
              className={cn(
                'btn btn-sm whitespace-nowrap',
                filters.estado === e ? 'btn-primary' : 'btn-ghost'
              )}
            >
              {e === '' ? 'Todos los estados' : ESTADO_CONFIG[e].label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <PageLoading label="Cargando sesiones de conteo..." />
      ) : (
        <div className="space-y-3">
          {(sesiones?.data ?? []).map((sesion) => (
            <SesionCard
              key={sesion.id}
              sesion={sesion}
              onClick={() => navigate(`/conteo/${sesion.id}`)}
            />
          ))}
          {sesiones?.data.length === 0 && (
            <EmptyState
              contexto="sin_conteos"
            />
          )}
        </div>
      )}

      {/* Paginación */}
      {sesiones && sesiones.total_pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            className="btn btn-sm btn-ghost"
            disabled={filters.page === 1}
            onClick={() => actions.setPage(filters.page - 1)}
          >
            Anterior
          </button>
          <span className="btn btn-sm btn-ghost pointer-events-none">
            {filters.page} / {sesiones.total_pages}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            disabled={filters.page >= sesiones.total_pages}
            onClick={() => actions.setPage(filters.page + 1)}
          >
            Siguiente
          </button>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 right-6 btn btn-primary btn-circle shadow-lg h-14 w-14"
        title="Nueva sesión de conteo"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Modal nueva sesión */}
      {showModal && (
        <div className="modal modal-open">
            <div className="modal-box max-w-md">
                <h3 className="font-bold text-lg mb-1">Nueva sesión de conteo</h3>
                <p className="text-sm opacity-50 mb-3">Selecciona las áreas a contar</p>

                <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
                    <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={ocultarSinStock}
                        onChange={e => setOcultarSinStock(e.target.checked)}
                    />
                    <span className="opacity-60">Ocultar áreas sin stock</span>
                </label>

                <div className="space-y-2 max-h-72 overflow-y-auto mb-4">
                    {areas
                        .filter(a => a.activa)
                        .filter(a => {
                            const status = areaStockStatus[a.id]
                            return !ocultarSinStock || status === 'loading' || status === 'con-stock'
                        })
                        .sort((a, b) => {
                            const pa = pendientes.find(p => p.area_id === a.id)
                            const pb = pendientes.find(p => p.area_id === b.id)
                            const ua = getAreaUrgencia(a, pa, periodoGlobalDias)
                            const ub = getAreaUrgencia(b, pb, periodoGlobalDias)
                            return ub.pct - ua.pct
                        })
                        .map(a => {
                            const pendiente = pendientes.find(p => p.area_id === a.id)
                            const stockStatus = areaStockStatus[a.id]
                            const isCheckingStock = stockStatus === 'loading'
                            const sinStock = stockStatus === 'sin-stock'
                            const urgencia = getAreaUrgencia(a, pendiente, periodoGlobalDias)
                            const selected = selectedAreaIds.includes(a.id)
                            return (
                                <label
                                    key={a.id}
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors',
                                        sinStock || isCheckingStock ? 'opacity-40 cursor-not-allowed bg-base-200/50' :
                                        selected ? 'bg-primary/10 border border-primary/30' :
                                        'hover:bg-base-200 border border-transparent'
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        className="checkbox checkbox-sm checkbox-primary"
                                        checked={selected}
                                        disabled={sinStock || isCheckingStock}
                                        onChange={() => !sinStock && !isCheckingStock && toggleArea(a.id)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-sm font-semibold">{a.nombre}</span>
                                            {isCheckingStock && <span className="badge badge-xs badge-ghost">Verificando</span>}
                                            {sinStock && <span className="badge badge-xs badge-ghost">Sin stock</span>}
                                        </div>
                                        {!sinStock && !isCheckingStock && (
                                            <>
                                                <div className="w-full bg-base-200 rounded-full h-1.5 mb-1">
                                                    <div
                                                        className={cn(
                                                            'h-1.5 rounded-full transition-all',
                                                            urgencia.color === 'error' ? 'bg-error' :
                                                            urgencia.color === 'warning' ? 'bg-warning' : 'bg-success'
                                                        )}
                                                        style={{ width: `${Math.min(urgencia.pct, 100)}%` }}
                                                    />
                                                </div>
                                                <span className={cn(
                                                    'text-[10px] font-medium',
                                                    urgencia.color === 'error' ? 'text-error' :
                                                    urgencia.color === 'warning' ? 'text-warning' : 'text-base-content/40'
                                                )}>{urgencia.label}</span>
                                            </>
                                        )}
                                    </div>
                                </label>
                            )
                        })
                    }
                </div>

                <div className="modal-action">
                    <button className="btn btn-ghost" onClick={() => { setShowModal(false); setSelectedAreaIds([]) }}>
                        Cancelar
                    </button>
                    <button
                        className="btn btn-primary"
                        disabled={selectedAreaIds.length === 0 || isCreating}
                        onClick={() => handleCrear()}
                    >
                        {isCreating
                            ? <span className="loading loading-spinner loading-sm" />
                            : selectedAreaIds.length > 1
                                ? `Iniciar ${selectedAreaIds.length} conteos`
                                : 'Iniciar conteo'
                        }
                    </button>
                </div>
            </div>
            <div className="modal-backdrop" onClick={() => { setShowModal(false); setSelectedAreaIds([]) }} />
        </div>
      )}
    </div>
  )
}

function SesionCard({ sesion, onClick }: { sesion: SesionConteo; onClick: () => void }) {
  const config = ESTADO_CONFIG[sesion.estado as keyof typeof ESTADO_CONFIG]
  const progreso = sesion.total_items > 0
    ? Math.round((sesion.items_contados / sesion.total_items) * 100)
    : 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-base-100 border border-base-200 rounded-xl p-4 hover:border-primary/40 hover:bg-base-200/50 transition-all active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <EstadoBadge estado={sesion.estado} size="sm" className="cursor-help" title={config.tooltip} />
          </div>
          <p className="font-semibold text-base truncate">{sesion.area_nombre}</p>
          <p className="text-sm opacity-50 mt-0.5">
            {sesion.usuario_creador_nombre} · {formatDate(sesion.created_at)}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 opacity-30 shrink-0 mt-1" />
      </div>

      {sesion.estado !== 'cancelado' && (
        <div className="mt-3">
          <div className="flex justify-between text-xs opacity-60 mb-1">
            <span>{sesion.items_contados} / {sesion.total_items} ítems</span>
            <span>{progreso}%</span>
          </div>
          <div className="w-full bg-base-200 rounded-full h-1.5">
            <div
              className={cn(
                'h-1.5 rounded-full transition-all',
                sesion.estado === 'confirmado' ? 'bg-success' : 'bg-primary'
              )}
              style={{ width: `${progreso}%` }}
            />
          </div>
        </div>
      )}
    </button>
  )
}

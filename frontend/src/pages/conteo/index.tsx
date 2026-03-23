import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, ClipboardCheck, ChevronRight, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { PaginatedSesiones, SesionConteo, Area } from '@/types'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

const ESTADO_CONFIG = {
  borrador:     { label: 'Borrador',     icon: AlertCircle,   className: 'badge-warning' },
  en_progreso:  { label: 'En progreso',  icon: Clock,         className: 'badge-info' },
  confirmado:   { label: 'Confirmado',   icon: CheckCircle2,  className: 'badge-success' },
  cancelado:    { label: 'Cancelado',    icon: XCircle,       className: 'badge-ghost' },
} as const

export default function ConteoPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [areaId, setAreaId] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['conteo', { filterEstado, page }],
    queryFn: () =>
      api.get<PaginatedSesiones>('/conteo', {
        params: {
          estado: filterEstado || undefined,
          page,
          per_page: 20,
        },
      }).then((r) => r.data),
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const crearMutation = useMutation({
    mutationFn: (area_id: number) =>
      api.post<{ id: string; total_items: number }>('/conteo', { area_id }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conteo'] })
      setShowModal(false)
      setAreaId('')
      navigate(`/conteo/${data.id}`)
    },
    onError: () => toast.error('Error al crear sesión de conteo'),
  })

  const handleCrear = () => {
    if (!areaId) return
    crearMutation.mutate(Number(areaId))
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ClipboardCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Conteo de Inventario</h1>
          <p className="text-sm opacity-50">Sesiones de conteo físico</p>
        </div>
      </div>

      {/* Filtro estado */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(['', 'borrador', 'en_progreso', 'confirmado', 'cancelado'] as const).map((e) => (
          <button
            key={e}
            onClick={() => { setFilterEstado(e); setPage(1) }}
            className={cn(
              'btn btn-sm whitespace-nowrap',
              filterEstado === e ? 'btn-primary' : 'btn-ghost'
            )}
          >
            {e === '' ? 'Todas' : ESTADO_CONFIG[e].label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.data ?? []).map((sesion) => (
            <SesionCard
              key={sesion.id}
              sesion={sesion}
              onClick={() => navigate(`/conteo/${sesion.id}`)}
            />
          ))}
          {data?.data.length === 0 && (
            <div className="text-center py-12 opacity-40">
              <ClipboardCheck className="h-10 w-10 mx-auto mb-3" />
              <p>No hay sesiones</p>
            </div>
          )}
        </div>
      )}

      {/* Paginación */}
      {data && data.total_pages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button
            className="btn btn-sm btn-ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="btn btn-sm btn-ghost pointer-events-none">
            {page} / {data.total_pages}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            disabled={page >= data.total_pages}
            onClick={() => setPage((p) => p + 1)}
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
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg mb-4">Nueva sesión de conteo</h3>
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text font-medium">Área a contar</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
              >
                <option value="">Seleccionar área...</option>
                {(areas ?? []).filter((a) => a.activa).map((a) => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => { setShowModal(false); setAreaId('') }}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={!areaId || crearMutation.isPending}
                onClick={handleCrear}
              >
                {crearMutation.isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : 'Iniciar conteo'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
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
            <span className={cn('badge badge-sm', config.className)}>
              {config.label}
            </span>
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

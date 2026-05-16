import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, FileText, FileX, ChevronLeft, ChevronRight, Trash2, CheckCircle2, X, Package, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { EmptyState, PageLoading } from '@/components/ui/page-state'
import { ProveedorSelect, ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import type { Proveedor, RecepcionListItem } from '@/types'
import { formatDate, daysUntil, cn, formatCantidad } from '@/lib/utils'
import { toast } from 'sonner'
import { useFilterStorage } from '@/hooks/use-filter-storage'

const PAGE_SIZE = 15

interface PaginatedRecepciones {
  data: RecepcionListItem[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

type TabActivo = 'borradores' | 'confirmadas' | 'todas'

// ── Tipos del detalle ──────────────────────────────────────────────────────

interface RecepcionHeader {
  id: string
  numero_documento: string
  proveedor_id: number
  proveedor_nombre: string
  proveedor_icono: string | null
  guia_despacho: string | null
  estado: string
  fecha_recepcion: string
  usuario_nombre: string
  created_at: string
}

interface DetalleItem {
  id: number
  producto_nombre: string
  numero_lote: string
  fecha_vencimiento: string
  presentacion_nombre: string
  cantidad_presentaciones: string
  factor_conversion_usado: string
  cantidad_unidades_base: string
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  area_destino: string
}

interface RecepcionDetalleResponse {
  recepcion: RecepcionHeader
  nota: string | null
  foto_documento: string | null
  detalle: DetalleItem[]
}

// ── Panel de detalle ───────────────────────────────────────────────────────

interface RecepcionDetailPanelProps {
  recepcionData: RecepcionDetalleResponse | undefined
  isLoading: boolean
  onClose: () => void
  onConfirmar: (id: string) => void
  onEliminar: (id: string) => void
  confirmarPending: boolean
  eliminarPending: boolean
}

function RecepcionDetailPanel({
  recepcionData,
  isLoading,
  onClose,
  onConfirmar,
  onEliminar,
  confirmarPending,
  eliminarPending,
}: RecepcionDetailPanelProps) {
  if (isLoading || !recepcionData) {
    return (
      <div className="rounded-xl border border-base-200 bg-base-100 flex items-center justify-center h-64 text-base-content/40">
        <div className="text-center space-y-2">
          <Package className="h-8 w-8 mx-auto opacity-30" />
          <p className="text-sm">{isLoading ? 'Cargando…' : 'Seleccioná una recepción'}</p>
        </div>
      </div>
    )
  }

  const { recepcion, nota, detalle } = recepcionData
  const esConfirmada = recepcion.estado === 'completa' || recepcion.estado === 'confirmada'

  return (
    <div className="rounded-xl border border-base-200 bg-base-100 overflow-hidden flex flex-col max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <p className="font-mono font-semibold text-sm leading-tight">{recepcion.numero_documento}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <ProveedorIcon
              proveedor={{ nombre: recepcion.proveedor_nombre, icono: recepcion.proveedor_icono }}
              className="h-3.5 w-3.5 shrink-0 opacity-60"
            />
            <p className="text-xs text-base-content/50 truncate">{recepcion.proveedor_nombre}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={esConfirmada ? 'success' : 'secondary'} className="text-[11px]">
            {esConfirmada
              ? <><CheckCircle2 className="inline h-3 w-3 mr-0.5" />Confirmada</>
              : <><Clock className="inline h-3 w-3 mr-0.5" />Borrador</>
            }
          </Badge>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-xs btn-circle"
            aria-label="Cerrar panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body scrolleable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">Fecha</p>
            <p className="font-medium">{formatDate(recepcion.fecha_recepcion)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">Registrado por</p>
            <p className="font-medium">{recepcion.usuario_nombre}</p>
          </div>
          {recepcion.guia_despacho && (
            <div className="col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">Guía de despacho</p>
              <p className="font-mono font-medium">{recepcion.guia_despacho}</p>
            </div>
          )}
        </div>

        {nota && (
          <div className="rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning-content">
            <p className="font-semibold mb-0.5 opacity-60 uppercase text-[10px] tracking-wider">Nota</p>
            <p>{nota}</p>
          </div>
        )}

        {/* Ítems */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-2 flex items-center gap-1.5">
            <Package className="h-3 w-3" />
            Ítems recibidos ({detalle.length})
          </p>
          {detalle.length === 0 ? (
            <p className="text-xs opacity-40 text-center py-4">Sin ítems</p>
          ) : (
            <div className="space-y-0 rounded-lg border border-base-200 overflow-hidden">
              {detalle.map((item) => {
                const days = daysUntil(item.fecha_vencimiento)
                const isExpired = days !== null && days <= 0
                const isSoon = days !== null && days > 0 && days <= 30
                const qty = parseFloat(item.cantidad_unidades_base)
                const qtyPres = parseFloat(item.cantidad_presentaciones)
                const factor = parseFloat(item.factor_conversion_usado)
                const qtyPresStr = Math.abs(qtyPres - Math.round(qtyPres)) < 0.0001
                  ? Math.round(qtyPres).toString()
                  : qtyPres.toFixed(2)
                const tienePresent = factor !== 1

                return (
                  <div
                    key={item.id}
                    className="px-3 py-2 border-b border-base-200 last:border-0 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{item.producto_nombre}</p>
                      <p className="text-[10px] font-mono text-base-content/40 mt-0.5">{item.numero_lote}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className={cn(
                          'text-[10px]',
                          isExpired ? 'text-error font-semibold' : isSoon ? 'text-warning font-semibold' : 'text-base-content/40'
                        )}>
                          {formatDate(item.fecha_vencimiento)}
                        </span>
                        {isExpired && <Badge variant="destructive" className="text-[9px] py-0 px-1">Venc.</Badge>}
                        {isSoon && !isExpired && <Badge variant="warning" className="text-[9px] py-0 px-1">{days}d</Badge>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {tienePresent ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-mono font-semibold">{qtyPresStr} {item.presentacion_nombre}</span>
                          <span className="text-[10px] text-base-content/40 font-mono">
                            = {formatCantidad(qty, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs font-mono font-semibold">
                          {formatCantidad(qty, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                        </span>
                      )}
                      <p className="text-[10px] text-base-content/40 mt-0.5">{item.area_destino}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Acciones para borradores */}
      {!esConfirmada && (
        <div className="border-t border-base-200 p-3 flex gap-2 shrink-0">
          <button
            className="btn btn-sm btn-success flex-1 gap-1"
            disabled={confirmarPending}
            onClick={() => onConfirmar(recepcion.id)}
          >
            {confirmarPending
              ? <span className="loading loading-spinner loading-xs" />
              : <CheckCircle2 className="h-3.5 w-3.5" />
            }
            Confirmar
          </button>
          <button
            className="btn btn-sm btn-error btn-outline gap-1"
            disabled={eliminarPending}
            onClick={() => {
              if (confirm('¿Eliminar este borrador?')) onEliminar(recepcion.id)
            }}
          >
            {eliminarPending
              ? <span className="loading loading-spinner loading-xs" />
              : <Trash2 className="h-3.5 w-3.5" />
            }
          </button>
        </div>
      )}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────

export default function RecepcionesPage() {
  const REC_FILTER_DEFAULTS = { tabActivo: 'borradores' as TabActivo, proveedorFiltro: null as number | null }
  const { filters: rf, setFilters: setRf, clearFilters: clearRf, hasActiveFilters: hasRfActive } = useFilterStorage('recepciones', REC_FILTER_DEFAULTS)
  const tabActivo = rf.tabActivo
  const proveedorFiltro = rf.proveedorFiltro
  const setTabActivo = (v: TabActivo) => setRf(f => ({ ...f, tabActivo: v }))
  const setProveedorFiltro = (v: number | null) => setRf(f => ({ ...f, proveedorFiltro: v }))

  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Reset page on tab/filter change
  useEffect(() => { setPage(1) }, [tabActivo, proveedorFiltro])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['recepciones', { tab: tabActivo, search, proveedorFiltro, page }],
    queryFn: () =>
      api.get<PaginatedRecepciones>('/recepciones', {
        params: {
          estado: tabActivo === 'borradores' ? 'borrador' :
                  tabActivo === 'confirmadas' ? 'confirmada' : undefined,
          q: search || undefined,
          proveedor_id: proveedorFiltro || undefined,
          per_page: PAGE_SIZE,
          page,
        },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  // Query de detalle inline (solo desktop)
  const { data: selectedRecepcion, isLoading: loadingDetalle } = useQuery({
    queryKey: ['recepcion-detalle-inline', selectedId],
    queryFn: () => api.get<RecepcionDetalleResponse>(`/recepciones/${selectedId}`).then(r => r.data),
    enabled: !!selectedId,
  })

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/recepciones/${id}/confirmar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      queryClient.invalidateQueries({ queryKey: ['recepcion-detalle-inline', selectedId] })
      toast.success('Recepción confirmada')
    },
    onError: () => toast.error('Error al confirmar recepción'),
  })

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recepciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      setSelectedId(null)
      toast.success('Borrador eliminado')
    },
    onError: () => toast.error('Error al eliminar borrador'),
  })

  const handleRowClick = (id: string) => {
    if (window.innerWidth >= 1024) {
      setSelectedId(prev => prev === id ? null : id)
    } else {
      navigate(`/recepciones/${id}`)
    }
  }

  const pageRows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.total_pages ?? 1

  const tabs: { key: TabActivo; label: string }[] = [
    { key: 'borradores', label: 'Borradores' },
    { key: 'confirmadas', label: 'Confirmadas' },
    { key: 'todas', label: 'Todas' },
  ]

  return (
    <div className={cn('flex gap-6 items-start', selectedId && 'lg:items-stretch')}>
      {/* ── Columna izquierda: lista ── */}
      <div className={cn(
        'min-w-0 transition-all duration-200 space-y-4',
        selectedId ? 'lg:flex-[3]' : 'w-full'
      )}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Recepciones</h1>
          <button className="btn btn-primary" onClick={() => navigate('/recepciones/nueva')}>
            <Plus className="h-4 w-4" />
            Nueva Recepción
          </button>
        </div>

        {/* Tabs */}
        <div role="tablist" className="tabs tabs-boxed w-fit">
          {tabs.map(tab => (
            <button
              key={tab.key}
              role="tab"
              className={`tab ${tabActivo === tab.key ? 'tab-active' : ''}`}
              onClick={() => setTabActivo(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="rounded-xl border border-base-200 bg-base-100 p-3 flex flex-wrap gap-2 items-end">
          {/* Buscador */}
          <fieldset className="fieldset p-0 gap-1 min-w-[200px] flex-1">
            <legend className="fieldset-legend text-[10px]">Buscar</legend>
            <label className="input input-bordered flex items-center gap-2 h-9">
              <Search className="h-3.5 w-3.5 opacity-40 shrink-0" />
              <input
                type="text"
                className="grow text-sm min-w-0"
                placeholder="N° doc, proveedor, guía…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {isFetching && (
                <span className="loading loading-spinner loading-xs opacity-40" />
              )}
            </label>
          </fieldset>

          {/* Proveedor */}
          <fieldset className="fieldset p-0 gap-1">
            <legend className="fieldset-legend text-[10px]">Proveedor</legend>
            <ProveedorSelect
              value={proveedorFiltro ? String(proveedorFiltro) : ''}
              onChange={(v) => setProveedorFiltro(v ? Number(v) : null)}
              proveedores={proveedores ?? []}
              allLabel="Todos"
              className="w-44 h-9"
              size="md"
            />
          </fieldset>

          {(hasRfActive || search) && (
            <button
              onClick={() => { clearRf(); setSearchInput(''); setSearch(''); setPage(1) }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-base-300 text-[11px] font-bold text-base-content/60 hover:text-error hover:border-error/40 transition-all self-end mb-0.5"
            >
              <X className="w-3 h-3" />
              Limpiar filtros
            </button>
          )}
        </div>

        {isLoading ? (
          <PageLoading label="Cargando recepciones..." />
        ) : (
          <>
            <div className="rounded-xl border border-base-200 overflow-hidden">
              <table className="table table-sm w-full">
                <thead className="bg-base-200/60 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="font-semibold opacity-60">N° Documento</th>
                    <th className="font-semibold opacity-60">Proveedor</th>
                    <th className="font-semibold opacity-60">Fecha</th>
                    <th className="font-semibold opacity-60 hidden md:table-cell">Usuario</th>
                    <th className="font-semibold opacity-60">Estado</th>
                    <th className="font-semibold opacity-60 w-4"></th>
                    {tabActivo === 'borradores' && (
                      <th className="font-semibold opacity-60 text-right">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={tabActivo === 'borradores' ? 7 : 6} className="py-6">
                        <EmptyState
                          icon={<FileText className="h-6 w-6" />}
                          title="No hay recepciones"
                          description="Ajusta los filtros o crea una nueva recepción."
                          className="border-none bg-transparent p-6"
                        />
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((item) => (
                      <tr
                        key={item.id}
                        className={cn(
                          'hover:bg-base-200/30 border-base-200/60 cursor-pointer transition-colors',
                          selectedId === item.id && 'bg-primary/5 border-l-2 border-l-primary'
                        )}
                        onClick={() => handleRowClick(item.id)}
                      >
                        <td>
                          <span className="font-mono text-sm font-medium">{item.numero_documento}</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProveedorIcon proveedor={{ nombre: item.proveedor_nombre, icono: item.proveedor_icono }} className="h-5 w-5" />
                            <span className="text-sm">{item.proveedor_nombre}</span>
                          </div>
                        </td>
                        <td className="text-sm">{formatDate(item.fecha_recepcion)}</td>
                        <td className="text-sm hidden md:table-cell">{item.usuario_nombre}</td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={item.estado === 'completa' || item.estado === 'confirmada' ? 'success' : 'secondary'}>
                              {item.estado === 'completa' || item.estado === 'confirmada' ? 'Confirmada' : 'Borrador'}
                            </Badge>
                            {/* Badge items/lotes */}
                            {item.items_count > 0 && (
                              <span className="text-[9px] text-base-content/40 font-medium">
                                {item.items_count} {item.items_count === 1 ? 'item' : 'items'} · {item.lotes_count} {item.lotes_count === 1 ? 'lote' : 'lotes'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {/* Completitud para borradores */}
                          {(item.estado === 'borrador') ? (
                            item.items_count > 0 && item.lotes_count >= item.items_count
                              ? <span className="text-[9px] font-bold text-success flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Listo</span>
                              : <span className="text-[9px] font-bold text-warning flex items-center gap-1" title="Faltan lotes en algunos items">⚠ Incompleto</span>
                          ) : (
                            item.tiene_foto
                              ? <FileText className="h-4 w-4 text-primary/60" />
                              : <FileX className="h-4 w-4 text-base-content/20" />
                          )}
                        </td>
                        {tabActivo === 'borradores' && (
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                className="btn btn-xs btn-success gap-1"
                                disabled={confirmarMutation.isPending || (item.items_count > 0 && item.lotes_count < item.items_count)}
                                title={item.items_count > 0 && item.lotes_count < item.items_count ? 'Faltan lotes en algunos items' : undefined}
                                onClick={() => confirmarMutation.mutate(item.id)}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Confirmar
                              </button>
                              <button
                                className="btn btn-xs btn-ghost text-error"
                                disabled={eliminarMutation.isPending}
                                onClick={() => {
                                  if (confirm('¿Eliminar este borrador?')) eliminarMutation.mutate(item.id)
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-50 text-xs">
                {total} resultado{total !== 1 ? 's' : ''} · página {page} de {totalPages}
              </span>
              <div className="join">
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {(() => {
                  const pages: (number | null)[] = []
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i)
                  } else {
                    pages.push(1)
                    if (page > 3) pages.push(null)
                    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
                    if (page < totalPages - 2) pages.push(null)
                    pages.push(totalPages)
                  }
                  return pages.map((p, i) =>
                    p === null ? (
                      <button key={`ellipsis-${i}`} className="join-item btn btn-sm btn-ghost btn-disabled">…</button>
                    ) : (
                      <button
                        key={p}
                        className={`join-item btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    )
                  )
                })()}
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Panel detalle: solo desktop, solo cuando hay selección ── */}
      {selectedId && (
        <div className="hidden lg:flex lg:flex-[2] lg:sticky lg:top-24 flex-col min-w-0">
          <RecepcionDetailPanel
            recepcionData={selectedRecepcion}
            isLoading={loadingDetalle}
            onClose={() => setSelectedId(null)}
            onConfirmar={(id) => confirmarMutation.mutate(id)}
            onEliminar={(id) => eliminarMutation.mutate(id)}
            confirmarPending={confirmarMutation.isPending}
            eliminarPending={eliminarMutation.isPending}
          />
        </div>
      )}
    </div>
  )
}

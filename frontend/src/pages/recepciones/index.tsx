import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, FileText, FileX, ChevronLeft, ChevronRight, Trash2, CheckCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { ProveedorSelect, ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import type { Proveedor } from '@/types'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'

const PAGE_SIZE = 15

interface PaginatedRecepciones {
  data: RecepcionRow[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

interface RecepcionRow {
  id: string
  numero_documento: string
  proveedor_nombre: string
  proveedor_icono: string | null
  guia_despacho?: string | null
  estado: string
  fecha_recepcion: string
  usuario_nombre: string
  created_at: string
  areas_destino: string | null
  tiene_foto: boolean
}

type TabActivo = 'borradores' | 'confirmadas' | 'todas'

export default function RecepcionesPage() {
  const [tabActivo, setTabActivo] = useState<TabActivo>('borradores')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [proveedorFiltro, setProveedorFiltro] = useState<number | null>(null)
  const [page, setPage] = useState(1)
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

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/recepciones/${id}/confirmar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      toast.success('Recepción confirmada')
    },
    onError: () => toast.error('Error al confirmar recepción'),
  })

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recepciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      toast.success('Borrador eliminado')
    },
    onError: () => toast.error('Error al eliminar borrador'),
  })

  const pageRows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.total_pages ?? 1

  const tabs: { key: TabActivo; label: string }[] = [
    { key: 'borradores', label: 'Borradores' },
    { key: 'confirmadas', label: 'Confirmadas' },
    { key: 'todas', label: 'Todas' },
  ]

  return (
    <div className="space-y-4">
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
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 w-full" />)}
        </div>
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
                    <td colSpan={tabActivo === 'borradores' ? 7 : 6} className="text-center py-8 text-sm opacity-40">
                      No hay recepciones
                    </td>
                  </tr>
                ) : (
                  pageRows.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-base-200/30 border-base-200/60 cursor-pointer"
                      onClick={() => navigate(`/recepciones/${item.id}`)}
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
                        <Badge variant={item.estado === 'completa' || item.estado === 'confirmada' ? 'success' : 'secondary'}>
                          {item.estado === 'completa' || item.estado === 'confirmada' ? 'Confirmada' : 'Borrador'}
                        </Badge>
                      </td>
                      <td>
                        {item.tiene_foto
                          ? <FileText className="h-4 w-4 text-primary/60" />
                          : <FileX className="h-4 w-4 text-base-content/20" />
                        }
                      </td>
                      {tabActivo === 'borradores' && (
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              className="btn btn-xs btn-success gap-1"
                              disabled={confirmarMutation.isPending}
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
  )
}

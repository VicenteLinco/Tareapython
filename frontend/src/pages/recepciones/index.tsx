import { useState, useEffect, useRef } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, CalendarRange, FileText, FileX, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { ProveedorSelect, ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import type { Proveedor, Area } from '@/types'
import { formatDate } from '@/lib/utils'
import { useAreaStore } from '@/hooks/use-area-store'

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

export default function RecepcionesPage() {
  const { selectedAreaId } = useAreaStore()

  const [proveedorId, setProveedorId] = useState('')
  const [estado, setEstado] = useState('')
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [areaId, setAreaId] = useState(selectedAreaId ? String(selectedAreaId) : '')

  // Sync with global area filter
  useEffect(() => {
    setAreaId(selectedAreaId ? String(selectedAreaId) : '')
    setPage(1)
  }, [selectedAreaId])
  const [page, setPage] = useState(1)
  const navigate = useNavigate()

  // Debounce search input — 350ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setBusqueda(busquedaInput)
      setPage(1)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [busquedaInput])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [proveedorId, estado, fechaDesde, fechaHasta, areaId])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['recepciones', { proveedorId, estado, busqueda, fechaDesde, fechaHasta, areaId, page }],
    queryFn: () =>
      api.get<PaginatedRecepciones>('/recepciones', {
        params: {
          proveedor_id: proveedorId || undefined,
          estado: estado || undefined,
          busqueda: busqueda || undefined,
          desde: fechaDesde || undefined,
          hasta: fechaHasta || undefined,
          area_id: areaId || undefined,
          page,
          per_page: PAGE_SIZE,
        },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const pageRows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.total_pages ?? 1

  const columns = [
    {
      key: 'numero_documento',
      header: 'N° Documento',
      render: (item: RecepcionRow) => (
        <span className="font-mono text-sm font-medium">{item.numero_documento}</span>
      ),
    },
    {
      key: 'guia_despacho',
      header: 'Guía Despacho',
      className: 'hidden md:table-cell',
      render: (item: RecepcionRow) => (
        <span className="font-mono text-sm opacity-70">{item.guia_despacho ?? '—'}</span>
      ),
    },
    {
      key: 'proveedor_nombre',
      header: 'Proveedor',
      render: (item: RecepcionRow) => (
        <div className="flex items-center gap-2">
          <ProveedorIcon proveedor={{ nombre: item.proveedor_nombre, icono: item.proveedor_icono }} className="h-5 w-5" />
          <span className="text-sm">{item.proveedor_nombre}</span>
        </div>
      ),
    },
    {
      key: 'fecha_recepcion',
      header: 'Fecha',
      render: (item: RecepcionRow) => formatDate(item.fecha_recepcion),
    },
    {
      key: 'areas_destino',
      header: 'Sección / Área',
      className: 'hidden lg:table-cell',
      render: (item: RecepcionRow) => (
        <span className="text-sm opacity-70">{item.areas_destino ?? '—'}</span>
      ),
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (item: RecepcionRow) => (
        <Badge variant={item.estado === 'completa' || item.estado === 'confirmada' ? 'success' : 'secondary'}>
          {item.estado === 'completa' || item.estado === 'confirmada' ? 'Confirmada' : 'Borrador'}
        </Badge>
      ),
    },
    {
      key: 'tiene_foto',
      header: '',
      render: (item: RecepcionRow) =>
        item.tiene_foto ? (
          <FileText className="h-4 w-4 text-primary/60" />
        ) : (
          <FileX className="h-4 w-4 text-base-content/20" />
        ),
    },
    { key: 'usuario_nombre', header: 'Usuario', className: 'hidden md:table-cell' },
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
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
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
            value={proveedorId}
            onChange={(v) => setProveedorId(v)}
            proveedores={proveedores ?? []}
            allLabel="Todos"
            className="w-44 h-9"
            size="md"
          />
        </fieldset>

        {/* Área */}
        <fieldset className="fieldset p-0 gap-1">
          <legend className="fieldset-legend text-[10px]">Sección / Área</legend>
          <select
            className="select select-bordered w-44 h-9 text-sm"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">Todas las áreas</option>
            {(areas ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </fieldset>

        {/* Estado */}
        <fieldset className="fieldset p-0 gap-1">
          <legend className="fieldset-legend text-[10px]">Estado</legend>
          <select
            className="select select-bordered w-36 h-9 text-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="completa">Confirmada</option>
          </select>
        </fieldset>

        {/* Rango de fechas */}
        <fieldset className="fieldset p-0 gap-1">
          <legend className="fieldset-legend text-[10px] flex items-center gap-1">
            <CalendarRange className="h-3 w-3" />
            Rango de fechas
          </legend>
          <div className="join">
            <input
              type="date"
              className="input input-bordered join-item h-9 w-36 text-sm"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              title="Desde"
            />
            <span className="join-item flex items-center px-2 bg-base-200 border border-base-300 text-xs opacity-50 select-none">
              →
            </span>
            <input
              type="date"
              className="input input-bordered join-item h-9 w-36 text-sm"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              title="Hasta"
            />
          </div>
        </fieldset>

      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 w-full" />)}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns as any}
            data={pageRows as unknown as Record<string, unknown>[]}
            onRowClick={(item) => navigate(`/recepciones/${(item as unknown as RecepcionRow).id}`)}
            emptyMessage="No hay recepciones"
          />

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

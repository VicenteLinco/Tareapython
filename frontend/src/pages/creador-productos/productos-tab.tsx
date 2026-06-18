import { useState, useRef, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Eye, Tag, FileText, RotateCcw, Copy, Download, LayoutGrid, Table2, PackagePlus } from 'lucide-react'
import { comprimirImagen } from '@/lib/image-utils'
import { ProductoImage } from '@/components/ui/producto-image'
import { DataTable } from '@/components/ui/data-table'
import { PageLoading } from '@/components/ui/page-state'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet } from '@/components/ui/sheet'
import { ProveedorSelect, ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { PresFormato } from '@/lib/pres-formatos'
import type {
  PaginatedResponse,
  Categoria,
  UnidadBasica,
  Area,
  Proveedor,
  Presentacion,
  CreateProducto,
  UpdateProducto,
} from '@/types'

// Matches actual backend response for the list endpoint
interface ProductoListItem {
  id: string
  codigo_interno: string | null
  nombre: string
  categoria: { id: number; nombre: string } | null
  unidad_base: { id: number; nombre: string }
  proveedor: { id: number; nombre: string; icono: string | null } | null
  area: { id: number; nombre: string } | null
  stock_minimo: string
  activo: boolean
  estado_stock?: 'activo' | 'inactivo' | 'pendiente_inicializar' | 'sin_stock'
  version: number
  imagen_url?: string | null
}

interface ProveedorProductoItem {
  id?: number
  proveedor_id: number
  proveedor_nombre?: string
  proveedor_icono?: string | null
  es_principal: boolean
  codigo_proveedor?: string | null
  codigo_maestro?: string | null
  presentacion_id?: number | null
  presentacion?: Presentacion | null
  pres_nombre?: string
  pres_nombre_plural?: string
  pres_factor?: string
  pres_codigo_barras?: string
  pres_gtin?: string
  pres_gs1_habilitado?: boolean
  precio_unidad?: string | null
  lead_time_dias?: number | null
  unidad_minima_pedido?: string | null
  imagen_url?: string | null
  imagen_data_url?: string | null
  activo?: boolean
  version?: number
}

interface ProductoDetailResponse {
  id: string
  codigo_interno: string | null
  nombre: string
  descripcion: string | null
  categoria_id?: number | null
  categoria?: { id: number; nombre: string } | null
  categoria_nombre?: string | null
  unidad_base?: { id: number; nombre: string } | null
  areas: { id: number; nombre: string }[]
  presentaciones: Presentacion[]
  proveedores: ProveedorProductoItem[]
  codigo_maestro: string | null
  stock_minimo: string
  ubicacion: string | null
  temperatura_almacenamiento: string | null
  requiere_cadena_frio: boolean
  dias_estabilidad_abierto: number | null
  clase_riesgo: string | null
  activo: boolean
  version: number
  imagen_url?: string | null
}

type PresFormatoRow = PresFormato & { id: number }

function productoEstadoBadge(item: ProductoListItem) {
  if (item.estado_stock === 'pendiente_inicializar') {
    return <Badge variant="warning">Pendiente inicializar</Badge>
  }
  if (item.estado_stock === 'sin_stock') {
    return <Badge variant="destructive">Sin stock</Badge>
  }
  return item.activo
    ? <Badge variant="success">Activo</Badge>
    : <Badge variant="outline">Inactivo</Badge>
}

function productoEstadoTexto(item: ProductoListItem) {
  if (item.estado_stock === 'pendiente_inicializar') return 'Pendiente inicializar'
  if (item.estado_stock === 'sin_stock') return 'Sin stock'
  return item.activo ? 'Activo' : 'Inactivo'
}

function proveedorPayload(pp: ProveedorProductoItem) {
  const hasPres = !!pp.pres_nombre && !!pp.pres_factor
  return {
    proveedor_id: pp.proveedor_id,
    es_principal: pp.es_principal,
    codigo_proveedor: pp.codigo_proveedor || null,
    codigo_maestro: pp.codigo_maestro || null,
    presentacion_id: pp.presentacion_id ?? null,
    presentacion: hasPres ? {
      nombre: pp.pres_nombre!,
      nombre_plural: pp.pres_nombre_plural || pp.pres_nombre!,
      factor_conversion: Number(pp.pres_factor),
      codigo_barras: pp.pres_codigo_barras || null,
      gtin: pp.pres_gtin || null,
      gs1_habilitado: pp.pres_gs1_habilitado ?? false,
    } : null,
    precio_unidad: pp.precio_unidad || null,
    lead_time_dias: pp.lead_time_dias || null,
    unidad_minima_pedido: pp.unidad_minima_pedido || null,
    imagen_url: pp.imagen_url || null,
    imagen_data_url: pp.imagen_data_url || null,
  }
}

function proveedorFromDetalle(pp: ProveedorProductoItem): ProveedorProductoItem {
  return {
    ...pp,
    pres_nombre: pp.presentacion?.nombre ?? '',
    pres_nombre_plural: pp.presentacion?.nombre_plural ?? '',
    pres_factor: pp.presentacion ? String(Math.round(Number(pp.presentacion.factor_conversion))) : '',
    pres_codigo_barras: pp.presentacion?.codigo_barras ?? '',
    pres_gtin: pp.presentacion?.gtin ?? '',
    pres_gs1_habilitado: pp.presentacion?.gs1_habilitado ?? false,
  }
}

interface PrecioHistorialItem {
  id: number
  proveedor_id: number | null
  proveedor_nombre: string | null
  precio_unidad: string
  presentacion_id: number | null
  presentacion_nombre: string | null
  precio_presentacion: string | null
  vigente_desde: string
  fuente: string
  nota: string | null
  created_at: string
}

function isValidEan13(value: string) {
  if (!/^\d{13}$/.test(value)) return false
  const digits = value.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10 === check
}

export default function ProductosTab() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [categoriaId, setCategoriaId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [sortBy, setSortBy] = useState('nombre')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [viewMode, setViewMode] = useState<'tabla' | 'tarjetas'>('tabla')
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(() => searchParams.get('nuevo') === 'true')
  const [duplicateSource, setDuplicateSource] = useState<ProductoDetailResponse | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductoListItem | null>(null)
  const [reactivateTarget, setReactivateTarget] = useState<ProductoListItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['productos', { search, categoriaId, areaId, proveedorId, page, activo: !verInactivos, sortBy, sortDir }],
    queryFn: () =>
      api.get<PaginatedResponse<ProductoListItem>>('/productos', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          area_id: areaId || undefined,
          proveedor_id: proveedorId || undefined,
          activo: !verInactivos,
          sort_by: sortBy,
          sort_dir: sortDir,
          page,
          per_page: 20,
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const { data: unidades } = useQuery({
    queryKey: ['unidades-basicas'],
    queryFn: () => api.get<UnidadBasica[]>('/unidades-basicas').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/productos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      notify.success('Producto desactivado')
      setDeleteTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const reactivarMut = useMutation({
    mutationFn: (id: string) => api.post(`/productos/${id}/reactivar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      notify.success('Producto reactivado')
      setReactivateTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const columns = [
    {
      key: 'nombre',
      header: 'Nombre completo',
      width: '320px',
      render: (item: ProductoListItem) => (
        <div className={`flex flex-col min-w-0 w-full overflow-hidden ${!item.activo ? 'opacity-50' : ''}`} title={item.nombre}>
          <p className="font-medium text-sm truncate">{item.nombre}</p>
          {item.codigo_interno && (
            <p className="text-[10px] font-mono opacity-35 truncate">{item.codigo_interno}</p>
          )}
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoría',
      className: 'hidden md:table-cell',
      render: (item: ProductoListItem) => (
        <span className={`text-sm opacity-50 ${!item.activo ? 'opacity-30' : ''}`}>{item.categoria?.nombre || '--'}</span>
      ),
    },
    {
      key: 'proveedor',
      header: 'Proveedor',
      className: 'hidden md:table-cell',
      render: (item: ProductoListItem) => (
        item.proveedor ? (
          <div className={`flex items-center gap-1.5 ${!item.activo ? 'opacity-50' : ''}`}>
            <ProveedorIcon proveedor={item.proveedor} className="h-4 w-4" />
            <span className="text-sm">{item.proveedor.nombre}</span>
          </div>
        ) : (
          <span className="text-sm opacity-30">--</span>
        )
      ),
    },
    {
      key: 'area',
      header: 'Área / Sección',
      className: 'hidden lg:table-cell',
      render: (item: ProductoListItem) => (
        item.area
          ? <Badge variant="secondary" className={!item.activo ? 'opacity-50' : ''}>{item.area.nombre}</Badge>
          : <span className="text-sm opacity-30">--</span>
      ),
    },
    {
      key: 'unidad_base',
      header: 'Unidad',
      render: (item: ProductoListItem) => (
        <span className={`font-mono text-sm bg-base-200 px-2 py-0.5 rounded ${!item.activo ? 'opacity-50' : ''}`}>{item.unidad_base.nombre}</span>
      ),
    },
    {
      key: 'stock_minimo',
      header: 'Mín.',
      className: 'hidden lg:table-cell',
      render: (item: ProductoListItem) => (
        <span className="text-sm font-mono opacity-50">{Math.round(Number(item.stock_minimo))}</span>
      ),
    },
    {
      key: 'activo',
      header: 'Estado',
      render: (item: ProductoListItem) => productoEstadoBadge(item),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-28',
      render: (item: ProductoListItem) => (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {item.activo ? (
            <>
              {item.estado_stock === 'pendiente_inicializar' && (
                <button
                  className="btn btn-ghost btn-xs btn-square text-warning"
                  title="Inicializar stock — crear primera recepción"
                  onClick={() => {
                    const params = new URLSearchParams({ producto_id: item.id })
                    if (item.proveedor?.id) params.set('proveedor_id', String(item.proveedor.id))
                    navigate(`/recepciones/nueva?${params.toString()}`)
                  }}
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                </button>
              )}
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setDetailId(item.id)}>
                <Eye className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setEditId(item.id)}>
                <Pencil className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button className="btn btn-ghost btn-xs btn-square" title="Duplicar" onClick={async () => {
                const res = await api.get<ProductoDetailResponse>(`/productos/${item.id}`)
                setDuplicateSource(res.data)
                setCreateOpen(true)
              }}>
                <Copy className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setDeleteTarget(item)}>
                <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
              </button>
            </>
          ) : (
            <button className="btn btn-ghost btn-xs btn-square" title="Reactivar" onClick={() => setReactivateTarget(item)}>
              <RotateCcw className="h-3.5 w-3.5 opacity-60 text-primary" />
            </button>
          )}
        </div>
      ),
    },
  ]

  const productos = data?.data ?? []

  function csvEscape(value: string | number | null | undefined) {
    const text = value == null ? '' : String(value)
    return `"${text.replace(/"/g, '""')}"`
  }

  function exportCurrentCsv() {
    const header = ['codigo', 'nombre', 'categoria', 'proveedor', 'area', 'unidad', 'stock_minimo', 'estado']
    const lines = productos.map((p) => [
      p.codigo_interno,
      p.nombre,
      p.categoria?.nombre,
      p.proveedor?.nombre,
      p.area?.nombre,
      p.unidad_base.nombre,
      p.stock_minimo,
      productoEstadoTexto(p),
    ].map(csvEscape).join(';'))
    const blob = new Blob([[header.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'productos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => { setSearchActiveIndex(-1) }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node))
        setSearchDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (searchActiveIndex >= 0)
      searchItemRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [searchActiveIndex])

  const searchSuggestions = productos.slice(0, 16)
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

  const groupedSearchItems = (() => {
    const result: ({ type: 'header'; letter: string } | { type: 'item'; item: typeof productos[number]; idx: number })[] = []
    let lastL = ''
    searchSuggestions.forEach((item, idx) => {
      const l = item.nombre[0]?.toUpperCase() ?? '#'
      if (l !== lastL) { result.push({ type: 'header', letter: l }); lastL = l }
      result.push({ type: 'item', item, idx })
    })
    return result
  })()

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!searchDropdownOpen) setSearchDropdownOpen(true)
      if (searchSuggestions.length === 0) return
      setSearchActiveIndex(i => i < searchSuggestions.length - 1 ? i + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (searchSuggestions.length === 0) return
      setSearchActiveIndex(i => i > 0 ? i - 1 : searchSuggestions.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
        setSearch(searchSuggestions[searchActiveIndex].nombre)
        setPage(1)
        setSearchDropdownOpen(false)
        setSearchActiveIndex(-1)
      }
    } else if (e.key === 'Escape') {
      setSearchDropdownOpen(false)
      setSearchActiveIndex(-1)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5 justify-between">
        <div className="flex flex-wrap gap-2.5 flex-1">
          <div ref={searchContainerRef} className="relative flex-1 min-w-[200px] max-w-sm">
            <label className="input input-bordered input-sm flex items-center gap-2 h-9 w-full">
              <Search className="h-3.5 w-3.5 opacity-35 shrink-0" />
              <input
                type="text"
                className="grow text-sm"
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); setSearchDropdownOpen(true) }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setSearchDropdownOpen(true)}
                aria-autocomplete="list"
                aria-expanded={showSearchDropdown}
              />
            </label>
            {showSearchDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-72" role="listbox">
                {groupedSearchItems.map(entry =>
                  entry.type === 'header' ? (
                    <div key={`h-${entry.letter}`} className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-base-content/30 bg-base-200/40 sticky top-0">
                      {entry.letter}
                    </div>
                  ) : (
                    <div
                      key={entry.item.id}
                      ref={el => { searchItemRefs.current[entry.idx] = el }}
                      role="option"
                      aria-selected={entry.idx === searchActiveIndex}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors",
                        entry.idx === searchActiveIndex ? "bg-primary/10 text-primary" : "hover:bg-base-200/60"
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSearch(entry.item.nombre)
                        setPage(1)
                        setSearchDropdownOpen(false)
                        setSearchActiveIndex(-1)
                      }}
                    >
                      <span className="font-medium truncate">{entry.item.nombre}</span>
                      {entry.item.codigo_interno && (
                        <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">#{entry.item.codigo_interno}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
          <select
            className="select select-bordered select-sm h-9 w-40 text-sm"
            value={categoriaId}
            onChange={(e) => { setCategoriaId(e.target.value); setPage(1) }}
          >
            <option value="">Categoría</option>
            {categorias?.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.nombre}</option>
            ))}
          </select>
          <select
            className="select select-bordered select-sm h-9 w-40 text-sm"
            value={areaId}
            onChange={(e) => { setAreaId(e.target.value); setPage(1) }}
          >
            <option value="">Área / Sección</option>
            {areas?.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.nombre}</option>
            ))}
          </select>
          <ProveedorSelect
            value={proveedorId}
            onChange={(v) => { setProveedorId(v); setPage(1) }}
            proveedores={proveedores ?? []}
            allLabel="Todos los proveedores"
            className="w-48"
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input 
              type="checkbox" 
              className="checkbox checkbox-xs checkbox-primary" 
              checked={verInactivos}
              onChange={(e) => { setVerInactivos(e.target.checked); setPage(1) }}
            />
            <span className="text-xs opacity-60">Ver inactivos</span>
          </label>
          <select
            className="select select-bordered select-sm h-9 w-36 text-sm"
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value); setPage(1) }}
          >
            <option value="nombre">Nombre</option>
            <option value="codigo">Código</option>
            <option value="categoria">Categoría</option>
            <option value="proveedor">Proveedor</option>
            <option value="stock_minimo">Stock mínimo</option>
            <option value="estado">Estado</option>
          </select>
          <button
            type="button"
            className="btn btn-sm btn-ghost h-9"
            onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1) }}
          >
            {sortDir === 'asc' ? 'Asc' : 'Desc'}
          </button>
        </div>
        <div className="flex gap-1.5">
          <button className="btn btn-ghost btn-sm btn-square" title={viewMode === 'tabla' ? 'Ver tarjetas' : 'Ver tabla'} onClick={() => setViewMode(viewMode === 'tabla' ? 'tarjetas' : 'tabla')}>
            {viewMode === 'tabla' ? <LayoutGrid className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </button>
          <button className="btn btn-ghost btn-sm btn-square" title="Exportar CSV" onClick={exportCurrentCsv}>
            <Download className="h-4 w-4" />
          </button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={() => { setDuplicateSource(null); setCreateOpen(true) }}>
            <Plus className="h-4 w-4" />
            Nuevo producto
          </button>
        </div>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando productos..." />
      ) : (
        <>
          {viewMode === 'tabla' ? (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              emptyMessage="No hay productos registrados"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {productos.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="text-left border border-base-300 rounded-lg p-3 bg-base-100 hover:bg-base-200/60 transition-colors"
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex gap-3">
                    <ProductoImage src={item.imagen_url ?? null} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{item.nombre}</p>
                      <p className="text-[10px] font-mono opacity-40 truncate">{item.codigo_interno ?? '--'}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.categoria && <Badge variant="secondary">{item.categoria.nombre}</Badge>}
                        {item.proveedor && <Badge variant="outline">{item.proveedor.nombre}</Badge>}
                        {productoEstadoBadge(item)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </>
      )}

      <CreateProductoDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          if (searchParams.get('nuevo')) {
            const next = new URLSearchParams(searchParams)
            next.delete('nuevo')
            setSearchParams(next, { replace: true })
          }
        }}
        categorias={categorias ?? []}
        unidades={unidades ?? []}
        areas={areas ?? []}
        proveedores={proveedores ?? []}
        duplicateSource={duplicateSource}
      />

      {editId && (
        <EditProductoDialog
          open={!!editId}
          onClose={() => setEditId(null)}
          productoId={editId}
          categorias={categorias ?? []}
          areas={areas ?? []}
          proveedores={proveedores ?? []}
        />
      )}

      <Sheet open={!!detailId} onClose={() => setDetailId(null)} title="Detalle de producto">
        {detailId && <ProductoDetail id={detailId} />}
      </Sheet>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Desactivar producto"
        description={`¿Estás seguro de desactivar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer si tiene stock activo.`}
        confirmLabel="Desactivar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        title="Reactivar producto"
        description={`¿Quieres volver a activar el producto "${reactivateTarget?.nombre}"?`}
        confirmLabel="Reactivar"
        variant="warning"
        loading={reactivarMut.isPending}
        onClose={() => setReactivateTarget(null)}
        onConfirm={() => reactivateTarget && reactivarMut.mutate(reactivateTarget.id)}
      />
    </div>
  )
}

// ── Quick-create mini forms ──────────────────────────────────

function QuickCreateCategoria({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (c: Categoria) => void }) {
  const queryClient = useQueryClient()
  const [nombre, setNombre] = useState('')
  const mut = useMutation({
    mutationFn: () => api.post<Categoria>('/categorias', { nombre: nombre.trim() }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      notify.success('Categoría creada')
      onCreated(res.data)
      setNombre('')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
  return (
    <Dialog open={open} onClose={onClose} title="Nueva categoría">
      <form onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) mut.mutate() }} className="space-y-4">
        <div className="form-control">
          <label className="label"><span className="label-text text-sm font-medium">Nombre *</span></label>
          <input type="text" className="input input-bordered input-sm h-9" value={nombre}
            onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Reactivos" autoFocus required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={mut.isPending}>
            {mut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Crear'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function QuickCreateUnidad({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (u: UnidadBasica) => void }) {
  const queryClient = useQueryClient()
  const [f, setF] = useState({ nombre: '', nombre_plural: '' })
  const mut = useMutation({
    mutationFn: () => api.post<UnidadBasica>('/unidades-basicas', {
      nombre: f.nombre.trim(), nombre_plural: f.nombre_plural.trim(),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['unidades-basicas'] })
      notify.success('Unidad creada')
      onCreated(res.data)
      setF({ nombre: '', nombre_plural: '' })
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
  return (
    <Dialog open={open} onClose={onClose} title="Nueva unidad básica">
      <form onSubmit={(e) => { e.preventDefault(); if (f.nombre.trim() && f.nombre_plural.trim()) mut.mutate() }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Singular *</span></label>
            <input type="text" className="input input-bordered input-sm h-9" value={f.nombre}
              onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))} placeholder="Ej: placa" autoFocus required />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Plural *</span></label>
            <input type="text" className="input input-bordered input-sm h-9" value={f.nombre_plural}
              onChange={(e) => setF((p) => ({ ...p, nombre_plural: e.target.value }))} placeholder="Ej: placas" required />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={mut.isPending}>
            {mut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Crear'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function QuickCreateArea({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (a: Area) => void }) {
  const queryClient = useQueryClient()
  const [nombre, setNombre] = useState('')
  const mut = useMutation({
    mutationFn: () => api.post<Area>('/areas', { nombre: nombre.trim() }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      notify.success('Área creada')
      onCreated(res.data)
      setNombre('')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
  return (
    <Dialog open={open} onClose={onClose} title="Nueva área">
      <form onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) mut.mutate() }} className="space-y-4">
        <div className="form-control">
          <label className="label"><span className="label-text text-sm font-medium">Nombre *</span></label>
          <input type="text" className="input input-bordered input-sm h-9" value={nombre}
            onChange={(e) => setNombre(e.target.value)} placeholder="Ej: PCR" autoFocus required />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={mut.isPending}>
            {mut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Crear'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Barcode Scanner ──────────────────────────────────────────

function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode('barcode-scanner-viewport')
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { 
            fps: 15, 
            qrbox: { width: 250, height: 120 },
            aspectRatio: 1.777778
          },
          (decoded) => {
            onScanRef.current(decoded)
          },
          () => {} 
        )
      } catch (err) {
        console.error('Barcode scanner error:', err)
        setError('No se pudo acceder a la cámara o el navegador no es compatible.')
      }
    }, 100)

    return () => {
      clearTimeout(timer)
      if (scannerRef.current) {
        const s = scannerRef.current
        if (s.isScanning) {
          s.stop().catch(() => {}).finally(() => s.clear())
        } else {
          s.clear()
        }
      }
    }
  }, [])

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-sm text-warning py-6 text-center">{error}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-base-content/50 text-center">Apunta la cámara al código de barras</p>
          <div 
            id="barcode-scanner-viewport" 
            className="w-full rounded-lg overflow-hidden bg-black"
            style={{ minHeight: '220px' }}
          />
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

// ── Create Dialog ────────────────────────────────────────────

function CreateProductoDialog({
  open, onClose, categorias, unidades, areas, proveedores, duplicateSource,
}: {
  open: boolean
  onClose: () => void
  categorias: Categoria[]
  unidades: UnidadBasica[]
  areas: Area[]
  proveedores: Proveedor[]
  duplicateSource?: ProductoDetailResponse | null
}) {
  const queryClient = useQueryClient()
  const { data: presFormatos = [] } = useQuery({
    queryKey: ['presentacion-formatos'],
    queryFn: () => api.get<PresFormatoRow[]>('/presentacion-formatos').then((r) => r.data),
  })
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    unidad_base_id: '',
    area_id: '',
    ubicacion: '',
    codigo_maestro: '',
    stock_minimo: '0',
    pres_nombre: '',
    pres_nombre_plural: '',
    pres_factor: '',
    pres_codigo_barras: '',
  })

  const [proveedoresForm, setProveedoresForm] = useState<ProveedorProductoItem[]>([])
  const [temperaturaAlmacenamiento, setTemperaturaAlmacenamiento] = useState<string | null>(null)
  const [requiereCadenaFrio, setRequiereCadenaFrio] = useState(false)
  const [diasEstabilidadAbierto, setDiasEstabilidadAbierto] = useState<number | null>(null)
  const [claseRiesgo, setClaseRiesgo] = useState<string | null>(null)

  function agregarProveedorCreate(provId: number, nombre: string) {
    setProveedoresForm(prev => {
      if (prev.some(p => p.proveedor_id === provId)) return prev
      const esPrimero = prev.length === 0
      return [...prev, {
        proveedor_id: provId,
        proveedor_nombre: nombre,
        es_principal: esPrimero,
        codigo_proveedor: null,
        codigo_maestro: null,
        pres_nombre: '',
        pres_nombre_plural: '',
        pres_factor: '',
        pres_codigo_barras: '',
        pres_gtin: '',
        pres_gs1_habilitado: false,
        precio_unidad: null,
        lead_time_dias: null,
      }]
    })
  }

  function eliminarProveedorCreate(provId: number) {
    setProveedoresForm(prev => {
      const filtered = prev.filter(p => p.proveedor_id !== provId)
      if (filtered.length > 0 && !filtered.some(p => p.es_principal)) {
        return filtered.map((p, i) => i === 0 ? { ...p, es_principal: true } : p)
      }
      return filtered
    })
  }

  function marcarPrincipalCreate(provId: number) {
    setProveedoresForm(prev => prev.map(p => ({ ...p, es_principal: p.proveedor_id === provId })))
  }

  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newUnidadOpen, setNewUnidadOpen] = useState(false)
  const [newAreaOpen, setNewAreaOpen] = useState(false)

  useEffect(() => {
    if (!open || !duplicateSource) return
    setForm((f) => ({
      ...f,
      nombre: `${duplicateSource.nombre} copia`,
      descripcion: duplicateSource.descripcion ?? '',
      categoria_id: duplicateSource.categoria?.id ? String(duplicateSource.categoria.id) : '',
      unidad_base_id: duplicateSource.unidad_base?.id ? String(duplicateSource.unidad_base.id) : '',
      area_id: duplicateSource.areas?.[0]?.id ? String(duplicateSource.areas[0].id) : '',
      ubicacion: duplicateSource.ubicacion ?? '',
      codigo_maestro: duplicateSource.codigo_maestro ?? '',
      stock_minimo: String(Math.round(Number(duplicateSource.stock_minimo))),
    }))
    setProveedoresForm((duplicateSource.proveedores ?? []).map((p) => ({
      ...proveedorFromDetalle(p),
      id: undefined,
      presentacion_id: null,
    })))
    setTemperaturaAlmacenamiento(duplicateSource.temperatura_almacenamiento ?? null)
    setRequiereCadenaFrio(duplicateSource.requiere_cadena_frio ?? false)
    setDiasEstabilidadAbierto(duplicateSource.dias_estabilidad_abierto ?? null)
    setClaseRiesgo(duplicateSource.clase_riesgo ?? null)
  }, [open, duplicateSource])

  const createMut = useMutation({
    mutationFn: (data: CreateProducto) => api.post('/productos', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      notify.success('Producto creado')
      handleClose()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  function handleClose() {
    onClose()
    setForm({
      nombre: '', descripcion: '', categoria_id: '', unidad_base_id: '',
      area_id: '', ubicacion: '', codigo_maestro: '',
      stock_minimo: '0',
      pres_nombre: '', pres_nombre_plural: '', pres_factor: '', pres_codigo_barras: '',
    })
    setProveedoresForm([])
    setTemperaturaAlmacenamiento(null)
    setRequiereCadenaFrio(false)
    setDiasEstabilidadAbierto(null)
    setClaseRiesgo(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) { notify.error('El nombre del producto es requerido'); return }
    if (!form.unidad_base_id) { notify.error('Selecciona una unidad base'); return }
    if (!form.area_id) { notify.error('Selecciona un área'); return }
    if (proveedoresForm.length === 0) { notify.error('Agrega al menos un proveedor'); return }
    const invalidEan = proveedoresForm.find(p => p.pres_codigo_barras && /^\d{13}$/.test(p.pres_codigo_barras) && !isValidEan13(p.pres_codigo_barras))
    if (invalidEan) { notify.error('El EAN-13 ingresado no tiene un dígito de control válido'); return }
    const invalidGtin = proveedoresForm.find(p => p.pres_gtin && !/^\d{14}$/.test(p.pres_gtin))
    if (invalidGtin) { notify.error('GTIN debe tener 14 dígitos'); return }
    createMut.mutate({
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      unidad_base_id: Number(form.unidad_base_id),
      stock_minimo: Number(form.stock_minimo) || 0,
      area_ids: [Number(form.area_id)],
      ubicacion: form.ubicacion.trim() || undefined,
      proveedores: proveedoresForm.map(proveedorPayload),
      temperatura_almacenamiento: temperaturaAlmacenamiento,
      requiere_cadena_frio: requiereCadenaFrio,
      dias_estabilidad_abierto: diasEstabilidadAbierto,
      clase_riesgo: claseRiesgo,
    })
  }

  function handleCategoriaChange(value: string) {
    if (value === '__new__') { setNewCatOpen(true); return }
    setForm((f) => ({ ...f, categoria_id: value }))
  }

  function handleUnidadChange(value: string) {
    if (value === '__new__') { setNewUnidadOpen(true); return }
    setForm((f) => ({ ...f, unidad_base_id: value }))
  }

  function handleAreaChange(value: string) {
    if (value === '__new__') { setNewAreaOpen(true); return }
    setForm((f) => ({ ...f, area_id: value }))
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} title="Nuevo producto" className="max-w-2xl" closeOnBackdrop={false}>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Identificación ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-primary/50" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Identificación</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="form-control col-span-2">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Nombre</span>
                  <span className="label-text-alt text-error text-[10px]">requerido</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre del producto"
                  autoFocus
                />
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Unidad base</span>
                  <span className="label-text-alt text-error text-[10px]">requerido</span>
                </label>
                <select
                  className="select select-bordered select-sm h-9 text-sm"
                  value={form.unidad_base_id}
                  onChange={(e) => handleUnidadChange(e.target.value)}
                >
                  <option value="">Seleccionar...</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre} / {u.nombre_plural}</option>
                  ))}
                  <option value="__new__">＋ Crear nueva unidad...</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Tipo / Categoría</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <select
                  className="select select-bordered select-sm h-9 text-sm"
                  value={form.categoria_id}
                  onChange={(e) => handleCategoriaChange(e.target.value)}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                  <option value="__new__">＋ Crear nueva categoría...</option>
                </select>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Área</span>
                  <span className="label-text-alt text-error text-[10px]">requerido</span>
                </label>
                <select
                  className={cn("select select-bordered select-sm h-9 text-sm", !form.area_id && "select-error")}
                  value={form.area_id}
                  onChange={(e) => handleAreaChange(e.target.value)}
                >
                  <option value="">Seleccionar área...</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                  <option value="__new__">＋ Crear nueva área...</option>
                </select>
                <p className="text-[10px] text-base-content/40 mt-0.5">Sección del laboratorio donde este producto pertenece y se usa</p>
              </div>
            </div>

            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-sm font-medium">Ubicación de almacenamiento</span>
                <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={form.ubicacion}
                onChange={(e) => setForm((f) => ({ ...f, ubicacion: e.target.value }))}
                placeholder="Ej: Refrigerador 2, estante superior"
              />
              <p className="text-[10px] text-base-content/40 mt-0.5">Lugar físico exacto: refrigerador, armario, estante</p>
            </div>

            {/* Sección Proveedores */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                Proveedores <span className="text-error">*</span>
              </label>
              {proveedoresForm.map((pp) => (
                <div key={pp.proveedor_id} className="p-3 bg-base-200 rounded-xl space-y-3 border border-base-300">
                  {/* Header del Proveedor */}
                  <div className="flex items-center justify-between border-b border-base-300/50 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-sm truncate">{pp.proveedor_nombre}</span>
                      {pp.es_principal && (
                        <span className="badge badge-primary badge-xs py-1.5 px-2 font-bold uppercase tracking-wider">Principal</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!pp.es_principal && (
                        <button
                          type="button"
                          onClick={() => marcarPrincipalCreate(pp.proveedor_id)}
                          className="btn btn-ghost btn-xs text-warning hover:bg-warning/10 font-bold"
                          title="Marcar como principal"
                        >
                          ★ Principal
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => eliminarProveedorCreate(pp.proveedor_id)}
                        className="btn btn-ghost btn-xs text-error hover:bg-error/10 font-semibold"
                        title="Eliminar proveedor"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Grid de Inputs */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {/* Cód. Proveedor */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Cód. proveedor</span>
                      <input
                        type="text"
                        placeholder="Ej: PROV-123"
                        value={pp.codigo_proveedor ?? ''}
                        onChange={e => setProveedoresForm(prev => prev.map(p =>
                          p.proveedor_id === pp.proveedor_id ? { ...p, codigo_proveedor: e.target.value || null } : p
                        ))}
                        className="input input-xs input-bordered w-full"
                      />
                    </div>

                    {/* Cód. Maestro */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Cód. maestro</span>
                      <input
                        type="text"
                        placeholder="Ej: MST-999"
                        value={pp.codigo_maestro ?? ''}
                        onChange={e => setProveedoresForm(prev => prev.map(p =>
                          p.proveedor_id === pp.proveedor_id ? { ...p, codigo_maestro: e.target.value || null } : p
                        ))}
                        className="input input-xs input-bordered w-full"
                      />
                    </div>

                    {/* Precio/u */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Precio/unidad</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={pp.precio_unidad ?? ''}
                        onChange={e => setProveedoresForm(prev => prev.map(p =>
                          p.proveedor_id === pp.proveedor_id ? { ...p, precio_unidad: e.target.value || null } : p
                        ))}
                        className="input input-xs input-bordered w-full"
                        min="0"
                        step="0.01"
                      />
                    </div>

                    {/* Unidad base */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Formato / Pres.</span>
                      <select
                        className="select select-xs select-bordered bg-base-100 w-full"
                        value={pp.pres_nombre ?? ''}
                        onChange={e => {
                          const found = presFormatos.find(p => p.nombre === e.target.value)
                          setProveedoresForm(prev => prev.map(p => p.proveedor_id === pp.proveedor_id ? {
                            ...p,
                            pres_nombre: e.target.value,
                            pres_nombre_plural: found?.nombre_plural || '',
                          } : p))
                        }}
                      >
                        <option value="">Unidad base</option>
                        {presFormatos.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
                      </select>
                    </div>

                    {/* Unid. (Factor) */}
                    <div className="flex flex-col gap-0.5" title={!pp.pres_nombre 
                      ? "Bloqueado: La Unidad base siempre equivale a 1 unidad. Selecciona un formato (ej: Caja) para cambiarlo"
                      : `Cantidad de unidades individuales contenidas en esta presentación (Ej: si la presentación es por ${pp.pres_nombre || 'envase'} y contiene 10 unidades base, el factor es 10)`
                    }>
                      <span className={cn(
                        "text-[9px] uppercase font-bold tracking-wider cursor-help transition-opacity duration-200",
                        !pp.pres_nombre ? "opacity-30" : "opacity-60"
                      )}>
                        Unidades por {pp.pres_nombre || 'Envase'} {!pp.pres_nombre ? '🔒' : '🛈'}
                      </span>
                      <input
                        type="number"
                        placeholder={!pp.pres_nombre ? "1" : "Ej: 10"}
                        value={!pp.pres_nombre ? "1" : (pp.pres_factor ?? '')}
                        onChange={e => setProveedoresForm(prev => prev.map(p =>
                          p.proveedor_id === pp.proveedor_id ? { ...p, pres_factor: e.target.value } : p
                        ))}
                        className="input input-xs input-bordered w-full disabled:bg-base-300/60 disabled:text-base-content/40 disabled:cursor-not-allowed"
                        min="1"
                        disabled={!pp.pres_nombre}
                      />
                    </div>

                    {/* GTIN-14 */}
                    <div className="flex flex-col gap-0.5" title="Global Trade Item Number de 14 dígitos. Código de barras global que identifica la caja/envase completo de esta presentación.">
                      <span className="text-[9px] uppercase font-bold tracking-wider opacity-60 cursor-help">Código GTIN-14 🛈</span>
                      <input
                        type="text"
                        placeholder="14 dígitos"
                        value={pp.pres_gtin ?? ''}
                        onChange={e => setProveedoresForm(prev => prev.map(p =>
                          p.proveedor_id === pp.proveedor_id ? { ...p, pres_gtin: e.target.value.replace(/\D/g, '').slice(0, 14) } : p
                        ))}
                        className="input input-xs input-bordered w-full"
                        disabled={!pp.pres_nombre}
                        title="Global Trade Item Number de 14 dígitos. Código de barras global que identifica la caja/envase completo de esta presentación."
                      />
                    </div>

                    {/* Imagen / GS1 Habilitado */}
                    <div className="col-span-2 flex items-center justify-between gap-4 mt-2 bg-base-300/40 p-1.5 px-3 rounded-lg">
                      <label 
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase opacity-80 cursor-help select-none"
                        title="Si se habilita, al escanear el código de barras en recepciones se extraerán de forma automática el Lote y Fecha de Vencimiento de este producto."
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs checkbox-primary"
                          checked={pp.pres_gs1_habilitado ?? false}
                          disabled={!pp.pres_nombre}
                          onChange={e => setProveedoresForm(prev => prev.map(p =>
                            p.proveedor_id === pp.proveedor_id ? { ...p, pres_gs1_habilitado: e.target.checked } : p
                          ))}
                        />
                        GS1 Habilitado 🛈
                      </label>

                      <div className="flex items-center gap-2">
                        {pp.imagen_data_url && (
                          <div className="w-6 h-6 rounded bg-base-100 overflow-hidden border border-base-300">
                            <img src={pp.imagen_data_url} alt="Vista previa" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <label className="btn btn-xs btn-outline font-semibold gap-1">
                          {pp.imagen_data_url ? 'Cambiar Foto' : 'Subir Foto'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            className="hidden"
                            onChange={async e => {
                              const file = e.target.files?.[0]
                              e.target.value = ''
                              if (!file) return
                              try {
                                const dataUrl = await comprimirImagen(file)
                                setProveedoresForm(prev => prev.map(p =>
                                  p.proveedor_id === pp.proveedor_id ? { ...p, imagen_data_url: dataUrl } : p
                                ))
                              } catch (err) {
                                notify.error(err instanceof Error ? err.message : 'Error cargando imagen')
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <select
                className="select select-sm bg-base-100 border border-base-300 rounded-xl w-full"
                value=""
                onChange={e => {
                  const provId = parseInt(e.target.value)
                  if (!provId) return
                  const prov = proveedores.find((p) => p.id === provId)
                  if (prov) agregarProveedorCreate(provId, prov.nombre)
                }}
              >
                <option value="">+ Agregar proveedor...</option>
                {proveedores
                  .filter((p) => !proveedoresForm.some(pp => pp.proveedor_id === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))
                }
              </select>
            </div>

            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-sm font-medium">Stock mínimo</span>
                <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
              </label>
              <input
                type="number"
                className="input input-bordered input-sm h-9"
                value={form.stock_minimo}
                onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))}
                placeholder="Ej: 10"
                min="0"
              />
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Almacenamiento ── */}
          <div className="space-y-3 border-t border-base-200 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Almacenamiento</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Temperatura</label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={temperaturaAlmacenamiento ?? ''}
                  onChange={e => setTemperaturaAlmacenamiento(e.target.value || null)}
                >
                  <option value="">No especificada</option>
                  <option value="ambiente">Ambiente (15–30°C)</option>
                  <option value="refrigerado">Refrigerado (2–8°C)</option>
                  <option value="congelado">Congelado (-20°C)</option>
                  <option value="ultra_frio">Ultra frío (-80°C)</option>
                  <option value="no_aplica">No aplica</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Clase de riesgo</label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={claseRiesgo ?? ''}
                  onChange={e => setClaseRiesgo(e.target.value || null)}
                >
                  <option value="">Ninguno</option>
                  <option value="biologico">Biológico</option>
                  <option value="quimico">Químico</option>
                  <option value="inflamable">Inflamable</option>
                  <option value="corrosivo">Corrosivo</option>
                  <option value="radiactivo">Radiactivo</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={requiereCadenaFrio}
                  onChange={e => setRequiereCadenaFrio(e.target.checked)}
                />
                <span className="text-sm">Requiere cadena de frío</span>
              </label>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Estabilidad abierto (días)</label>
                <input
                  type="number"
                  className="input input-sm input-bordered bg-base-100"
                  placeholder="ej: 30"
                  value={diasEstabilidadAbierto ?? ''}
                  onChange={e => setDiasEstabilidadAbierto(e.target.value ? parseInt(e.target.value) : null)}
                  min="1"
                />
              </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Información adicional ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-base-content/30" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Información adicional</span>
            </div>
            <div className="form-control">
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Especificaciones técnicas, observaciones... (opcional)"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={createMut.isPending}>
              {createMut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Crear producto'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Quick-create sub-dialogs */}
      <QuickCreateCategoria
        open={newCatOpen}
        onClose={() => setNewCatOpen(false)}
        onCreated={(c) => { setForm((f) => ({ ...f, categoria_id: String(c.id) })); setNewCatOpen(false) }}
      />
      <QuickCreateUnidad
        open={newUnidadOpen}
        onClose={() => setNewUnidadOpen(false)}
        onCreated={(u) => { setForm((f) => ({ ...f, unidad_base_id: String(u.id) })); setNewUnidadOpen(false) }}
      />
      <QuickCreateArea
        open={newAreaOpen}
        onClose={() => setNewAreaOpen(false)}
        onCreated={(a) => { setForm((f) => ({ ...f, area_id: String(a.id) })); setNewAreaOpen(false) }}
      />
    </>
  )
}

// ── Edit Dialog ──────────────────────────────────────────────

function EditProductoDialog({
  open, onClose, productoId, categorias, areas, proveedores,
}: {
  open: boolean
  onClose: () => void
  productoId: string
  categorias: Categoria[]
  areas: Area[]
  proveedores: Proveedor[]
}) {
  const queryClient = useQueryClient()
  const { data: presFormatos = [] } = useQuery({
    queryKey: ['presentacion-formatos'],
    queryFn: () => api.get<PresFormatoRow[]>('/presentacion-formatos').then((r) => r.data),
  })
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const { data: producto, isLoading } = useQuery({
    queryKey: ['producto-detail', productoId],
    queryFn: () => api.get<ProductoDetailResponse>(`/productos/${productoId}`).then((r) => r.data),
    enabled: open,
  })

  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    area_id: '',
    ubicacion: '',
    stock_minimo: '0',
  })

  const [proveedoresForm, setProveedoresFormEdit] = useState<ProveedorProductoItem[]>([])
  const [temperaturaAlmacenamiento, setTemperaturaAlmacenamientoEdit] = useState<string | null>(null)
  const [requiereCadenaFrio, setRequiereCadenaFrioEdit] = useState(false)
  const [diasEstabilidadAbierto, setDiasEstabilidadAbiertoEdit] = useState<number | null>(null)
  const [claseRiesgo, setClaseRiesgoEdit] = useState<string | null>(null)

  function agregarProveedorEdit(provId: number, nombre: string) {
    setProveedoresFormEdit(prev => {
      if (prev.some(p => p.proveedor_id === provId)) return prev
      const esPrimero = prev.length === 0
      return [...prev, {
        proveedor_id: provId,
        proveedor_nombre: nombre,
        es_principal: esPrimero,
        codigo_proveedor: null,
        codigo_maestro: null,
        pres_nombre: '',
        pres_nombre_plural: '',
        pres_factor: '',
        pres_codigo_barras: '',
        pres_gtin: '',
        pres_gs1_habilitado: false,
        precio_unidad: null,
        lead_time_dias: null,
      }]
    })
  }

  function eliminarProveedorEdit(provId: number) {
    setProveedoresFormEdit(prev => {
      const filtered = prev.filter(p => p.proveedor_id !== provId)
      if (filtered.length > 0 && !filtered.some(p => p.es_principal)) {
        return filtered.map((p, i) => i === 0 ? { ...p, es_principal: true } : p)
      }
      return filtered
    })
  }

  function marcarPrincipalEdit(provId: number) {
    setProveedoresFormEdit(prev => prev.map(p => ({ ...p, es_principal: p.proveedor_id === provId })))
  }

  useEffect(() => {
    if (producto) {
      const catId = producto.categoria?.id ?? producto.categoria_id
      const areaId = producto.areas?.[0]?.id ?? ''
      setForm({
        nombre: producto.nombre,
        descripcion: producto.descripcion ?? '',
        categoria_id: catId ? String(catId) : '',
        area_id: areaId ? String(areaId) : '',
        ubicacion: producto.ubicacion ?? '',
        stock_minimo: String(Math.round(Number(producto.stock_minimo))),
      })
      setProveedoresFormEdit((producto.proveedores ?? []).map(proveedorFromDetalle))
      setTemperaturaAlmacenamientoEdit(producto.temperatura_almacenamiento ?? null)
      setRequiereCadenaFrioEdit(producto.requiere_cadena_frio ?? false)
      setDiasEstabilidadAbiertoEdit(producto.dias_estabilidad_abierto ?? null)
      setClaseRiesgoEdit(producto.clase_riesgo ?? null)
    }
  }, [producto])

  const updateMut = useMutation({
    mutationFn: (data: UpdateProducto) => api.put(`/productos/${productoId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
      notify.success('Producto actualizado')
      onClose()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!producto) return
    if (proveedoresForm.length === 0) { notify.error('Agrega al menos un proveedor'); return }
    const invalidEan = proveedoresForm.find(p => p.pres_codigo_barras && /^\d{13}$/.test(p.pres_codigo_barras) && !isValidEan13(p.pres_codigo_barras))
    if (invalidEan) { notify.error('El EAN-13 ingresado no tiene un dígito de control válido'); return }
    const invalidGtin = proveedoresForm.find(p => p.pres_gtin && !/^\d{14}$/.test(p.pres_gtin))
    if (invalidGtin) { notify.error('GTIN debe tener 14 dígitos'); return }

    const payload: UpdateProducto = {
      nombre: form.nombre.trim() || undefined,
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      stock_minimo: Number(form.stock_minimo),
      area_ids: form.area_id ? [Number(form.area_id)] : undefined,
      ubicacion: form.ubicacion.trim() || null,
      proveedores: proveedoresForm.map(proveedorPayload),
      temperatura_almacenamiento: temperaturaAlmacenamiento,
      requiere_cadena_frio: requiereCadenaFrio,
      dias_estabilidad_abierto: diasEstabilidadAbierto,
      clase_riesgo: claseRiesgo,
      version: producto.version,
    }

    updateMut.mutate(payload)
  }

  function handleAreaChange(value: string) {
    if (value === '__new__') { setNewAreaOpen(true); return }
    setForm((f) => ({ ...f, area_id: value }))
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Editar producto" className="max-w-2xl" closeOnBackdrop={false}>
        {isLoading ? (
          <PageLoading label="Cargando producto..." size="md" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* ── Identificación ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-primary/50" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Identificación</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="form-control col-span-2">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Nombre</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9"
                    value={form.nombre}
                    onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Unidad base</span>
                  </label>
                  <div className="input input-bordered input-sm h-9 flex items-center font-mono text-sm opacity-60 bg-base-200 cursor-not-allowed">
                    {producto?.unidad_base?.nombre ?? '--'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Tipo / Categoría</span>
                  </label>
                  <select
                    className="select select-bordered select-sm h-9 text-sm"
                    value={form.categoria_id}
                    onChange={(e) => setForm((f) => ({ ...f, categoria_id: e.target.value }))}
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Área</span>
                    <span className="label-text-alt text-error text-[10px]">requerido</span>
                  </label>
                  <select
                    className={cn("select select-bordered select-sm h-9 text-sm", !form.area_id && "select-error")}
                    value={form.area_id}
                    onChange={(e) => handleAreaChange(e.target.value)}
                  >
                    <option value="">Seleccionar área...</option>
                    {areas.map((a) => (
                      <option key={a.id} value={String(a.id)}>{a.nombre}</option>
                    ))}
                    <option value="__new__">＋ Crear nueva área...</option>
                  </select>
                  <p className="text-[10px] text-base-content/40 mt-0.5">Sección del laboratorio donde este producto pertenece y se usa</p>
                </div>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Ubicación de almacenamiento</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.ubicacion}
                  onChange={(e) => setForm((f) => ({ ...f, ubicacion: e.target.value }))}
                  placeholder="Ej: Refrigerador 2, estante superior"
                />
                <p className="text-[10px] text-base-content/40 mt-0.5">Lugar físico exacto: refrigerador, armario, estante</p>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Proveedor <span className="text-error">*</span></span>
                </label>
                {/* Sección Proveedores */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                    Proveedores <span className="text-error">*</span>
                  </label>
                  {proveedoresForm.map((pp) => (
                    <div key={pp.proveedor_id} className="p-3 bg-base-200 rounded-xl space-y-3 border border-base-300">
                      {/* Header del Proveedor */}
                      <div className="flex items-center justify-between border-b border-base-300/50 pb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-sm truncate">{pp.proveedor_nombre}</span>
                          {pp.es_principal && (
                            <span className="badge badge-primary badge-xs py-1.5 px-2 font-bold uppercase tracking-wider">Principal</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {!pp.es_principal && (
                            <button
                              type="button"
                              onClick={() => marcarPrincipalEdit(pp.proveedor_id)}
                              className="btn btn-ghost btn-xs text-warning hover:bg-warning/10 font-bold"
                              title="Marcar como principal"
                            >
                              ★ Principal
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => eliminarProveedorEdit(pp.proveedor_id)}
                            className="btn btn-ghost btn-xs text-error hover:bg-error/10 font-semibold"
                            title="Eliminar proveedor"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Grid de Inputs */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {/* Cód. Proveedor */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Cód. proveedor</span>
                          <input
                            type="text"
                            placeholder="Ej: PROV-123"
                            value={pp.codigo_proveedor ?? ''}
                            onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                              p.proveedor_id === pp.proveedor_id ? { ...p, codigo_proveedor: e.target.value || null } : p
                            ))}
                            className="input input-xs input-bordered w-full"
                          />
                        </div>

                        {/* Cód. Maestro */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Cód. maestro</span>
                          <input
                            type="text"
                            placeholder="Ej: MST-999"
                            value={pp.codigo_maestro ?? ''}
                            onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                              p.proveedor_id === pp.proveedor_id ? { ...p, codigo_maestro: e.target.value || null } : p
                            ))}
                            className="input input-xs input-bordered w-full"
                          />
                        </div>

                        {/* Precio/u */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Precio/unidad</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={pp.precio_unidad ?? ''}
                            onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                              p.proveedor_id === pp.proveedor_id ? { ...p, precio_unidad: e.target.value || null } : p
                            ))}
                            className="input input-xs input-bordered w-full"
                            min="0"
                            step="0.01"
                          />
                        </div>

                        {/* Unidad base */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-60">Formato / Pres.</span>
                          <select
                            className="select select-xs select-bordered bg-base-100 w-full"
                            value={pp.pres_nombre ?? ''}
                            onChange={e => {
                              const found = presFormatos.find(p => p.nombre === e.target.value)
                              setProveedoresFormEdit(prev => prev.map(p => p.proveedor_id === pp.proveedor_id ? {
                                ...p,
                                pres_nombre: e.target.value,
                                pres_nombre_plural: found?.nombre_plural || '',
                              } : p))
                            }}
                          >
                            <option value="">Unidad base</option>
                            {presFormatos.map(p => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
                          </select>
                        </div>

                        {/* Unid. (Factor) */}
                        <div className="flex flex-col gap-0.5" title={!pp.pres_nombre 
                          ? "Bloqueado: La Unidad base siempre equivale a 1 unidad. Selecciona un formato (ej: Caja) para cambiarlo"
                          : `Cantidad de unidades individuales contenidas en esta presentación (Ej: si la presentación es por ${pp.pres_nombre || 'envase'} y contiene 10 unidades base, el factor es 10)`
                        }>
                          <span className={cn(
                            "text-[9px] uppercase font-bold tracking-wider cursor-help transition-opacity duration-200",
                            !pp.pres_nombre ? "opacity-30" : "opacity-60"
                          )}>
                            Unidades por {pp.pres_nombre || 'Envase'} {!pp.pres_nombre ? '🔒' : '🛈'}
                          </span>
                          <input
                            type="number"
                            placeholder={!pp.pres_nombre ? "1" : "Ej: 10"}
                            value={!pp.pres_nombre ? "1" : (pp.pres_factor ?? '')}
                            onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                              p.proveedor_id === pp.proveedor_id ? { ...p, pres_factor: e.target.value } : p
                            ))}
                            className="input input-xs input-bordered w-full disabled:bg-base-300/60 disabled:text-base-content/40 disabled:cursor-not-allowed"
                            min="1"
                            disabled={!pp.pres_nombre}
                          />
                        </div>

                        {/* GTIN-14 */}
                        <div className="flex flex-col gap-0.5" title="Global Trade Item Number de 14 dígitos. Código de barras global que identifica la caja/envase completo de esta presentación.">
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-60 cursor-help">Código GTIN-14 🛈</span>
                          <input
                            type="text"
                            placeholder="14 dígitos"
                            value={pp.pres_gtin ?? ''}
                            onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                              p.proveedor_id === pp.proveedor_id ? { ...p, pres_gtin: e.target.value.replace(/\D/g, '').slice(0, 14) } : p
                            ))}
                            className="input input-xs input-bordered w-full"
                            disabled={!pp.pres_nombre}
                            title="Global Trade Item Number de 14 dígitos. Código de barras global que identifica la caja/envase completo de esta presentación."
                          />
                        </div>

                        {/* Imagen / GS1 Habilitado */}
                        <div className="col-span-2 flex items-center justify-between gap-4 mt-2 bg-base-300/40 p-1.5 px-3 rounded-lg">
                          <label 
                            className="flex items-center gap-1.5 text-[10px] font-bold uppercase opacity-80 cursor-help select-none"
                            title="Si se habilita, al escanear el código de barras en recepciones se extraerán de forma automática el Lote y Fecha de Vencimiento de este producto."
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-xs checkbox-primary"
                              checked={pp.pres_gs1_habilitado ?? false}
                              disabled={!pp.pres_nombre}
                              onChange={e => setProveedoresFormEdit(prev => prev.map(p =>
                                p.proveedor_id === pp.proveedor_id ? { ...p, pres_gs1_habilitado: e.target.checked } : p
                              ))}
                            />
                            GS1 Habilitado 🛈
                          </label>

                          <div className="flex items-center gap-2">
                            {pp.imagen_data_url && (
                              <div className="w-6 h-6 rounded bg-base-100 overflow-hidden border border-base-300">
                                <img src={pp.imagen_data_url} alt="Vista previa" className="w-full h-full object-cover" />
                              </div>
                            )}
                            <label className="btn btn-xs btn-outline font-semibold gap-1">
                              {pp.imagen_data_url ? 'Cambiar Foto' : 'Subir Foto'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png"
                                className="hidden"
                                onChange={async e => {
                                  const file = e.target.files?.[0]
                                  e.target.value = ''
                                  if (!file) return
                                  try {
                                    const dataUrl = await comprimirImagen(file)
                                    setProveedoresFormEdit(prev => prev.map(p =>
                                      p.proveedor_id === pp.proveedor_id ? { ...p, imagen_data_url: dataUrl } : p
                                    ))
                                  } catch (err) {
                                    notify.error(err instanceof Error ? err.message : 'Error cargando imagen')
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <select
                    className="select select-sm bg-base-100 border border-base-300 rounded-xl w-full"
                    value=""
                    onChange={e => {
                      const provId = parseInt(e.target.value)
                      if (!provId) return
                      const prov = proveedores.find((p) => p.id === provId)
                      if (prov) agregarProveedorEdit(provId, prov.nombre)
                    }}
                  >
                    <option value="">+ Agregar proveedor...</option>
                    {proveedores
                      .filter((p) => !proveedoresForm.some(pp => pp.proveedor_id === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))
                    }
                  </select>
                </div>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Stock mínimo</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <input
                  type="number"
                  className="input input-bordered input-sm h-9"
                  value={form.stock_minimo}
                  onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))}
                  placeholder="Ej: 10"
                  min="0"
                />
              </div>
            </div>

          <div className="divider my-0" />

          {/* ── Almacenamiento ── */}
          <div className="space-y-3 border-t border-base-200 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Almacenamiento</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Temperatura</label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={temperaturaAlmacenamiento ?? ''}
                  onChange={e => setTemperaturaAlmacenamientoEdit(e.target.value || null)}
                >
                  <option value="">No especificada</option>
                  <option value="ambiente">Ambiente (15–30°C)</option>
                  <option value="refrigerado">Refrigerado (2–8°C)</option>
                  <option value="congelado">Congelado (-20°C)</option>
                  <option value="ultra_frio">Ultra frío (-80°C)</option>
                  <option value="no_aplica">No aplica</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Clase de riesgo</label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={claseRiesgo ?? ''}
                  onChange={e => setClaseRiesgoEdit(e.target.value || null)}
                >
                  <option value="">Ninguno</option>
                  <option value="biologico">Biológico</option>
                  <option value="quimico">Químico</option>
                  <option value="inflamable">Inflamable</option>
                  <option value="corrosivo">Corrosivo</option>
                  <option value="radiactivo">Radiactivo</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={requiereCadenaFrio}
                  onChange={e => setRequiereCadenaFrioEdit(e.target.checked)}
                />
                <span className="text-sm">Requiere cadena de frío</span>
              </label>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Estabilidad abierto (días)</label>
                <input
                  type="number"
                  className="input input-sm input-bordered bg-base-100"
                  placeholder="ej: 30"
                  value={diasEstabilidadAbierto ?? ''}
                  onChange={e => setDiasEstabilidadAbiertoEdit(e.target.value ? parseInt(e.target.value) : null)}
                  min="1"
                />
              </div>
            </div>
          </div>

            <div className="divider my-0" />

            {/* ── Descripción ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-base-content/30" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Información adicional</span>
              </div>
              <div className="form-control">
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.descripcion}
                  onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Especificaciones técnicas, observaciones... (opcional)"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={updateMut.isPending}>
                {updateMut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </Dialog>

      <QuickCreateArea
        open={newAreaOpen}
        onClose={() => setNewAreaOpen(false)}
        onCreated={(a) => { setForm((f) => ({ ...f, area_id: String(a.id) })); setNewAreaOpen(false) }}
      />
      <Dialog open={scannerOpen} onClose={() => setScannerOpen(false)} title="Escanear código de barras">
        {scannerOpen && (
          <BarcodeScanner
            onScan={(code) => { setForm((f) => ({ ...f, pres_codigo_barras: code })); setScannerOpen(false) }}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </Dialog>
    </>
  )
}

// ── Detail Panel ─────────────────────────────────────────────

function ProductoDetail({ id }: { id: string }) {
  const { data: producto, isLoading } = useQuery({
    queryKey: ['producto-detail', id],
    queryFn: () => api.get<ProductoDetailResponse>(`/productos/${id}`).then((r) => r.data),
  })
  const { data: historialPrecios = [] } = useQuery({
    queryKey: ['producto-precios', id],
    queryFn: () => api.get<PrecioHistorialItem[]>(`/productos/${id}/precios`).then((r) => r.data),
  })

  if (isLoading) {
    return <PageLoading label="Cargando detalle..." size="md" />
  }

  if (!producto) return <p className="text-sm opacity-40">No encontrado</p>

  const categoriaNombre =
    producto.categoria?.nombre ?? producto.categoria_nombre ?? '--'

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <DetailRow label="Código sistema" value={producto.codigo_interno ?? '--'} mono />
        <DetailRow label="Nombre" value={producto.nombre} />
        {producto.descripcion && (
          <DetailRow label="Descripción" value={producto.descripcion} />
        )}
        <DetailRow label="Categoría" value={categoriaNombre} />
        <DetailRow label="Unidad base" value={producto.unidad_base?.nombre ?? '--'} />
        <DetailRow label="Stock mínimo" value={String(Math.round(Number(producto.stock_minimo)))} mono />
        <DetailRow label="Estado" value={producto.activo ? 'Activo' : 'Inactivo'} />

        {producto.proveedores && producto.proveedores.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">Proveedores</h4>
            <div className="space-y-1.5">
              {producto.proveedores.map((pp) => (
                <div key={pp.proveedor_id} className="flex items-center justify-between bg-base-200/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{pp.proveedor_nombre ?? `Proveedor ${pp.proveedor_id}`}</span>
                    {pp.es_principal && <span className="text-[10px] font-bold uppercase text-primary">Principal</span>}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    {pp.codigo_proveedor && (
                      <span className="text-[10px] font-mono opacity-50">
                        Cód. Prov: {pp.codigo_proveedor}
                      </span>
                    )}
                    {pp.codigo_maestro && (
                      <span className="text-[10px] font-mono opacity-50">
                        Cód. Maestro: {pp.codigo_maestro}
                      </span>
                    )}
                    {pp.precio_unidad && (
                      <span className="text-[10px] font-mono opacity-50">
                        ${pp.precio_unidad}/u
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {producto.presentaciones && producto.presentaciones.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">Presentaciones</h4>
          <div className="space-y-1.5">
            {producto.presentaciones.map((p: Presentacion) => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-base-200/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{p.nombre}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {p.codigo_barras && <span className="text-[10px] font-mono opacity-45">CB {p.codigo_barras}</span>}
                    {p.gtin && <span className="text-[10px] font-mono opacity-45">GTIN {p.gtin}</span>}
                    {p.gs1_habilitado && <Badge variant="info">GS1</Badge>}
                  </div>
                </div>
                <span className="text-xs font-mono opacity-50 shrink-0">x{Math.round(parseFloat(p.factor_conversion))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">Historial de precios</h4>
        {historialPrecios.length > 0 ? (
          <div className="space-y-1.5">
            {historialPrecios.slice(0, 8).map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 bg-base-200/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{h.proveedor_nombre ?? 'Sin proveedor'}</p>
                  <p className="text-[10px] opacity-45">
                    {h.presentacion_nombre ?? 'Unidad base'} · {h.fuente}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono">${h.precio_unidad}</p>
                  <p className="text-[10px] opacity-45">{h.vigente_desde}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm opacity-40">Sin precios registrados.</p>
        )}
      </div>

      {producto.areas && producto.areas.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">Área / Sección</h4>
          <div className="flex flex-wrap gap-1.5">
            {producto.areas.map((a: { id: number; nombre: string }) => (
              <Badge key={a.id} variant="secondary">{a.nombre}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3 border-b border-base-200/40 pb-1.5 last:border-none">
      <span className="text-[11px] opacity-40 shrink-0 font-medium uppercase tracking-wider">{label}</span>
      <span className={cn(
        'text-sm text-right min-w-0 max-w-[70%] break-words',
        mono ? 'font-mono' : ''
      )}>
        {value}
      </span>
    </div>
  )
}

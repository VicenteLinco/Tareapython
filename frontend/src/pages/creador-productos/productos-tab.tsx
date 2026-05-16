import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Eye, Package, Tag, FileText, Camera, RotateCcw, ImagePlus, X } from 'lucide-react'
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
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getPresFormatos, type PresFormato } from '@/lib/pres-formatos'
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
  version: number
  imagen_url?: string | null
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
  proveedor?: { id: number; nombre: string; icono: string | null } | null
  areas: { id: number; nombre: string }[]
  presentaciones: Presentacion[]
  codigo_proveedor: string | null
  codigo_maestro: string | null
  stock_minimo: string
  precio_unidad: string | null
  lead_time_propio: number | null
  ubicacion: string | null
  activo: boolean
  version: number
  imagen_url?: string | null
}

export default function ProductosTab() {
  const queryClient = useQueryClient()
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
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(() => searchParams.get('nuevo') === 'true')
  const [editId, setEditId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductoListItem | null>(null)
  const [reactivateTarget, setReactivateTarget] = useState<ProductoListItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['productos', { search, categoriaId, areaId, proveedorId, page, activo: !verInactivos }],
    queryFn: () =>
      api.get<PaginatedResponse<ProductoListItem>>('/productos', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          area_id: areaId || undefined,
          proveedor_id: proveedorId || undefined,
          activo: !verInactivos,
          page,
          per_page: 20,
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
  })

  const { data: unidades } = useQuery({
    queryKey: ['unidades-basicas'],
    queryFn: () => api.get<UnidadBasica[]>('/unidades-basicas').then((r) => r.data),
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/productos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Producto desactivado')
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const reactivarMut = useMutation({
    mutationFn: (id: string) => api.post(`/productos/${id}/reactivar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Producto reactivado')
      setReactivateTarget(null)
    },
    onError: (err) => toast.error(parseApiError(err)),
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
      render: (item: ProductoListItem) => (
        item.activo
          ? <Badge variant="success">Activo</Badge>
          : <Badge variant="outline">Inactivo</Badge>
      ),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-28',
      render: (item: ProductoListItem) => (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {item.activo ? (
            <>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setDetailId(item.id)}>
                <Eye className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setEditId(item.id)}>
                <Pencil className="h-3.5 w-3.5 opacity-50" />
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
        </div>
        <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nuevo producto
        </button>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando productos..." />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.data ?? []}
            emptyMessage="No hay productos registrados"
          />
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
      toast.success('Categoría creada')
      onCreated(res.data)
      setNombre('')
    },
    onError: (err) => toast.error(parseApiError(err)),
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
      toast.success('Unidad creada')
      onCreated(res.data)
      setF({ nombre: '', nombre_plural: '' })
    },
    onError: (err) => toast.error(parseApiError(err)),
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
      toast.success('Área creada')
      onCreated(res.data)
      setNombre('')
    },
    onError: (err) => toast.error(parseApiError(err)),
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
  open, onClose, categorias, unidades, areas, proveedores,
}: {
  open: boolean
  onClose: () => void
  categorias: Categoria[]
  unidades: UnidadBasica[]
  areas: Area[]
  proveedores: Proveedor[]
}) {
  const queryClient = useQueryClient()
  const [presFormatos] = useState<PresFormato[]>(() => getPresFormatos())
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    unidad_base_id: '',
    area_id: '',
    ubicacion: '',
    proveedor_id: '',
    codigo_proveedor: '',
    codigo_maestro: '',
    stock_minimo: '0',
    precio_unidad: '',
    precio_pres: '',
    lead_time_propio: '0',
    pres_nombre: '',
    pres_nombre_plural: '',
    pres_factor: '',
    pres_codigo_barras: '',
  })

  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newUnidadOpen, setNewUnidadOpen] = useState(false)
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const createMut = useMutation({
    mutationFn: (data: CreateProducto) => api.post('/productos', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      toast.success('Producto creado')
      handleClose()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  function handleClose() {
    onClose()
    setForm({
      nombre: '', descripcion: '', categoria_id: '', unidad_base_id: '',
      area_id: '', ubicacion: '', proveedor_id: '', codigo_proveedor: '', codigo_maestro: '',
      stock_minimo: '0',
      precio_unidad: '',
      precio_pres: '',
      lead_time_propio: '0',
      pres_nombre: '', pres_nombre_plural: '', pres_factor: '', pres_codigo_barras: '',
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) { toast.error('El nombre del producto es requerido'); return }
    if (!form.unidad_base_id) { toast.error('Selecciona una unidad base'); return }
    if (!form.area_id) { toast.error('Selecciona un área'); return }
    if (!form.proveedor_id) { toast.error('Selecciona un proveedor'); return }
    const presentaciones =
      form.pres_nombre && form.pres_factor
        ? [{
            nombre: form.pres_nombre,
            nombre_plural: form.pres_nombre_plural || form.pres_nombre,
            factor_conversion: Number(form.pres_factor),
            codigo_barras: form.pres_codigo_barras.trim() || undefined,
          }]
        : undefined
    createMut.mutate({
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      unidad_base_id: Number(form.unidad_base_id),
      proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : undefined,
      codigo_proveedor: form.codigo_proveedor.trim() || undefined,
      codigo_maestro: form.codigo_maestro.trim() || undefined,
      stock_minimo: Number(form.stock_minimo) || 0,
      precio_unidad: form.precio_unidad ? Number(form.precio_unidad) : undefined,
      lead_time_propio: form.lead_time_propio ? Number(form.lead_time_propio) : undefined,
      area_ids: [Number(form.area_id)],
      ubicacion: form.ubicacion.trim() || undefined,
      presentaciones,
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

  function handlePresChange(nombre: string) {
    const found = presFormatos.find(p => p.nombre === nombre)
    const factorValue = form.pres_factor
    setForm(f => {
      const pu = parseFloat(f.precio_unidad) || 0
      const factor = parseFloat(factorValue) || 1
      return {
        ...f,
        pres_nombre: nombre,
        pres_nombre_plural: found?.nombre_plural || '',
        pres_factor: factorValue,
        precio_pres: f.precio_unidad ? (pu * factor).toFixed(2) : ''
      }
    })
  }

  function handlePrecioUnidadChange(val: string) {
    const pu = parseFloat(val) || 0
    const factor = parseFloat(form.pres_factor) || 1
    setForm(f => ({ 
      ...f, 
      precio_unidad: val, 
      precio_pres: val ? (pu * factor).toFixed(2) : '' 
    }))
  }

  function handlePrecioPresChange(val: string) {
    const pp = parseFloat(val) || 0
    const factor = parseFloat(form.pres_factor) || 1
    setForm(f => ({ 
      ...f, 
      precio_pres: val, 
      precio_unidad: val ? (pp / factor).toFixed(4) : '' 
    }))
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

            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-sm font-medium">Proveedor <span className="text-error">*</span></span>
              </label>
              <ProveedorSelect
                value={form.proveedor_id}
                onChange={(v) => setForm((f) => ({ ...f, proveedor_id: v }))}
                proveedores={proveedores}
                placeholder="Seleccionar proveedor..."
                allLabel="Sin proveedor"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Lead Time (Días)</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <input
                  type="number"
                  className="input input-bordered input-sm h-9"
                  value={form.lead_time_propio}
                  onChange={(e) => setForm((f) => ({ ...f, lead_time_propio: e.target.value }))}
                  placeholder="Ej: 5"
                  min="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Código proveedor</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 font-mono"
                  value={form.codigo_proveedor}
                  onChange={(e) => setForm((f) => ({ ...f, codigo_proveedor: e.target.value }))}
                  placeholder="Ref. en guía de despacho"
                />
                <p className="text-[10px] text-base-content/40 mt-0.5">Referencia del proveedor (viene en la guía)</p>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Código maestro bodega</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 font-mono"
                  value={form.codigo_maestro}
                  onChange={(e) => setForm((f) => ({ ...f, codigo_maestro: e.target.value }))}
                  placeholder="Cód. interno de bodega"
                />
                <p className="text-[10px] text-base-content/40 mt-0.5">Código interno maestro del laboratorio</p>
              </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Presentación ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 text-base-content/30" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Presentación</span>
            </div>

            <div className="bg-base-200/60 rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Formato / presentación</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                  </label>
                  <select
                    className="select select-bordered select-sm h-9 text-sm"
                    value={form.pres_nombre}
                    onChange={(e) => handlePresChange(e.target.value)}
                  >
                    <option value="">— Solo unidad base —</option>
                    {presFormatos.map((p) => (
                      <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
                    ))}
                  </select>
                  {!form.pres_nombre && (
                    <p className="text-[10px] text-base-content/40 mt-1">El insumo ingresa y se contabiliza en su unidad base directamente.</p>
                  )}
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      {form.pres_nombre ? `Unidades por ${form.pres_nombre}` : 'Unidades por formato'}
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9"
                    value={form.pres_factor}
                    onChange={(e) => setForm((f) => ({ ...f, pres_factor: e.target.value }))}
                    placeholder="Ej: 20"
                    min="1"
                    step="1"
                    disabled={!form.pres_nombre}
                  />
                </div>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Plural del formato</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">ej: Cajas</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.pres_nombre_plural}
                  onChange={(e) => setForm((f) => ({ ...f, pres_nombre_plural: e.target.value }))}
                  placeholder="Ej: Cajas"
                  disabled={!form.pres_nombre}
                />
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Código de barras</span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 font-mono tracking-wider flex-1 min-w-0"
                    value={form.pres_codigo_barras}
                    onChange={(e) => setForm((f) => ({ ...f, pres_codigo_barras: e.target.value }))}
                    placeholder="EAN / UPC"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-square h-9 w-9 shrink-0"
                    onClick={() => setScannerOpen(true)}
                    title="Escanear con cámara"
                  >
                    <Camera className="h-4 w-4 opacity-60" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Precio ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Precio de Referencia (Neto)</span>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-base-200/40 p-3 rounded-lg">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Precio por unidad base</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs opacity-40">$</span>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9 w-full pl-6"
                    value={form.precio_unidad}
                    onChange={(e) => handlePrecioUnidadChange(e.target.value)}
                    placeholder="0.00"
                    step="0.0001"
                  />
                </div>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Precio por {form.pres_nombre || 'presentación'}</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs opacity-40">$</span>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9 w-full pl-6"
                    value={form.precio_pres}
                    onChange={(e) => handlePrecioPresChange(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    disabled={!form.pres_nombre}
                  />
                </div>
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
  const [presFormatos] = useState<PresFormato[]>(() => getPresFormatos())
  const [newAreaOpen, setNewAreaOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

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
    proveedor_id: '',
    codigo_proveedor: '',
    codigo_maestro: '',
    stock_minimo: '0',
    precio_unidad: '',
    precio_pres: '',
    lead_time_propio: '0',
    pres_id: '',
    pres_version: 0,
    pres_nombre: '',
    pres_nombre_plural: '',
    pres_factor: '',
    pres_codigo_barras: '',
  })

  useEffect(() => {
    if (producto) {
      const catId = producto.categoria?.id ?? producto.categoria_id
      const areaId = producto.areas?.[0]?.id ?? ''
      const provId = producto.proveedor?.id ?? ''
      // Pre-populate presentation only when there is exactly one
      const presCount = producto.presentaciones?.length ?? 0
      const firstPres = presCount === 1 ? producto.presentaciones[0] : null
      setForm({
        nombre: producto.nombre,
        descripcion: producto.descripcion ?? '',
        categoria_id: catId ? String(catId) : '',
        area_id: areaId ? String(areaId) : '',
        ubicacion: producto.ubicacion ?? '',
        proveedor_id: provId ? String(provId) : '',
        codigo_proveedor: producto.codigo_proveedor ?? '',
        codigo_maestro: producto.codigo_maestro ?? '',
        stock_minimo: String(Math.round(Number(producto.stock_minimo))),
        precio_unidad: producto.precio_unidad ? String(producto.precio_unidad) : '',
        precio_pres: (producto.precio_unidad && firstPres) ? (Number(producto.precio_unidad) * Number(firstPres.factor_conversion)).toFixed(2) : '',
        lead_time_propio: String(producto.lead_time_propio ?? 0),
        pres_id: firstPres ? String(firstPres.id) : '',
        pres_version: firstPres?.version ?? 0,
        pres_nombre: firstPres?.nombre ?? '',
        pres_nombre_plural: firstPres?.nombre_plural ?? '',
        pres_factor: firstPres ? String(Math.round(Number(firstPres.factor_conversion))) : '',
        pres_codigo_barras: firstPres?.codigo_barras ?? '',
      })
    }
  }, [producto])

  const updateMut = useMutation({
    mutationFn: (data: UpdateProducto) => api.put(`/productos/${productoId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
      toast.success('Producto actualizado')
      onClose()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!producto) return
    if (!form.proveedor_id) { toast.error('Selecciona un proveedor'); return }

    // Build new presentacion if filled
    const hasNewPres = form.pres_nombre && form.pres_factor
    const payload: UpdateProducto = {
      nombre: form.nombre.trim() || undefined,
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : undefined,
      codigo_proveedor: form.codigo_proveedor.trim() || undefined,
      codigo_maestro: form.codigo_maestro.trim() || undefined,
      stock_minimo: Number(form.stock_minimo),
      precio_unidad: form.precio_unidad ? Number(form.precio_unidad) : undefined,
      lead_time_propio: Number(form.lead_time_propio) || 0,
      area_ids: form.area_id ? [Number(form.area_id)] : undefined,
      ubicacion: form.ubicacion.trim() || null,
      version: producto.version,
    }

    updateMut.mutate(payload)

    if (form.pres_id && hasNewPres) {
      // Update existing presentation
      api.put(`/presentaciones/${form.pres_id}`, {
        nombre: form.pres_nombre,
        nombre_plural: form.pres_nombre_plural || form.pres_nombre,
        factor_conversion: Number(form.pres_factor),
        codigo_barras: form.pres_codigo_barras.trim() || undefined,
        version: form.pres_version,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
        toast.success('Presentación actualizada')
      }).catch((err) => {
        toast.error(parseApiError(err))
      })
    } else if (!form.pres_id && hasNewPres) {
      // Create new presentation
      api.post(`/productos/${productoId}/presentaciones`, {
        nombre: form.pres_nombre,
        nombre_plural: form.pres_nombre_plural || form.pres_nombre,
        factor_conversion: Number(form.pres_factor),
        codigo_barras: form.pres_codigo_barras.trim() || undefined,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
        toast.success('Presentación agregada')
      }).catch((err) => toast.error(parseApiError(err)))
    }
  }

  function handleAreaChange(value: string) {
    if (value === '__new__') { setNewAreaOpen(true); return }
    setForm((f) => ({ ...f, area_id: value }))
  }

  function handlePresChange(nombre: string) {
    const found = presFormatos.find(p => p.nombre === nombre)
    const factorValue = form.pres_factor
    setForm(f => {
      const pu = parseFloat(f.precio_unidad) || 0
      const factor = parseFloat(factorValue) || 1
      return {
        ...f,
        pres_nombre: nombre,
        pres_nombre_plural: found?.nombre_plural || '',
        pres_factor: factorValue,
        precio_pres: f.precio_unidad ? (pu * factor).toFixed(2) : ''
      }
    })
  }

  function handlePrecioUnidadChange(val: string) {
    const pu = parseFloat(val) || 0
    const factor = parseFloat(form.pres_factor) || 1
    setForm(f => ({ 
      ...f, 
      precio_unidad: val, 
      precio_pres: val ? (pu * factor).toFixed(2) : '' 
    }))
  }

  function handlePrecioPresChange(val: string) {
    const pp = parseFloat(val) || 0
    const factor = parseFloat(form.pres_factor) || 1
    setForm(f => ({
      ...f,
      precio_pres: val,
      precio_unidad: val ? (pp / factor).toFixed(4) : ''
    }))
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      setUploadingImage(true)
      const dataUrl = await comprimirImagen(file)
      await api.put(`/productos/${productoId}/imagen`, { data_url: dataUrl })
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
      toast.success('Imagen actualizada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error subiendo imagen')
    } finally {
      setUploadingImage(false)
    }
  }

  async function handleImageDelete() {
    try {
      setUploadingImage(true)
      await api.delete(`/productos/${productoId}/imagen`)
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      queryClient.invalidateQueries({ queryKey: ['producto-detail', productoId] })
      toast.success('Imagen eliminada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error eliminando imagen')
    } finally {
      setUploadingImage(false)
    }
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
                <ProveedorSelect
                  value={form.proveedor_id}
                  onChange={(v) => setForm((f) => ({ ...f, proveedor_id: v }))}
                  proveedores={proveedores}
                  placeholder="Seleccionar proveedor..."
                  allLabel="Sin proveedor"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Lead Time (Días)</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9"
                    value={form.lead_time_propio}
                    onChange={(e) => setForm((f) => ({ ...f, lead_time_propio: e.target.value }))}
                    placeholder="Ej: 5"
                    min="0"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Código proveedor</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 font-mono"
                    value={form.codigo_proveedor}
                    onChange={(e) => setForm((f) => ({ ...f, codigo_proveedor: e.target.value }))}
                    placeholder="Ref. en guía de despacho"
                  />
                  <p className="text-[10px] text-base-content/40 mt-0.5">Viene en la guía de despacho</p>
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Código maestro bodega</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 font-mono"
                    value={form.codigo_maestro}
                    onChange={(e) => setForm((f) => ({ ...f, codigo_maestro: e.target.value }))}
                    placeholder="Cód. interno"
                  />
                </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Precio ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Precio de Referencia (Neto)</span>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-base-200/40 p-3 rounded-lg">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Precio por unidad base</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs opacity-40">$</span>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9 w-full pl-6"
                    value={form.precio_unidad}
                    onChange={(e) => handlePrecioUnidadChange(e.target.value)}
                    placeholder="0.00"
                    step="0.0001"
                  />
                </div>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Precio por {form.pres_nombre || 'presentación'}</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs opacity-40">$</span>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9 w-full pl-6"
                    value={form.precio_pres}
                    onChange={(e) => handlePrecioPresChange(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    disabled={!form.pres_nombre}
                  />
                </div>
              </div>
            </div>
          </div>

            <div className="divider my-0" />

            {/* ── Presentaciones existentes (solo cuando hay 2 o más) ── */}
            {producto?.presentaciones && producto.presentaciones.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-base-content/30" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Presentaciones actuales</span>
                </div>
                <div className="space-y-1.5">
                  {producto.presentaciones.map((p: Presentacion) => (
                    <div key={p.id} className="flex items-center justify-between bg-base-200/50 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium">{p.nombre}</span>
                      <span className="text-xs font-mono opacity-50">x{Math.round(parseFloat(p.factor_conversion))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Presentación / Agregar ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-base-content/30" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                  {form.pres_id ? 'Presentación asignada' : ((producto?.presentaciones?.length ?? 0) > 1 ? 'Agregar presentación' : 'Presentación')}
                </span>
              </div>
              <div className="bg-base-200/60 rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-sm font-medium">Formato / presentación</span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                    </label>
                    <select
                      className="select select-bordered select-sm h-9 text-sm"
                      value={form.pres_nombre}
                      onChange={(e) => handlePresChange(e.target.value)}
                    >
                      <option value="">{form.pres_id ? '— Solo unidad base —' : 'Seleccionar formato...'}</option>
                      {presFormatos.map((p) => (
                        <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-sm font-medium">
                        {form.pres_nombre ? `Unidades por ${form.pres_nombre}` : 'Unidades por formato'}
                      </span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered input-sm h-9"
                      value={form.pres_factor}
                      onChange={(e) => setForm((f) => ({ ...f, pres_factor: e.target.value }))}
                      placeholder="Ej: 20"
                      min="1"
                      step="1"
                      disabled={!form.pres_nombre}
                    />
                  </div>
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Plural del formato</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">ej: Cajas</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9"
                    value={form.pres_nombre_plural}
                    onChange={(e) => setForm((f) => ({ ...f, pres_nombre_plural: e.target.value }))}
                    placeholder="Ej: Cajas"
                    disabled={!form.pres_nombre}
                  />
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Código de barras</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">opcional</span>
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 font-mono tracking-wider flex-1 min-w-0"
                      value={form.pres_codigo_barras}
                      onChange={(e) => setForm((f) => ({ ...f, pres_codigo_barras: e.target.value }))}
                      placeholder="EAN / UPC"
                      disabled={!form.pres_nombre}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-square h-9 w-9 shrink-0"
                      onClick={() => setScannerOpen(true)}
                      title="Escanear con cámara"
                      disabled={!form.pres_nombre}
                    >
                      <Camera className="h-4 w-4 opacity-60" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="divider my-0" />

            {/* ── Imagen ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <ImagePlus className="h-3.5 w-3.5 text-base-content/30" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">Imagen del producto</span>
              </div>
              <div className="flex items-center gap-3">
                {producto?.imagen_url ? (
                  <ProductoImage src={producto.imagen_url} size="lg" />
                ) : (
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 text-base-content/40 border-2 border-dashed border-base-300 rounded-xl cursor-pointer hover:border-primary/40 transition-colors"
                    style={{ width: 72, height: 72 }}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-[9px]">Subir foto</span>
                  </button>
                )}
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline btn-primary gap-1"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploadingImage}
                    >
                      {uploadingImage ? <span className="loading loading-spinner loading-xs" /> : <Camera className="h-3.5 w-3.5" />}
                      {producto?.imagen_url ? 'Cambiar foto' : 'Subir foto'}
                    </button>
                    {producto?.imagen_url && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost text-error gap-1"
                        onClick={handleImageDelete}
                        disabled={uploadingImage}
                      >
                        <X className="h-3.5 w-3.5" />
                        Quitar
                      </button>
                    )}
                  </div>
                  <p className="text-[9px] text-base-content/40 leading-tight">JPG o PNG · se comprimirá a 400×400px</p>
                </div>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>

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
        {producto.codigo_maestro && (
          <DetailRow label="Cód. maestro bodega" value={producto.codigo_maestro} mono />
        )}
        {producto.codigo_proveedor && (
          <DetailRow label="Cód. proveedor" value={producto.codigo_proveedor} mono />
        )}
        <DetailRow label="Nombre" value={producto.nombre} />
        {producto.descripcion && (
          <DetailRow label="Descripción" value={producto.descripcion} />
        )}
        <DetailRow label="Categoría" value={categoriaNombre} />
        <DetailRow label="Unidad base" value={producto.unidad_base?.nombre ?? '--'} />
        <DetailRow label="Stock mínimo" value={String(Math.round(Number(producto.stock_minimo)))} mono />
        {producto.precio_unidad && (
          <div className="flex justify-between items-start gap-3 border-b border-base-200/40 pb-1.5 last:border-none">
            <span className="text-[11px] opacity-40 shrink-0 font-medium uppercase tracking-wider text-primary font-bold">Precio de ref.</span>
            <div className="flex flex-col items-end">
              <span className="text-sm font-mono">${Number(producto.precio_unidad).toFixed(4)} / {producto.unidad_base?.nombre || 'unidad'}</span>
              {producto.presentaciones?.length === 1 && (
                <span className="text-[10px] opacity-40 font-mono">
                  ${(Number(producto.precio_unidad) * Number(producto.presentaciones[0].factor_conversion)).toFixed(2)} por {producto.presentaciones[0].nombre}
                </span>
              )}
            </div>
          </div>
        )}
        <DetailRow label="Estado" value={producto.activo ? 'Activo' : 'Inactivo'} />

        {producto.proveedor && (
          <div className="flex justify-between items-center">
            <span className="text-xs opacity-40">Proveedor</span>
            <div className="flex items-center gap-1.5">
              <ProveedorIcon proveedor={producto.proveedor} className="h-4 w-4" />
              <span className="text-sm">{producto.proveedor.nombre}</span>
            </div>
          </div>
        )}
      </div>

      {producto.presentaciones && producto.presentaciones.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">Presentaciones</h4>
          <div className="space-y-1.5">
            {producto.presentaciones.map((p: Presentacion) => (
              <div key={p.id} className="flex items-center justify-between bg-base-200/50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium">{p.nombre}</span>
                <span className="text-xs font-mono opacity-50">x{Math.round(parseFloat(p.factor_conversion))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

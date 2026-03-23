import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, MapPin, Package, AlertTriangle, Clock, FileDown } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { Sheet } from '@/components/ui/sheet'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import { useAreaStore } from '@/hooks/use-area-store'
import { useAuthStore } from '@/hooks/use-auth-store'
import api from '@/lib/api'
import type { PaginatedResponse, StockItem, Categoria, Area, Proveedor } from '@/types'
import { daysUntil, formatDate, autoPlural } from '@/lib/utils'
import { exportarStockPDF } from '@/lib/stock-pdf'
import { StockDetail } from './stock-detail'

interface StockResumen {
  total_productos_con_stock: number
  productos_bajo_minimo: number
  productos_por_vencer_90d: number
}

interface StockResponse extends PaginatedResponse<StockItem> {
  resumen: StockResumen
}

export default function StockPage() {
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const usuario = useAuthStore((s) => s.usuario)
  const [areaId, setAreaId] = useState(globalAreaId ? String(globalAreaId) : '')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [page, setPage] = useState(1)
  const [selectedProducto, setSelectedProducto] = useState<StockItem | null>(null)
  const [showPdfModal, setShowPdfModal] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  const stockBajo = estadoFiltro === 'bajo' || estadoFiltro === 'agotado' ? true : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['stock', { search, categoriaId, proveedorId, estadoFiltro, areaId, page }],
    queryFn: () =>
      api.get<StockResponse>('/stock', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          proveedor_id: proveedorId || undefined,
          stock_bajo: stockBajo,
          area_id: areaId || undefined,
          page,
          per_page: 25,
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  // Filtro de estado en cliente (los estados son calculados, el backend solo distingue stock_bajo)
  const rows = (data?.data ?? []).filter((item) => {
    if (!estadoFiltro) return true
    const stock = item.stock_total ?? 0
    const days = item.proximo_vencimiento ? daysUntil(item.proximo_vencimiento) : null
    if (estadoFiltro === 'agotado') return stock <= 0
    if (estadoFiltro === 'bajo') return stock > 0 && stock <= item.stock_minimo
    if (estadoFiltro === 'vencido') return days !== null && days <= 0
    if (estadoFiltro === 'por_vencer') return days !== null && days > 0 && days <= 30
    if (estadoFiltro === 'ok') return stock > item.stock_minimo && (days === null || days > 30)
    return true
  })

  const resumen = data?.resumen

  const columns = [
    {
      key: 'producto_nombre',
      header: 'Producto',
      filter: (
        <label className="input input-bordered input-xs flex items-center gap-1.5 w-full">
          <Search className="h-3 w-3 opacity-40 shrink-0" />
          <input
            type="text"
            className="grow min-w-0"
            placeholder="Buscar..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
      ),
      render: (item: StockItem) => (
        <div className="flex flex-col min-w-0" title={item.producto_nombre}>
          <p className="font-medium text-sm truncate">{item.producto_nombre}</p>
          {item.codigo_interno && (
            <p className="text-[11px] font-mono opacity-35 truncate">{item.codigo_interno}</p>
          )}
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoría',
      className: 'hidden md:table-cell',
      filter: (
        <select
          className="select select-bordered select-xs w-full"
          value={categoriaId}
          onChange={(e) => { setCategoriaId(e.target.value); setPage(1) }}
        >
          <option value="">Todas</option>
          {categorias?.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      ),
      render: (item: StockItem) => (
        <span className="text-sm opacity-60">{item.categoria ?? '--'}</span>
      ),
    },
    {
      key: 'proveedor',
      header: 'Proveedor',
      className: 'hidden lg:table-cell',
      filter: (
        <select
          className="select select-bordered select-xs w-full"
          value={proveedorId}
          onChange={(e) => { setProveedorId(e.target.value); setPage(1) }}
        >
          <option value="">Todos</option>
          {proveedores?.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      ),
      render: (item: StockItem) =>
        item.proveedor_nombre ? (
          <div className="flex items-center gap-2">
            <ProveedorIcon proveedor={{ nombre: item.proveedor_nombre, icono: item.proveedor_icono }} className="h-5 w-5" />
            <span className="text-xs opacity-70 max-w-[120px] truncate">{item.proveedor_nombre}</span>
          </div>
        ) : (
          <span className="text-xs opacity-20">--</span>
        ),
    },
    {
      key: 'stock_total',
      header: 'Stock',
      render: (item: StockItem) => {
        const qty = Math.round(item.stock_total ?? 0)
        return (
          <div className="font-mono">
            <span className="font-semibold">{qty}</span>
            <span className="text-xs opacity-35 ml-1">{qty === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
          </div>
        )
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      filter: (
        <select
          className="select select-bordered select-xs w-full"
          value={estadoFiltro}
          onChange={(e) => { setEstadoFiltro(e.target.value); setPage(1) }}
        >
          <option value="">Todos</option>
          <option value="ok">OK</option>
          <option value="bajo">Bajo mínimo</option>
          <option value="agotado">Agotado</option>
          <option value="por_vencer">Por vencer</option>
          <option value="vencido">Vencido</option>
        </select>
      ),
      render: (item: StockItem) => <StockBadge item={item} />,
    },
    {
      key: 'proximo_vencimiento',
      header: 'Próx. vencimiento',
      className: 'hidden lg:table-cell',
      render: (item: StockItem) => {
        if (!item.proximo_vencimiento) return <span className="text-xs opacity-20">--</span>
        const days = daysUntil(item.proximo_vencimiento)
        return (
          <div>
            <p className="text-xs font-medium">{formatDate(item.proximo_vencimiento)}</p>
            <p className={`text-[11px] font-medium ${days <= 0 ? 'text-error' : days <= 30 ? 'text-warning' : 'opacity-35'}`}>
              {days <= 0 ? 'Vencido' : days === 1 ? 'mañana' : `en ${days} días`}
            </p>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-5">

      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm opacity-50 mt-0.5">Stock actual por producto</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-sm btn-ghost gap-1.5"
            onClick={() => setShowPdfModal(true)}
          >
            <FileDown className="h-4 w-4" />
            Exportar PDF
          </button>
          <label className="flex items-center gap-2">
            <MapPin className="h-4 w-4 opacity-40 shrink-0" />
            <select
              className="select select-bordered w-56"
              value={areaId}
              onChange={(e) => { setAreaId(e.target.value); setPage(1) }}
            >
              <option value="">Todas las secciones</option>
              {areas?.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Chips de resumen */}
      {resumen && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`badge badge-lg gap-1.5 border cursor-pointer transition-colors ${!estadoFiltro ? 'badge-neutral' : 'badge-ghost'}`}
            onClick={() => { setEstadoFiltro(''); setPage(1) }}
          >
            <Package className="h-3.5 w-3.5" />
            {resumen.total_productos_con_stock} productos
          </button>
          {resumen.productos_bajo_minimo > 0 && (
            <button
              className={`badge badge-lg gap-1.5 border cursor-pointer transition-colors ${estadoFiltro === 'bajo' ? 'badge-warning' : 'badge-ghost'}`}
              onClick={() => { setEstadoFiltro(estadoFiltro === 'bajo' ? '' : 'bajo'); setPage(1) }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {resumen.productos_bajo_minimo} bajo mínimo
            </button>
          )}
          {resumen.productos_por_vencer_90d > 0 && (
            <button
              className={`badge badge-lg gap-1.5 border cursor-pointer transition-colors ${estadoFiltro === 'por_vencer' ? 'badge-error' : 'badge-ghost'}`}
              onClick={() => { setEstadoFiltro(estadoFiltro === 'por_vencer' ? '' : 'por_vencer'); setPage(1) }}
            >
              <Clock className="h-3.5 w-3.5" />
              {resumen.productos_por_vencer_90d} por vencer (90 d)
            </button>
          )}
        </div>
      )}

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows as unknown as Record<string, unknown>[]}
            onRowClick={(item) => setSelectedProducto(item as unknown as StockItem)}
            selectedId={selectedProducto?.producto_id as unknown as number}
            keyField="producto_id"
            emptyMessage="No se encontraron productos"
          />
          <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </>
      )}

      {/* Panel lateral de detalle */}
      <Sheet
        open={!!selectedProducto}
        onClose={() => setSelectedProducto(null)}
        title={selectedProducto?.producto_nombre}
      >
        {selectedProducto && (
          <StockDetail item={selectedProducto} areaId={areaId ? Number(areaId) : null} />
        )}
      </Sheet>

      {/* Modal exportar PDF */}
      {showPdfModal && areas && (
        <PdfExportModal
          areas={areas}
          usuarioNombre={usuario?.nombre ?? 'Sistema'}
          onClose={() => setShowPdfModal(false)}
          onExport={async (selectedAreas, incluirResumen) => {
            try {
              const config = await api
                .get<{ nombre_laboratorio: string; logo_base64: string }>('/configuracion')
                .then((r) => r.data)
              await exportarStockPDF({
                selectedAreas,
                incluirResumen,
                nombreLaboratorio: config.nombre_laboratorio,
                logoBase64: config.logo_base64,
                usuarioNombre: usuario?.nombre ?? 'Sistema',
              })
              setShowPdfModal(false)
            } catch {
              toast.error('Error al generar el PDF')
            }
          }}
        />
      )}
    </div>
  )
}

function StockBadge({ item }: { item: StockItem }) {
  const stock = item.stock_total ?? 0
  if (stock <= 0) return <Badge variant="outline">Agotado</Badge>
  if (stock <= item.stock_minimo) return <Badge variant="destructive">Bajo mínimo</Badge>
  if (item.proximo_vencimiento) {
    const days = daysUntil(item.proximo_vencimiento)
    if (days <= 0) return <Badge variant="destructive">Vencido</Badge>
    if (days <= 30) return <Badge variant="warning">Por vencer</Badge>
  }
  return <Badge variant="success">OK</Badge>
}

function PdfExportModal({
  areas,
  usuarioNombre,
  onClose,
  onExport,
}: {
  areas: Area[]
  usuarioNombre: string
  onClose: () => void
  onExport: (selectedAreas: Area[], incluirResumen: boolean) => Promise<void>
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(areas.map((a) => a.id)))
  const [incluirResumen, setIncluirResumen] = useState(true)
  const [loading, setLoading] = useState(false)

  const toggleArea = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === areas.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(areas.map((a) => a.id)))
  }

  async function handleExport() {
    if (selectedIds.size === 0) return
    setLoading(true)
    const selected = areas.filter((a) => selectedIds.has(a.id))
    await onExport(selected, incluirResumen)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
          <div className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Exportar PDF</h2>
          </div>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Selección de áreas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Secciones a incluir</p>
              <button
                className="text-xs text-primary hover:underline"
                onClick={toggleAll}
              >
                {selectedIds.size === areas.length ? 'Desmarcar todas' : 'Seleccionar todas'}
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-base-200 rounded-xl p-2">
              {areas.map((area) => (
                <label
                  key={area.id}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-base-200 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={selectedIds.has(area.id)}
                    onChange={() => toggleArea(area.id)}
                  />
                  <span className="text-sm">{area.nombre}</span>
                  {area.es_bodega && (
                    <span className="badge badge-xs badge-ghost ml-auto">Bodega</span>
                  )}
                </label>
              ))}
            </div>
            {selectedIds.size === 0 && (
              <p className="text-xs text-error">Selecciona al menos una sección</p>
            )}
          </div>

          {/* Opciones */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Opciones</p>
            <label className="flex items-center gap-3 px-3 py-2.5 border border-base-200 rounded-xl cursor-pointer hover:bg-base-200 transition-colors">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={incluirResumen}
                onChange={(e) => setIncluirResumen(e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium">Incluir resumen ejecutivo</p>
                <p className="text-xs opacity-50">Página con totales: productos, alertas y áreas</p>
              </div>
            </label>
          </div>

          {/* Info */}
          <div className="rounded-lg bg-base-200 px-3 py-2 text-xs opacity-60 space-y-0.5">
            <p>Generado por: <span className="font-medium">{usuarioNombre}</span></p>
            <p>Formato: Carta horizontal (landscape)</p>
            <p className="text-warning font-medium">Las alertas se destacan: rojo = bajo mínimo, amarillo = vence en ≤30 días</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-base-200 justify-end">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary btn-sm gap-1.5"
            disabled={selectedIds.size === 0 || loading}
            onClick={handleExport}
          >
            {loading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {loading ? 'Generando...' : `Exportar (${selectedIds.size} sección${selectedIds.size !== 1 ? 'es' : ''})`}
          </button>
        </div>
      </div>
    </div>
  )
}

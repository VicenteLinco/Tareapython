import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, MapPin, Package, AlertTriangle, Clock, FileDown, LayoutGrid, ListFilter, Info } from 'lucide-react'
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
import { daysUntil, formatDate, autoPlural, cn } from '@/lib/utils'
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
  const setSelectedArea = useAreaStore((s) => s.setSelectedArea)
  const usuario = useAuthStore((s) => s.usuario)
  const [areaId, setAreaId] = useState(globalAreaId ? String(globalAreaId) : '')

  // Sync with global area filter
  useEffect(() => {
    setAreaId(globalAreaId ? String(globalAreaId) : '')
    setPage(1)
  }, [globalAreaId])
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
          <p className="font-medium text-sm truncate leading-tight">{item.producto_nombre}</p>
          {item.codigo_interno && (
            <p className="text-[10px] font-mono opacity-40 truncate">{item.codigo_interno}</p>
          )}
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoría',
      className: 'hidden md:table-cell w-32',
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
        <span className="text-xs opacity-60 truncate block">{item.categoria ?? '--'}</span>
      ),
    },
    {
      key: 'stock_total',
      header: 'Disponibilidad',
      render: (item: StockItem) => {
        const qty = item.stock_total ?? 0
        const min = item.stock_minimo ?? 0
        // Cálculo de "salud" del stock: 0-100%
        // Rojo: <= mínimo
        // Amarillo: <= 2 * mínimo
        // Verde: > 2 * mínimo
        const pct = min > 0 ? (qty / (min * 2)) * 100 : 100
        const colorClass = qty <= 0 ? 'progress-error' :
                          qty <= min ? 'progress-error' :
                          qty <= min * 2 ? 'progress-warning' : 'progress-success'

        return (
          <div className="flex flex-col gap-1 w-32 sm:w-40">
            <div className="flex justify-between items-end">
              <span className="font-mono text-sm font-bold">
                {Math.round(qty)}
                <span className="text-[10px] font-normal opacity-40 ml-1">
                  {qty === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}
                </span>
              </span>
              {min > 0 && (
                <span className="text-[10px] opacity-30">mín: {Math.round(min)}</span>
              )}
            </div>
            <progress
              className={cn("progress h-1.5 w-full", colorClass)}
              value={Math.min(pct, 100)}
              max="100"
            />
          </div>
        )
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      className: 'w-28',
      filter: (
        <select
          className="select select-bordered select-xs w-full"
          value={estadoFiltro}
          onChange={(e) => { setEstadoFiltro(e.target.value); setPage(1) }}
        >
          <option value="">Todos</option>
          <option value="ok">Saludable</option>
          <option value="bajo">Bajo mínimo</option>
          <option value="agotado">Agotado</option>
          <option value="por_vencer">Cercano a vencer</option>
          <option value="vencido">Vencido</option>
        </select>
      ),
      render: (item: StockItem) => <StockBadge item={item} />,
    },
    {
      key: 'proximo_vencimiento',
      header: 'Vencimiento FEFO',
      className: 'hidden lg:table-cell w-40',
      render: (item: StockItem) => {
        if (!item.proximo_vencimiento) return <span className="text-xs opacity-20 italic">Sin vencimiento</span>
        const days = daysUntil(item.proximo_vencimiento)
        return (
          <div className="flex items-center gap-2">
            <div className={cn(
              "p-1.5 rounded-lg shrink-0",
              days <= 0 ? "bg-error/10 text-error" : days <= 30 ? "bg-warning/10 text-warning" : "bg-base-200 text-base-content/40"
            )}>
              <Clock className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{formatDate(item.proximo_vencimiento)}</p>
              <p className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                days <= 0 ? "text-error" : days <= 30 ? "text-warning" : "opacity-30"
              )}>
                {days <= 0 ? 'Expirado' : days === 1 ? 'mañana' : `en ${days} días`}
              </p>
            </div>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">

      {/* Cabecera Estratégica */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Package className="h-6 w-6" />
            <h1 className="text-2xl font-black tracking-tight uppercase">Control de Stock</h1>
          </div>
          <p className="text-sm text-base-content/60 font-medium">
            Supervisión proactiva de reactivos e insumos médicos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="join bg-base-200 p-1 rounded-xl">
            <button
              className={cn("join-item btn btn-sm border-none shadow-none", !areaId ? "btn-primary" : "btn-ghost")}
              onClick={() => { setAreaId(''); setSelectedArea(null); setPage(1) }}
            >
              <LayoutGrid className="h-4 w-4 mr-1.5" />
              Global
            </button>
            <div className="dropdown dropdown-end join-item">
              <div tabIndex={0} role="button" className={cn("btn btn-sm border-none shadow-none", areaId ? "btn-primary" : "btn-ghost")}>
                <MapPin className="h-4 w-4 mr-1.5" />
                {areaId ? areas?.find(a => String(a.id) === areaId)?.nombre : 'Por Área'}
              </div>
              <ul tabIndex={0} className="dropdown-content z-[10] menu p-2 shadow-xl bg-base-100 rounded-box w-52 mt-2 border border-base-200">
                {areas?.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => { setAreaId(String(a.id)); setSelectedArea(a.id); setPage(1) }}>
                      {a.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <button
            className="btn btn-sm btn-outline gap-2"
            onClick={() => setShowPdfModal(true)}
          >
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar Reporte</span>
          </button>
        </div>
      </div>

      {/* Dashboard de Indicadores (DaisyUI Stats) */}
      {resumen && (
        <div className="stats stats-vertical lg:stats-horizontal shadow-sm bg-base-100 border border-base-200 w-full overflow-hidden">
          <div className="stat">
            <div className="stat-figure text-primary opacity-30">
              <Package className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs font-bold uppercase tracking-wider opacity-60">Total Insumos</div>
            <div className="stat-value text-primary text-2xl">{resumen.total_productos_con_stock}</div>
            <div className="stat-desc font-medium">Ítems activos en estantería</div>
          </div>

          <div
            className={cn(
              "stat cursor-pointer transition-colors hover:bg-base-200",
              estadoFiltro === 'bajo' && "bg-warning/10"
            )}
            onClick={() => { setEstadoFiltro(estadoFiltro === 'bajo' ? '' : 'bajo'); setPage(1) }}
          >
            <div className="stat-figure text-warning">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs font-bold uppercase tracking-wider opacity-60">Bajo Mínimo</div>
            <div className="stat-value text-warning text-2xl">{resumen.productos_bajo_minimo}</div>
            <div className="stat-desc font-bold text-warning/80">Acción de compra requerida</div>
          </div>

          <div
            className={cn(
              "stat cursor-pointer transition-colors hover:bg-base-200",
              estadoFiltro === 'por_vencer' && "bg-error/10"
            )}
            onClick={() => { setEstadoFiltro(estadoFiltro === 'por_vencer' ? '' : 'por_vencer'); setPage(1) }}
          >
            <div className="stat-figure text-error">
              <Clock className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs font-bold uppercase tracking-wider opacity-60">Riesgo Vencimiento</div>
            <div className="stat-value text-error text-2xl">{resumen.productos_por_vencer_90d}</div>
            <div className="stat-desc font-bold text-error/80">Lotes próximos a expirar</div>
          </div>
        </div>
      )}

      {/* Info Tooltip si hay filtros */}
      {(search || categoriaId || proveedorId || estadoFiltro) && (
        <div className="alert bg-base-200 border-none py-2 px-4 flex items-center gap-3">
          <ListFilter className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 flex flex-wrap gap-2 items-center text-xs font-medium">
            <span>Filtros activos:</span>
            {search && <span className="badge badge-sm badge-outline">{search}</span>}
            {categoriaId && <span className="badge badge-sm badge-outline">Categoría: {categorias?.find(c => String(c.id) === categoriaId)?.nombre}</span>}
            {estadoFiltro && <span className="badge badge-sm badge-primary uppercase">{estadoFiltro.replace('_', ' ')}</span>}
            <button
              className="btn btn-xs btn-link text-primary no-underline p-0 h-auto min-h-0 ml-auto"
              onClick={() => {
                setSearchInput(''); setSearch(''); setCategoriaId(''); setProveedorId(''); setEstadoFiltro(''); setPage(1);
              }}
            >
              Limpiar todo
            </button>
          </div>
        </div>
      )}

      {/* Tabla Pro */}
      <div className="bg-base-100 rounded-2xl border border-base-200 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <div className="skeleton h-8 w-full opacity-50" />
            <div className="skeleton h-12 w-full opacity-50" />
            <div className="skeleton h-12 w-full opacity-50" />
            <div className="skeleton h-12 w-full opacity-50" />
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              data={rows as unknown as Record<string, unknown>[]}
              onRowClick={(item) => setSelectedProducto(item as unknown as StockItem)}
              selectedId={selectedProducto?.producto_id as unknown as number}
              keyField="producto_id"
              emptyMessage="No se encontraron productos con los criterios actuales"
            />
            <div className="p-4 border-t border-base-200 bg-base-50/50">
              <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>

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
  const min = item.stock_minimo ?? 0

  if (stock <= 0) return <div className="badge badge-error badge-outline gap-1 text-[10px] font-bold uppercase px-2"><Info className="h-3 w-3" /> Agotado</div>
  if (stock <= min) return <div className="badge badge-error gap-1 text-[10px] font-bold uppercase px-2"><AlertTriangle className="h-3 w-3" /> Crítico</div>

  if (item.proximo_vencimiento) {
    const days = daysUntil(item.proximo_vencimiento)
    if (days <= 0) return <div className="badge badge-error gap-1 text-[10px] font-bold uppercase px-2">Vencido</div>
    if (days <= 30) return <div className="badge badge-warning gap-1 text-[10px] font-bold uppercase px-2">Riesgo</div>
  }

  if (stock <= min * 2) return <div className="badge badge-warning badge-outline text-[10px] font-bold uppercase px-2">Atención</div>

  return <div className="badge badge-success badge-outline text-[10px] font-bold uppercase px-2">Saludable</div>
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base-300/60 backdrop-blur-sm p-4">
      <div className="bg-base-100 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-base-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 bg-base-100 border-b border-base-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl text-primary">
              <FileDown className="h-5 w-5" />
            </div>
            <h2 className="font-bold text-lg tracking-tight">Reporte de Inventario</h2>
          </div>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Selección de áreas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider opacity-60">Secciones a incluir</p>
              <button
                className="text-xs font-bold text-primary hover:opacity-70 transition-opacity"
                onClick={toggleAll}
              >
                {selectedIds.size === areas.length ? 'Limpiar Todo' : 'Todo el Laboratorio'}
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1 bg-base-200/50 rounded-2xl p-2 border border-base-200">
              {areas.map((area) => (
                <label
                  key={area.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
                    selectedIds.has(area.id) ? "bg-base-100 shadow-sm" : "hover:bg-base-200 opacity-70"
                  )}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary rounded-md"
                    checked={selectedIds.has(area.id)}
                    onChange={() => toggleArea(area.id)}
                  />
                  <span className="text-sm font-medium">{area.nombre}</span>
                  {area.es_bodega && (
                    <span className="badge badge-xs badge-ghost ml-auto font-bold uppercase tracking-wider opacity-50">Bodega</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Opciones */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider opacity-60">Configuración</p>
            <label className="flex items-start gap-4 px-4 py-3 bg-base-200/50 border border-base-200 rounded-2xl cursor-pointer hover:bg-base-200 transition-all">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary rounded-md mt-0.5"
                checked={incluirResumen}
                onChange={(e) => setIncluirResumen(e.target.checked)}
              />
              <div className="flex-1">
                <p className="text-sm font-bold">Resumen Ejecutivo</p>
                <p className="text-[11px] opacity-50 mt-1 leading-relaxed">Incluye una página inicial con los KPIs globales (insumos, alertas críticas y áreas).</p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-5 bg-base-100 border-t border-base-200 justify-end">
          <button className="btn btn-ghost btn-sm font-bold h-10 px-5" onClick={onClose}>Cerrar</button>
          <button
            className="btn btn-primary btn-sm h-10 px-6 font-bold gap-2"
            disabled={selectedIds.size === 0 || loading}
            onClick={handleExport}
          >
            {loading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {loading ? 'Generando...' : `Generar PDF`}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { 
  Search, 
  Plus, 
  FileDown, 
  LayoutGrid, 
  List as ListIcon,
  AlertTriangle,
  Clock,
  ChevronRight,
  Package,
  Info,
  ShoppingCart
} from 'lucide-react'
import api from '@/lib/api'
import { ProductoImage } from '@/components/ui/producto-image'
import type { StockItem, PaginatedResponse, Categoria, Proveedor, Area } from '@/types'
import { autoPlural, cn, daysUntil } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StockDetail } from './stock-detail'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarStockPDF } from '@/lib/stock-pdf'
import { toast } from 'sonner'

export default function StockPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [categoriaId, setCategoriaId] = useState<number | null>(null)
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [stockBajo, setStockBajo] = useState(false)
  const [conAlertas, setConAlertas] = useState(searchParams.get('alertas') === 'true')
  const [filter, setFilter] = useState(searchParams.get('filter') || '')
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('select') || null)
  const [areaId, setAreaId] = useState<number | null>(null)
  const [showPdfModal, setShowPdfModal] = useState(false)

  const usuario = useAuthStore(s => s.usuario)

  // Sincronizar URL con estado local
  useEffect(() => {
    const s = searchParams.get('search')
    const sel = searchParams.get('select')
    const alertas = searchParams.get('alertas') === 'true'
    const f = searchParams.get('filter') || ''
    if (s !== null && s !== search) setSearch(s)
    if (sel !== null && sel !== selectedId) setSelectedId(sel)
    if (alertas !== conAlertas) setConAlertas(alertas)
    if (f !== filter) setFilter(f)
  }, [searchParams])

  // Queries
  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock', { search, categoriaId, proveedorId, stockBajo, conAlertas, areaId, filter }],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          proveedor_id: proveedorId || undefined,
          stock_bajo: stockBajo || undefined,
          con_alertas: conAlertas || undefined,
          area_id: areaId || undefined,
          filter: filter || undefined,
          per_page: 100
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const items = stockResponse?.data ?? []
  const selectedItem = items.find(i => i.producto_id === selectedId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-base-content">
              {filter === 'critico' ? 'Riesgo de Quiebre' : 
               filter === 'vencimiento' ? 'Próximos a Vencer' :
               filter === 'vencidos' ? 'Lotes Vencidos' : 
               filter === 'sin-stock' ? 'Stock Quebrado' : 'Inventario Global'}
            </h1>
            {filter && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1 px-3 py-1 rounded-full text-[10px] font-bold">
                Filtro Activo: {filter.toUpperCase()}
                <button 
                  className="hover:text-error ml-1 transition-colors" 
                  onClick={() => {
                    const newParams = new URLSearchParams(searchParams)
                    newParams.delete('filter')
                    newParams.delete('alertas')
                    setSearchParams(newParams)
                  }}
                >
                  ✕
                </button>
              </Badge>
            )}
          </div>
          <p className="text-sm text-base-content/50">
            {filter ? 'Mostrando items que requieren atención prioritaria' : 'Consulta y gestión de existencias en tiempo real'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filter === 'critico' && (
            <Button size="sm" className="h-9 rounded-xl btn-primary shadow-lg shadow-primary/20 text-white" onClick={() => navigate('/solicitudes-compra')}>
              <ShoppingCart className="w-4 h-4 mr-2" />
              Generar Pedido
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-9 rounded-xl border-base-300" onClick={() => setShowPdfModal(true)}>
            <FileDown className="w-4 h-4 mr-2 opacity-50" />
            Exportar
          </Button>
          {usuario?.rol === 'admin' && (
            <Button size="sm" className="h-9 rounded-xl shadow-lg shadow-primary/20" onClick={() => setSelectedId('new')}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Producto
            </Button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-base-100 p-3 rounded-2xl border border-base-200 shadow-sm">
        <div className="md:col-span-3 relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 group-focus-within:opacity-100 transition-opacity" />
          <Input 
            placeholder="Buscar por nombre o código..." 
            className="pl-9 h-10 bg-base-200/50 border-transparent focus:bg-base-100 transition-all rounded-xl text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="md:col-span-2">
          <select 
            className="select select-sm h-10 w-full bg-base-200/50 border-none rounded-xl text-xs font-medium"
            value={areaId ?? ''}
            onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las Áreas</option>
            {areas?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <select 
            className="select select-sm h-10 w-full bg-base-200/50 border-none rounded-xl text-xs font-medium"
            value={categoriaId ?? ''}
            onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Categorías</option>
            {categorias?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <select 
            className="select select-sm h-10 w-full bg-base-200/50 border-none rounded-xl text-xs font-medium"
            value={proveedorId ?? ''}
            onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Proveedores</option>
            {proveedores?.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        <div className="md:col-span-3 flex items-center justify-between gap-2 pl-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer group" title="Mostrar solo productos con alertas">
              <input 
                type="checkbox" 
                className="checkbox checkbox-xs checkbox-error rounded-md" 
                checked={conAlertas || !!filter}
                onChange={(e) => {
                  setConAlertas(e.target.checked)
                  if (!e.target.checked) setFilter('')
                }}
              />
              <span className={cn("text-[9px] font-bold uppercase tracking-wider transition-opacity", (conAlertas || !!filter) ? "text-error" : "opacity-50 group-hover:opacity-100")}>Con Alertas</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <input 
                type="checkbox" 
                className="checkbox checkbox-xs checkbox-primary rounded-md" 
                checked={stockBajo}
                onChange={(e) => {
                  setStockBajo(e.target.checked)
                  if (e.target.checked) setFilter('') // Clear specific alert filter if stockBajo is checked
                }}
              />
              <span className={cn("text-[9px] font-bold uppercase tracking-wider transition-opacity", stockBajo ? "text-primary" : "opacity-50 group-hover:opacity-100")}>Stock Bajo</span>
            </label>
          </div>
          <div className="flex bg-base-200 p-1 rounded-lg">
            <button 
              className={cn("p-1 rounded-md transition-all", view === 'list' ? "bg-base-100 shadow-sm" : "opacity-40")}
              onClick={() => setView('list')}
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
            <button 
              className={cn("p-1 rounded-md transition-all", view === 'grid' ? "bg-base-100 shadow-sm" : "opacity-40")}
              onClick={() => setView('grid')}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={cn("transition-all duration-300", selectedId ? "lg:col-span-7" : "lg:col-span-12")}>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="py-20 text-center bg-base-100 rounded-3xl border border-dashed border-base-300">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="text-base-content/40 font-medium">No se encontraron productos con estos filtros</p>
            </div>
          ) : view === 'list' ? (
            <div className="bg-base-100 rounded-3xl border border-base-200 overflow-hidden shadow-sm">
              <table className="table table-zebra w-full">
                <thead>
                  <tr className="bg-base-200/50 text-[10px] uppercase tracking-widest opacity-50 border-none">
                    <th className="pl-6">Producto</th>
                    <th>Categoría</th>
                    <th className="text-center">Existencias</th>
                    <th>Estado</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="border-none">
                  {items.map(item => (
                    <tr 
                      key={item.producto_id} 
                      className={cn(
                        "hover:bg-primary/5 cursor-pointer transition-colors group border-base-200",
                        selectedId === item.producto_id && "bg-primary/5 active-row"
                      )}
                      onClick={() => setSelectedId(item.producto_id)}
                    >
                      <td className="pl-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <ProductoImage src={item.imagen_url} size="sm" />
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-base-content group-hover:text-primary transition-colors">{item.producto_nombre}</span>
                            <span className="text-[10px] font-mono opacity-40 uppercase tracking-tighter">#{item.codigo_interno}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="text-xs font-medium opacity-60 bg-base-200 px-2 py-1 rounded-lg">{item.categoria || 'Sin categoría'}</span>
                      </td>
                      <td className="text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-mono font-bold text-base leading-none">{Math.round(item.stock_total ?? 0)}</span>
                          <span className="text-[9px] opacity-40 uppercase font-bold mt-1">{(item.stock_total ?? 0) === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
                        </div>
                      </td>
                      <td>
                        <StockBadge item={item} />
                      </td>
                      <td className="pr-6">
                        <ChevronRight className={cn("w-4 h-4 transition-all opacity-0 group-hover:opacity-100", selectedId === item.producto_id ? "translate-x-1 opacity-100 text-primary" : "opacity-20")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map(item => (
                <button 
                  key={item.producto_id}
                  onClick={() => setSelectedId(item.producto_id)}
                  className={cn(
                    "flex flex-col p-5 bg-base-100 border border-base-200 rounded-[2rem] text-left transition-all hover:border-primary/40 hover:shadow-xl group relative overflow-hidden",
                    selectedId === item.producto_id && "ring-2 ring-primary border-transparent shadow-xl"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <ProductoImage src={item.imagen_url} size="md" className="group-hover:ring-2 group-hover:ring-primary/20" />
                    <StockBadge item={item} />
                  </div>
                  <h3 className="font-bold text-base leading-tight mb-1 line-clamp-2">{item.producto_nombre}</h3>
                  <p className="text-[10px] font-mono opacity-40 uppercase mb-4 tracking-widest">#{item.codigo_interno}</p>
                  
                  <div className="mt-auto pt-4 border-t border-base-200/50 flex items-end justify-between">
                    <div>
                      <p className="text-[10px] font-bold opacity-30 uppercase mb-1">Disponible</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold tabular-nums leading-none">{Math.round(item.stock_total ?? 0)}</span>
                        <span className="text-xs opacity-40">{(item.stock_total ?? 0) === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}</span>
                      </div>
                    </div>
                    <div className="h-8 w-8 rounded-xl bg-base-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="w-4 h-4 opacity-40" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedId && (
          <div className="lg:col-span-5 sticky top-24 animate-in slide-in-from-right-4 duration-300">
            <div className="bg-base-100 border border-base-200 rounded-[2.5rem] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-6 bg-base-200/30 border-b border-base-200">
                <h2 className="font-bold text-lg">{selectedId === 'new' ? 'Nuevo Producto' : 'Detalle de Inventario'}</h2>
                <button className="btn btn-sm btn-ghost btn-circle" onClick={() => setSelectedId(null)}>✕</button>
              </div>
              <div className="p-6 custom-scrollbar max-h-[calc(100vh-250px)] overflow-y-auto">
                {selectedId === 'new' ? (
                  <p className="text-sm opacity-50 p-10 text-center italic">Formulario de creación pendiente...</p>
                ) : selectedItem ? (
                  <StockDetail item={selectedItem} areaId={areaId} />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PDF Export Modal */}
      {showPdfModal && (
        <PdfExportModal 
          areas={areas ?? []} 
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
                filters: {
                  q: search || undefined,
                  categoria_id: categoriaId?.toString() || undefined,
                  proveedor_id: proveedorId?.toString() || undefined,
                  stock_bajo: stockBajo,
                }
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
  const dias = item.dias_autonomia ?? 999
  const leadTime = item.lead_time_propio ?? 3

  if (stock <= 0) return (
    <div className="flex flex-col items-end gap-1">
        <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
            <Info className="h-3 w-3" /> Agotado
        </Badge>
        <span className="text-[9px] font-bold text-error uppercase tracking-tighter italic">Reponer de inmediato</span>
    </div>
  )
  
  if (dias <= leadTime) return (
    <div className="flex flex-col items-end gap-1">
        <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
            <AlertTriangle className="h-3 w-3" /> Crítico
        </Badge>
        <span className="text-[9px] font-bold text-error opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias)} días</span>
    </div>
  )

  if (dias <= leadTime + 7) return (
    <div className="flex flex-col items-end gap-1">
        <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2">
            <Clock className="h-3 w-3" /> Reponer
        </Badge>
        <span className="text-[9px] font-bold text-warning opacity-70 uppercase tracking-tighter">Quedan ~{Math.round(dias)} días</span>
    </div>
  )

  if (item.proximo_vencimiento) {
    const days = daysUntil(item.proximo_vencimiento)
    if (days !== null && days <= 0) return (
        <div className="flex flex-col items-end gap-1">
            <Badge variant="destructive" className="gap-1 text-[10px] font-bold uppercase px-2">
                <Clock className="h-3 w-3" /> Vencido
            </Badge>
            <span className="text-[9px] font-bold text-error uppercase">Retirar de stock</span>
        </div>
    )
    if (days !== null && days <= 30) return (
        <div className="flex flex-col items-end gap-1">
            <Badge variant="warning" className="gap-1 text-[10px] font-bold uppercase px-2 animate-pulse">
                <Clock className="h-3 w-3" /> Riesgo
            </Badge>
            <span className="text-[9px] font-bold text-warning uppercase">Vence en {days} días</span>
        </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant="outline" className="text-[10px] font-bold uppercase px-2 text-success border-success/20 bg-success/5">
        OK
      </Badge>
      <span className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">~{Math.round(dias)} días de stock</span>
    </div>
  )
}

function PdfExportModal({
  areas,
  onClose,
  onExport,
}: {
  areas: Area[]
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

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Plus, FileDown, LayoutGrid, List as ListIcon, X } from 'lucide-react'
import api from '@/lib/api'
import type { StockItem, PaginatedResponse } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarStockPDF } from '@/lib/stock-pdf'
import { notify } from '@/lib/notify'
import { FilterBar } from '@/components/ui/filter-bar'
import { useAreas, useCategorias, useProveedores } from '@/hooks/dominio/useCatalogos'
import { useStockFilters } from './hooks/useStockFilters'
import { PdfExportModal } from './components/pdf-export-modal'
import { SearchDropdown } from './components/search-dropdown'
import { StockSecondaryFilters } from './components/stock-secondary-filters'
import { StockDetailPanel } from './components/stock-detail-panel'
import { StockList } from './components/stock-list'

export default function StockPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('select') || null)
  const [showPdfModal, setShowPdfModal] = useState(false)

  const {
    search, setSearch,
    estado, setEstado,
    categoriaId, setCategoriaId,
    proveedorId, setProveedorId,
    areaId, setAreaId,
    clearSf, hasSfActive,
    searchActiveIndex, setSearchActiveIndex,
    searchDropdownOpen, setSearchDropdownOpen,
    searchContainerRef,
    searchItemRefs,
    handleSearchKeyDown,
  } = useStockFilters()

  const usuario = useAuthStore(s => s.usuario)
  const showAlertas = searchParams.get('alertas') === 'true'
  const areaIdsParam = searchParams.get('area_ids') || undefined

  // Queries
  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock', { search, categoriaId, proveedorId, areaId, areaIdsParam, estado, showAlertas }],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          proveedor_id: proveedorId || undefined,
          area_id: areaIdsParam ? undefined : areaId || undefined,
          area_ids: areaIdsParam,
          estado: estado !== 'todos' ? estado : undefined,
          con_alertas: showAlertas || undefined,
          per_page: 100
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()
  const { data: areas } = useAreas()

  const items = stockResponse?.data ?? []
  const selectedItem = items.find(i => i.producto_id === selectedId)

  const activeSecondaryCount = [
    categoriaId !== null && categoriaId !== undefined,
    proveedorId !== null && proveedorId !== undefined,
    estado !== 'todos',
  ].filter(Boolean).length

  const searchSuggestions = items.slice(0, 16)
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

  const groupedSearchItems = (() => {
    const result: ({ type: 'header'; letter: string } | { type: 'item'; item: StockItem; idx: number })[] = []
    let lastL = ''
    searchSuggestions.forEach((item, idx) => {
      const l = item.producto_nombre[0]?.toUpperCase() ?? '#'
      if (l !== lastL) { result.push({ type: 'header', letter: l }); lastL = l }
      result.push({ type: 'item', item, idx })
    })
    return result
  })()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="t-h1 tracking-tight text-base-content">
              {estado === 'bajo'    ? 'Stock Bajo' :
               estado === 'sin_stock' ? 'Stock Quebrado' :
               estado === 'vencido' ? 'Stock Vencido' :
               estado === 'vence_pronto' ? 'Stock Por Vencer' :
               estado === 'normal'  ? 'Stock Normal' : 'Inventario Global'}
            </h1>
            {estado !== 'todos' && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 gap-1 px-3 py-1 rounded-full text-[10px] font-bold">
                {estado.toUpperCase()}
                <button className="hover:text-error ml-1 transition-colors" onClick={() => setEstado('todos')}>✕</button>
              </Badge>
            )}
          </div>
          <p className="text-sm text-base-content/50">
            {estado !== 'todos' ? 'Mostrando items que requieren atención prioritaria' : 'Consulta y gestión de existencias en tiempo real'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 rounded-xl border-base-300" onClick={() => setShowPdfModal(true)}>
            <FileDown className="w-4 h-4 mr-2 opacity-50" />
            Exportar
          </Button>
          {usuario?.rol === 'admin' && (
            <Button size="sm" className="h-9 rounded-xl shadow-lg shadow-primary/20" onClick={() => navigate('/creador-productos?nuevo=true')}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Producto
            </Button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <FilterBar
        search={
          <div ref={searchContainerRef} className="relative group w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 group-focus-within:opacity-100 transition-opacity z-10 pointer-events-none" />
            <Input
              placeholder="Buscar por nombre o código..."
              className="pl-9 h-10 bg-base-200/50 border-transparent focus:bg-base-100 transition-all rounded-xl text-xs"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchDropdownOpen(true) }}
              onKeyDown={(e) => handleSearchKeyDown(e, searchSuggestions)}
              onFocus={() => setSearchDropdownOpen(true)}
              aria-autocomplete="list"
              aria-expanded={showSearchDropdown}
            />
            {showSearchDropdown && (
              <SearchDropdown
                groupedItems={groupedSearchItems}
                activeIndex={searchActiveIndex}
                itemRefs={searchItemRefs}
                onSelect={(name) => { setSearch(name); setSearchDropdownOpen(false) }}
                setActiveIndex={setSearchActiveIndex}
              />
            )}
          </div>
        }
        primaryFilter={
          <select
            className="select select-sm h-10 w-full bg-base-200/50 border-none rounded-xl text-xs font-medium"
            value={areaId ?? ''}
            onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las Áreas</option>
            {areas?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        }
        secondaryFilters={
          <StockSecondaryFilters
            categorias={categorias}
            proveedores={proveedores}
            categoriaId={categoriaId}
            proveedorId={proveedorId}
            estado={estado}
            setCategoriaId={setCategoriaId}
            setProveedorId={setProveedorId}
            setEstado={setEstado}
          />
        }
        activeSecondaryCount={activeSecondaryCount}
        chips={[
          { label: 'Stock bajo', value: 'bajo', active: estado === 'bajo',
            onClick: () => setEstado(estado === 'bajo' ? 'todos' : 'bajo') },
          { label: 'Sin stock', value: 'sin_stock', active: estado === 'sin_stock',
            onClick: () => setEstado(estado === 'sin_stock' ? 'todos' : 'sin_stock') },
          { label: 'Vencido', value: 'vencido', active: estado === 'vencido',
            onClick: () => setEstado(estado === 'vencido' ? 'todos' : 'vencido') },
          { label: 'Por vencer', value: 'vence_pronto', active: estado === 'vence_pronto',
            onClick: () => setEstado(estado === 'vence_pronto' ? 'todos' : 'vence_pronto') },
          { label: 'Normal', value: 'normal', active: estado === 'normal',
            onClick: () => setEstado(estado === 'normal' ? 'todos' : 'normal') },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {(hasSfActive || estado !== 'todos' || search) && (
              <button
                onClick={() => { clearSf(); setEstado('todos'); setSearch('') }}
                className="flex items-center gap-1 px-3 py-1 rounded-full border border-base-300 text-[11px] font-bold text-base-content/60 hover:text-error hover:border-error/40 transition-all"
              >
                <X className="w-3 h-3" />
                Limpiar
              </button>
            )}
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
        }
      />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={cn(
          "transition-all duration-300",
          selectedId ? "hidden lg:block lg:col-span-7" : "lg:col-span-12"
        )}>
          <StockList
            items={items}
            isLoading={isLoading}
            view={view}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Detail Panel */}
        {selectedId && (
          <StockDetailPanel
            selectedId={selectedId}
            selectedItem={selectedItem}
            areaId={areaId}
            onClose={() => setSelectedId(null)}
            onClearFilters={() => { clearSf(); setEstado('todos'); setSearch('') }}
          />
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
                  stock_bajo: estado === 'bajo',
                }
              })
              setShowPdfModal(false)
            } catch (e) {
              console.error('[PDF Export] Error:', e)
              notify.error('Error al generar el PDF')
            }
          }}
        />
      )}
    </div>
  )
}

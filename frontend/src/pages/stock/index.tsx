import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { Sheet } from '@/components/ui/sheet'
import { useAreaStore } from '@/hooks/use-area-store'
import api from '@/lib/api'
import type { PaginatedResponse, StockItem, Categoria } from '@/types'
import { daysUntil, formatDate } from '@/lib/utils'
import { StockDetail } from './stock-detail'

export default function StockPage() {
  const [search, setSearch] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [stockBajo, setStockBajo] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedProducto, setSelectedProducto] = useState<StockItem | null>(null)
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId)

  const { data, isLoading } = useQuery({
    queryKey: ['stock', { search, categoriaId, stockBajo, page, selectedAreaId }],
    queryFn: () =>
      api.get<PaginatedResponse<StockItem>>('/stock', {
        params: {
          q: search || undefined,
          categoria_id: categoriaId || undefined,
          stock_bajo: stockBajo || undefined,
          area_id: selectedAreaId || undefined,
          page,
          per_page: 25,
        },
      }).then((r) => r.data),
  })

  const { data: categorias } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
  })

  const columns = [
    {
      key: 'producto_nombre',
      header: 'Producto',
      render: (item: StockItem) => (
        <div>
          <p className="font-medium text-sm">{item.producto_nombre}</p>
          {item.producto_codigo && (
            <p className="text-[11px] font-mono opacity-35">{item.producto_codigo}</p>
          )}
        </div>
      ),
    },
    {
      key: 'categoria_nombre',
      header: 'Categoría',
      className: 'hidden md:table-cell',
      render: (item: StockItem) => (
        <span className="text-sm opacity-60">{item.categoria_nombre}</span>
      ),
    },
    {
      key: 'stock_total',
      header: 'Stock',
      render: (item: StockItem) => (
        <div className="font-mono">
          <span className="font-semibold">{item.stock_total}</span>
          <span className="text-xs opacity-35 ml-1">{item.unidad_base_nombre}</span>
        </div>
      ),
    },
    {
      key: 'lotes_activos',
      header: 'Lotes',
      className: 'hidden lg:table-cell',
      render: (item: StockItem) => (
        <span className="text-sm opacity-40 font-mono">{item.lotes_activos}</span>
      ),
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (item: StockItem) => <StockBadge item={item} />,
    },
    {
      key: 'vencimiento_proximo',
      header: 'Vencimiento',
      className: 'hidden lg:table-cell',
      render: (item: StockItem) =>
        item.vencimiento_proximo ? (
          <span className="text-xs opacity-50">{formatDate(item.vencimiento_proximo)}</span>
        ) : (
          <span className="text-xs opacity-20">--</span>
        ),
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventario</h1>
        <p className="text-sm opacity-50 mt-0.5">Stock actual por producto</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5">
        <label className="input input-bordered input-sm flex items-center gap-2 flex-1 min-w-[200px] h-9">
          <Search className="h-3.5 w-3.5 opacity-35" />
          <input
            type="text"
            className="grow text-sm"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </label>
        <select
          className="select select-bordered select-sm h-9 w-44 text-sm"
          value={categoriaId}
          onChange={(e) => { setCategoriaId(e.target.value); setPage(1) }}
        >
          <option value="">Categoría</option>
          {categorias?.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 cursor-pointer px-2">
          <input
            type="checkbox"
            className="checkbox checkbox-xs checkbox-warning"
            checked={stockBajo}
            onChange={(e) => { setStockBajo(e.target.checked); setPage(1) }}
          />
          <span className="text-xs font-medium opacity-60">Stock bajo</span>
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={(data?.data ?? []) as unknown as Record<string, unknown>[]}
            onRowClick={(item) => setSelectedProducto(item as unknown as StockItem)}
            selectedId={selectedProducto?.producto_id}
            keyField="producto_id"
            emptyMessage="No se encontraron productos"
          />
          <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </>
      )}

      {/* Detail Sheet */}
      <Sheet
        open={!!selectedProducto}
        onClose={() => setSelectedProducto(null)}
        title={selectedProducto?.producto_nombre}
      >
        {selectedProducto && (
          <StockDetail productoId={selectedProducto.producto_id} areaId={selectedAreaId} />
        )}
      </Sheet>
    </div>
  )
}

function StockBadge({ item }: { item: StockItem }) {
  if (item.stock_total <= 0) return <Badge variant="outline">Agotado</Badge>
  if (item.stock_total <= item.stock_minimo) return <Badge variant="destructive">Bajo mínimo</Badge>
  if (item.vencimiento_proximo) {
    const days = daysUntil(item.vencimiento_proximo)
    if (days <= 0) return <Badge variant="destructive">Vencido</Badge>
    if (days <= 30) return <Badge variant="warning">Por vencer</Badge>
  }
  return <Badge variant="success">OK</Badge>
}

import { Package } from 'lucide-react'
import { EmptyState } from '@/components/ui/page-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { StockItem } from '@/types'
import { StockItemCard } from './stock-item-card'

interface StockListProps {
  items: StockItem[]
  isLoading: boolean
  view: 'grid' | 'list'
  selectedId: string | null
  onSelect: (id: string) => void
}

export function StockList({ items, isLoading, view, selectedId, onSelect }: StockListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="No se encontraron productos"
        description="Ajusta la búsqueda o cambia los filtros para ver más resultados."
      />
    )
  }

  if (view === 'list') {
    return (
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
              <StockItemCard
                key={item.producto_id}
                item={item}
                view="list"
                isSelected={selectedId === item.producto_id}
                onClick={() => onSelect(item.producto_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {items.map(item => (
        <StockItemCard
          key={item.producto_id}
          item={item}
          view="grid"
          isSelected={selectedId === item.producto_id}
          onClick={() => onSelect(item.producto_id)}
        />
      ))}
    </div>
  )
}

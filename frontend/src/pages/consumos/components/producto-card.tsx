import { useState, useEffect, useRef } from 'react'
import { Plus, Check } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { ProductoImage } from '@/components/ui/producto-image'
import type { StockItem } from '@/types'
import type { LoteDisponible } from './lote-selector'

// CartItem definition compartida — importada por index.tsx y consumo-drawer.tsx
export interface CartItem {
  producto_id: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_total: number
  area_id: number
  area_nombre: string
  imagen_url?: string | null
  codigo_interno: string
  categoria: string | null
  lotes: LoteDisponible[]
  lote_elegido_id: string | null
  cantidad_descontar: number
}

interface ProductoCardProps {
  producto: StockItem
  isEnCarrito: boolean
  onAdd: () => void
}

export function ProductoCard({ producto, isEnCarrito, onAdd }: ProductoCardProps) {
  const [flash, setFlash] = useState(false)
  const didMountRef = useRef(false)
  const sinStock = (producto.stock_total ?? 0) <= 0

  // Flash verde breve al agregar (skip en initial mount)
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    if (isEnCarrito) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      return () => clearTimeout(t)
    }
  }, [isEnCarrito])

  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 p-3 rounded-2xl border transition-all duration-200',
        sinStock && 'opacity-40',
        flash && 'bg-success/10 border-success/40',
        !flash && isEnCarrito && 'bg-primary/5 border-primary/30',
        !flash && !isEnCarrito && 'bg-base-100 border-base-200 hover:border-base-300',
      )}
    >
      {/* Imagen + badges */}
      <div className="flex items-start gap-2">
        <ProductoImage src={producto.imagen_url} size="sm" className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight line-clamp-2">{producto.producto_nombre}</p>
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            {producto.area_nombre && (
              <span className="badge badge-xs bg-blue-100 text-blue-700 border-none">{producto.area_nombre}</span>
            )}
            {producto.categoria && (
              <span className="badge badge-xs bg-green-100 text-green-700 border-none">{producto.categoria}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stock */}
      <div className="flex items-center justify-between">
        {sinStock ? (
          <span className="badge badge-xs badge-error badge-outline">Sin stock</span>
        ) : (
          <span className="text-xs text-base-content/50 font-medium">
            {formatCantidad(producto.stock_total ?? 0, producto.unidad, producto.unidad_plural ?? undefined)}
          </span>
        )}

        {!sinStock && (
          <button
            className={cn(
              'btn btn-xs btn-circle transition-all',
              isEnCarrito ? 'btn-primary' : 'btn-outline hover:btn-primary'
            )}
            onClick={onAdd}
            aria-label={isEnCarrito ? 'Ya agregado' : 'Agregar'}
          >
            {isEnCarrito ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  )
}

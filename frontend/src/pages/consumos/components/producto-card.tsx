// frontend/src/pages/consumos/components/producto-card.tsx
// Fila horizontal: ícono+badge | nombre+subtítulo | → | lotes | días | stock | control
import { useState, useEffect, useRef } from 'react'
import { Plus, Clock } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { daysChipColor } from '@/lib/theme'
import { ProductoImage } from '@/components/ui/producto-image'
import type { StockItem } from '@/types'
import type { LoteDisponible } from './lote-selector'

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
  cargando_lotes: boolean
  lote_elegido_id: string | null
  cantidad_descontar: number
}

interface ProductoCardProps {
  producto: StockItem
  isEnCarrito: boolean
  cantidadEnCarrito?: number
  onAdd: () => void
  onIncrement?: () => void
  onDecrement?: () => void
}

function DaysChip({ days }: { days: number }) {
  if (days <= 0) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-error/10 text-error whitespace-nowrap">
      Sin stock
    </span>
  )
  const cls = daysChipColor(days)
  return (
    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', cls)}>
      ~{days} días stock
    </span>
  )
}

export function ProductoCard({
  producto, isEnCarrito, cantidadEnCarrito = 0,
  onAdd, onDecrement,
}: ProductoCardProps) {
  const [flash, setFlash] = useState(false)
  const didMountRef = useRef(false)
  const sinStock = (producto.stock_total ?? 0) <= 0
  const dias = producto.dias_autonomia
  const subtitulo = [producto.area_nombre, producto.categoria].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    if (isEnCarrito) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 500)
      return () => clearTimeout(t)
    }
  }, [isEnCarrito])

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-2xl border transition-all duration-200',
        sinStock && 'opacity-50 bg-base-100 border-base-200',
        flash && 'bg-success/10 border-success/40',
        !flash && isEnCarrito && 'bg-primary/8 border-primary/25 shadow-sm',
        !flash && !isEnCarrito && !sinStock && 'bg-base-100 border-base-200 hover:border-base-300 hover:shadow-sm cursor-pointer',
      )}
      onClick={() => !sinStock && !isEnCarrito && onAdd()}
    >
      {/* Ícono con badge de cantidad */}
      <div className="relative flex-shrink-0">
        <ProductoImage
          src={producto.imagen_url}
          size="sm"
          className={cn(
            'w-10 h-10 rounded-xl',
            isEnCarrito && 'ring-2 ring-primary/30'
          )}
        />
        {isEnCarrito && cantidadEnCarrito > 0 && (
          <div className={cn(
            'absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1',
            'bg-primary text-primary-content text-[10px] font-bold rounded-full',
            'flex items-center justify-center border-2 border-base-100 shadow-sm',
          )}>
            {cantidadEnCarrito}
          </div>
        )}
      </div>

      {/* Nombre + área · categoría */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'font-semibold text-sm leading-tight line-clamp-1',
          isEnCarrito && 'text-primary'
        )}>
          {producto.producto_nombre}
        </p>
        {subtitulo && (
          <p className="text-[11px] text-base-content/40 mt-0.5 line-clamp-1">{subtitulo}</p>
        )}
      </div>

      {/* Derecha: lotes · días · stock · control */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {/* Cantidad de lotes con stock */}
        {!sinStock && (producto.lotes_count ?? 0) > 0 && (
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-base-content/35 whitespace-nowrap">
            <Clock className="h-3 w-3" />
            <span>
              {producto.lotes_count} {producto.lotes_count === 1 ? 'lote' : 'lotes'}
            </span>
          </div>
        )}

        {/* Días de stock */}
        {!sinStock && dias != null && <DaysChip days={dias} />}

        {sinStock ? (
          <span className="badge badge-xs badge-error badge-outline">Sin stock</span>
        ) : isEnCarrito ? (
          // Stepper inline en la fila
          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                'border border-primary/25 bg-primary/8 text-primary',
                'hover:bg-primary hover:text-primary-content hover:border-primary transition-all duration-150',
              )}
              onClick={() => onDecrement?.()}
            >
              −
            </button>
            <span className="text-sm font-bold text-primary min-w-[16px] text-center tabular-nums">
              {cantidadEnCarrito}
            </span>
            <button
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                'border border-primary/25 bg-primary/8 text-primary',
                'hover:bg-primary hover:text-primary-content hover:border-primary transition-all duration-150',
              )}
              onClick={e => { e.stopPropagation(); onAdd() }}
            >
              +
            </button>
          </div>
        ) : (
          <>
            {/* Stock total — visible en md+ */}
            <span className="hidden md:block text-xs text-base-content/50 font-medium whitespace-nowrap">
              {formatCantidad(producto.stock_total ?? 0, producto.unidad, producto.unidad_plural ?? undefined)}
            </span>
            <button
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center',
                'border border-base-300 bg-transparent',
                'hover:border-primary hover:bg-primary/8 transition-all duration-150',
              )}
              onClick={e => { e.stopPropagation(); onAdd() }}
              aria-label="Agregar al consumo"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

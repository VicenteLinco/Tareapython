import { useRef, useEffect } from 'react'
import { Zap, ChevronDown, Trash2, Minus, Plus, X, AlertTriangle } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { LoteSelector } from './lote-selector'
import type { CartItem } from './producto-card'

interface ConsumoDrawerProps {
  cart: Record<string, CartItem>
  areaFiltro: number | null
  isExpanded: boolean
  onToggle: () => void
  onUpdateCantidad: (productoId: string, cantidad: number) => void
  onUpdateLote: (productoId: string, loteId: string | null) => void
  onRemove: (productoId: string) => void
  onClear: () => void
  onConfirm: () => void
  isPending: boolean
  notas: string
  onNotasChange: (v: string) => void
}

export function ConsumoDrawer({
  cart, areaFiltro, isExpanded, onToggle,
  onUpdateCantidad, onUpdateLote, onRemove, onClear,
  onConfirm, isPending, notas, onNotasChange,
}: ConsumoDrawerProps) {
  const items = Object.values(cart)
  const count = items.length
  const scrollRef = useRef<HTMLDivElement>(null)

  // Detectar items con lotes cargando
  const hayCargando = items.some(i => i.cargando_lotes)

  // Detectar desajuste de área: item tiene area_id distinto al filtro actual (cuando hay filtro)
  const itemsDesajustados = areaFiltro
    ? items.filter(i => i.area_id !== 0 && i.area_id !== areaFiltro)
    : []
  const hayDesajuste = itemsDesajustados.length > 0

  // Detectar exceso de cantidad por lote
  function stockLoteSeleccionado(item: CartItem): number | null {
    if (!item.lote_elegido_id) return null
    const lote = item.lotes.find(l => l.lote_id === item.lote_elegido_id)
    return lote?.stock ?? null
  }
  const itemsConExceso = items.filter(i => {
    const stock = stockLoteSeleccionado(i)
    return stock !== null && i.cantidad_descontar > stock
  })
  const hayExceso = itemsConExceso.length > 0

  const confirmarBloqueado = hayCargando || hayDesajuste || hayExceso

  // Scroll al top del drawer cuando se expande
  useEffect(() => {
    if (isExpanded) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [isExpanded])

  if (count === 0) return null

  return (
    <>
      {/* Backdrop al expandir */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px]"
          onClick={onToggle}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 bg-base-100 border-t border-base-200 shadow-2xl transition-all duration-300 ease-out',
          isExpanded ? 'rounded-t-3xl' : 'rounded-t-2xl',
        )}
      >
        {/* Handle / barra colapsada */}
        <div className="w-full flex items-center justify-between px-4 py-3 gap-3">
          <button
            className="flex items-center gap-2 flex-1 text-left min-w-0"
            onClick={onToggle}
            aria-label={isExpanded ? 'Colapsar' : 'Ver consumo a registrar'}
          >
            <ChevronDown className={cn('h-4 w-4 text-base-content/40 transition-transform duration-300', !isExpanded && 'rotate-180')} />
            <span className="font-bold text-sm">
              {isExpanded ? 'Consumo a registrar' : `${count} ${count === 1 ? 'item' : 'items'} agregado${count === 1 ? '' : 's'}`}
            </span>
          </button>
          {!isExpanded && (
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-xl gap-1 flex-shrink-0"
              onClick={e => { e.stopPropagation(); onConfirm() }}
              disabled={isPending || confirmarBloqueado}
            >
              {isPending
                ? <span className="loading loading-spinner loading-xs" />
                : hayCargando
                  ? <><span className="loading loading-spinner loading-xs" /> Cargando…</>
                  : <><Zap className="h-3.5 w-3.5" /> Confirmar consumo</>
              }
            </button>
          )}
        </div>

        {/* Contenido expandido */}
        {isExpanded && (
          <div className="flex flex-col max-h-[70vh]">
            {/* Header con "vaciar" */}
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-xs text-base-content/40">{count} {count === 1 ? 'item' : 'items'}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error gap-1"
                onClick={onClear}
              >
                <X className="h-3 w-3" /> Vaciar
              </button>
            </div>

            {/* Banner desajuste de área */}
            {hayDesajuste && (
              <div className="mx-4 mb-1 flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning font-medium leading-snug">
                  Hay {itemsDesajustados.length} {itemsDesajustados.length === 1 ? 'item' : 'items'} de otra área.
                  Cambia el filtro o elimínalos antes de confirmar.
                </p>
              </div>
            )}

            {/* Lista de items */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-3 pb-2">
              {items.map(item => {
                const stockLote = stockLoteSeleccionado(item)
                const excedeLote = stockLote !== null && item.cantidad_descontar > stockLote
                const desajustado = areaFiltro !== null && item.area_id !== 0 && item.area_id !== areaFiltro

                return (
                  <div
                    key={item.producto_id}
                    className={cn(
                      "rounded-2xl p-3 space-y-2",
                      desajustado
                        ? "bg-warning/5 border border-warning/30"
                        : "bg-base-200/40"
                    )}
                  >
                    {/* Nombre + badge área + eliminar */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm leading-tight line-clamp-2">{item.nombre}</p>
                        {item.area_nombre && (
                          <span className={cn(
                            "inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5",
                            desajustado
                              ? "bg-warning/15 text-warning"
                              : "bg-base-300/60 text-base-content/50"
                          )}>
                            {item.area_nombre}
                          </span>
                        )}
                      </div>
                      <button
                        className="btn btn-ghost btn-xs btn-circle text-error flex-shrink-0"
                        onClick={() => onRemove(item.producto_id)}
                        aria-label={`Quitar ${item.nombre}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Selector de lote */}
                    <LoteSelector
                      lotes={item.lotes}
                      cargandoLotes={item.cargando_lotes}
                      loteElegidoId={item.lote_elegido_id}
                      unidad={item.unidad}
                      unidad_plural={item.unidad_plural}
                      onChange={loteId => onUpdateLote(item.producto_id, loteId)}
                    />

                    {/* Cantidad */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => onUpdateCantidad(item.producto_id, Math.max(1, item.cantidad_descontar - 1))}
                          aria-label={`Disminuir cantidad de ${item.nombre}`}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          className={cn(
                            "input input-xs w-14 text-center font-bold",
                            excedeLote ? "input-error border-error" : "input-bordered"
                          )}
                          value={item.cantidad_descontar}
                          min={1}
                          onChange={e => onUpdateCantidad(item.producto_id, Math.max(1, parseInt(e.target.value) || 1))}
                        />
                        <button
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => onUpdateCantidad(item.producto_id, item.cantidad_descontar + 1)}
                          aria-label={`Aumentar cantidad de ${item.nombre}`}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <span className="text-xs text-base-content/50">
                          {formatCantidad(item.cantidad_descontar, item.unidad, item.unidad_plural)}
                        </span>
                      </div>
                      {/* Feedback de stock del lote */}
                      {stockLote !== null && (
                        excedeLote ? (
                          <p className="text-[11px] text-error font-medium">
                            Excede stock del lote (máx {formatCantidad(stockLote, item.unidad, item.unidad_plural)})
                          </p>
                        ) : (
                          <p className="text-[11px] text-base-content/40">
                            Stock disponible en lote: {formatCantidad(stockLote, item.unidad, item.unidad_plural)}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Nota + botón confirmar */}
            <div className="px-4 pt-2 pb-4 border-t border-base-200 space-y-2 bg-base-100">
              <input
                className="input input-bordered input-sm w-full rounded-xl text-sm"
                placeholder="Nota (opcional)..."
                value={notas}
                onChange={e => onNotasChange(e.target.value)}
                aria-label="Nota del consumo"
              />
              <button
                className="btn btn-primary w-full rounded-xl gap-2"
                disabled={isPending || confirmarBloqueado}
                onClick={onConfirm}
              >
                {isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : hayCargando
                    ? <><span className="loading loading-spinner loading-sm" /> Cargando lotes…</>
                    : <><Zap className="h-4 w-4" /> Confirmar consumo</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

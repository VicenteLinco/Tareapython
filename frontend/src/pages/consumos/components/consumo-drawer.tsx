// frontend/src/pages/consumos/components/consumo-drawer.tsx
// REDISEÑO: Panel lateral fijo en desktop (md+) + bottom drawer en móvil
import { useRef, useEffect, useState } from 'react'
import { Zap, ChevronDown, Trash2, Minus, Plus, X, AlertTriangle, ShoppingCart, CheckCircle2, XCircle } from 'lucide-react'
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
  const [showValidacion, setShowValidacion] = useState(false)

  const itemsTrazablesSinLote = items.filter(i => i.control_lote === 'trazable' && !i.lote_elegido_id)
  const hayTrazableSinLote = itemsTrazablesSinLote.length > 0

  function stockLoteSeleccionado(item: CartItem): number | null {
    if (!item.lote_elegido_id) return null
    return item.lotes.find(l => l.lote_id === item.lote_elegido_id)?.stock ?? null
  }
  const itemsConExceso = items.filter(i => {
    if (i.control_lote === 'simple') {
      return i.cantidad_descontar > i.stock_total
    }
    const s = stockLoteSeleccionado(i)
    return s !== null && i.cantidad_descontar > s
  })
  const itemsDesajustados = items.filter(i => areaFiltro !== null && i.area_id !== 0 && i.area_id !== areaFiltro)
  const hayDesajuste = itemsDesajustados.length > 0
  const hayCargando = items.some(i => i.cargando_lotes)
  const confirmarBloqueado = hayCargando || hayDesajuste || hayTrazableSinLote

  /* Lanzar validación previa cuando hay ítems problemáticos */
  const handleConfirmClick = () => {
    if (itemsConExceso.length > 0) {
      setShowValidacion(true)
    } else {
      onConfirm()
    }
  }

  /* Modal de validación previa */
  const ValidacionModal = () => {
    if (!showValidacion) return null
    return (
      <div className="modal modal-open z-50">
        <div className="modal-box max-w-md">
          <h3 className="font-bold text-base mb-1">Revisión antes de confirmar</h3>
          <p className="text-sm text-base-content/60 mb-4">
            {itemsConExceso.length} {itemsConExceso.length === 1 ? 'ítem excede' : 'ítems exceden'} el stock disponible.
          </p>
          <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
            {items.map(item => {
              const stock = item.control_lote === 'simple' ? item.stock_total : stockLoteSeleccionado(item)
              const excede = item.control_lote === 'simple'
                ? item.cantidad_descontar > item.stock_total
                : stock !== null && item.cantidad_descontar > stock
              return (
                <div key={item.producto_id} className={cn(
                  'flex items-center justify-between rounded-xl px-3 py-2 text-sm',
                  excede ? 'bg-error/8 border border-error/20' : 'bg-success/8 border border-success/20',
                )}>
                  <div className="flex items-center gap-2 min-w-0">
                    {excede
                      ? <XCircle className="size-4 text-error shrink-0" />
                      : <CheckCircle2 className="size-4 text-success shrink-0" />}
                    <span className="truncate font-medium">{item.nombre}</span>
                  </div>
                  <span className={cn('shrink-0 text-xs tabular-nums', excede ? 'text-error' : 'text-success')}>
                    {formatCantidad(item.cantidad_descontar, item.unidad, item.unidad_plural)}
                    {excede && stock !== null && (
                      <span className="opacity-60"> / {formatCantidad(stock, item.unidad, item.unidad_plural)}</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-base-content/50 mb-4">
            El backend usará FEFO automático. Si el stock total es insuficiente, el consumo fallará.
          </p>
          <div className="modal-action">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowValidacion(false)}>
              Corregir
            </button>
            <button
              className="btn btn-error btn-sm"
              onClick={() => { setShowValidacion(false); onConfirm() }}
            >
              Confirmar de todas formas
            </button>
          </div>
        </div>
        <div className="modal-backdrop" onClick={() => setShowValidacion(false)} />
      </div>
    )
  }

  useEffect(() => {
    if (isExpanded) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [isExpanded])

  if (count === 0) return null

  // ── Contenido compartido (items + footer) ──────────────────────────────────
  const ItemsList = () => (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-3 pb-2 scrollbar-thin-hover">
      {hayDesajuste && (
        <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-warning font-medium leading-snug">
            {itemsDesajustados.length} {itemsDesajustados.length === 1 ? 'item' : 'items'} de otra área.
            Cambia el filtro o elimínalos antes de confirmar.
          </p>
        </div>
      )}

      {hayTrazableSinLote && (
        <div className="flex items-start gap-2 bg-error/10 border border-error/30 rounded-xl px-3 py-2">
          <XCircle className="h-4 w-4 text-error shrink-0 mt-0.5" />
          <p className="text-xs text-error font-medium leading-snug">
            {itemsTrazablesSinLote.length} {itemsTrazablesSinLote.length === 1 ? 'reactivo crítico requiere' : 'reactivos críticos requieren'} escanear o seleccionar un lote exacto para registrar consumo.
          </p>
        </div>
      )}

      {items.map(item => {
        const stockLote = stockLoteSeleccionado(item)
        const excedeLote = stockLote !== null && item.cantidad_descontar > stockLote
        const desajustado = areaFiltro !== null && item.area_id !== 0 && item.area_id !== areaFiltro

        return (
          <div
            key={item.producto_id}
            className={cn(
              'rounded-2xl p-3 space-y-2',
              desajustado ? 'bg-warning/5 border border-warning/30' : 'bg-base-200/40'
            )}
          >
            {/* Fila 1: nombre + área + quitar */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-tight line-clamp-2">{item.nombre}</p>
                {item.area_nombre && (
                  <span className={cn(
                    'inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1',
                    desajustado ? 'bg-warning/15 text-warning' : 'bg-base-300/60 text-base-content/50'
                  )}>
                    {item.area_nombre}
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost btn-xs btn-circle text-error flex-shrink-0 -mt-0.5"
                onClick={() => onRemove(item.producto_id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Fila 2: lote pill (izq) + stepper (der) en la misma fila */}
            <div className="flex items-center justify-between gap-2">
              {item.control_lote === 'simple' ? (
                <span className="text-[11px] font-bold uppercase tracking-wider text-base-content/30 py-1">Consumible</span>
              ) : (
                <LoteSelector
                  lotes={item.lotes}
                  cargandoLotes={item.cargando_lotes}
                  loteElegidoId={item.lote_elegido_id}
                  unidad={item.unidad}
                  unidad_plural={item.unidad_plural}
                  onChange={id => onUpdateLote(item.producto_id, id)}
                />
              )}

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                    'border border-base-300 hover:border-primary hover:bg-primary/8 hover:text-primary transition-all duration-150'
                  )}
                  onClick={() => onUpdateCantidad(item.producto_id, Math.max(1, item.cantidad_descontar - 1))}
                >
                  <Minus className="h-3 w-3" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  className={cn(
                    'input input-bordered input-xs h-7 w-14 rounded-lg px-1 text-center text-sm font-bold tabular-nums',
                    '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                    excedeLote ? 'input-error text-error' : 'text-base-content'
                  )}
                  value={item.cantidad_descontar}
                  onChange={e => {
                    const next = Number(e.target.value)
                    onUpdateCantidad(item.producto_id, Number.isFinite(next) ? Math.max(1, Math.trunc(next)) : 1)
                  }}
                  onFocus={e => e.currentTarget.select()}
                  aria-label={`Cantidad de ${item.nombre}`}
                />
                <button
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                    'border border-base-300 hover:border-primary hover:bg-primary/8 hover:text-primary transition-all duration-150'
                  )}
                  onClick={() => onUpdateCantidad(item.producto_id, item.cantidad_descontar + 1)}
                >
                  <Plus className="h-3 w-3" />
                </button>
                <span className="text-[11px] text-base-content/40 whitespace-nowrap">
                  {item.unidad_plural && item.cantidad_descontar !== 1 ? item.unidad_plural : item.unidad}
                </span>
              </div>
            </div>

            {/* Fila 3: feedback de stock (solo si aplica) */}
            {item.control_lote === 'simple' ? (
              item.cantidad_descontar > item.stock_total
                ? <p className="text-[11px] text-error font-medium">Excede stock disponible (máx {formatCantidad(item.stock_total, item.unidad, item.unidad_plural)})</p>
                : <p className="text-[11px] text-base-content/35">Disponible total: {formatCantidad(item.stock_total, item.unidad, item.unidad_plural)}</p>
            ) : (
              stockLote !== null && (
                excedeLote
                  ? <p className="text-[11px] text-error font-medium">Excede stock del lote (máx {formatCantidad(stockLote, item.unidad, item.unidad_plural)})</p>
                  : <p className="text-[11px] text-base-content/35">Disponible: {formatCantidad(stockLote, item.unidad, item.unidad_plural)}</p>
              )
            )}
          </div>
        )
      })}
    </div>
  )

  const Footer = () => (
    <div className="px-4 pt-2 pb-4 border-t border-base-200 space-y-2 bg-base-100">
      <input
        className="input input-bordered input-sm w-full rounded-xl text-sm"
        placeholder="Nota (opcional)..."
        value={notas}
        onChange={e => onNotasChange(e.target.value)}
      />
      <button
        className="btn btn-primary w-full rounded-xl gap-2"
        disabled={isPending || confirmarBloqueado}
        onClick={handleConfirmClick}
      >
        {isPending
          ? <span className="loading loading-spinner loading-sm" />
          : hayCargando
            ? <><span className="loading loading-spinner loading-sm" /> Cargando lotes…</>
            : <><Zap className="h-4 w-4" /> Confirmar consumo</>}
      </button>
    </div>
  )

  return (
    <>
      <ValidacionModal />

      {/* ━━━ DESKTOP: Panel lateral fijo (md+) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className={cn(
        'hidden md:flex flex-col',
        'fixed top-[60px] right-0 bottom-0 z-30',
        'w-[300px] lg:w-[320px]',
        'bg-base-100 border-l border-base-200',
        'shadow-[-4px_0_20px_oklch(0_0_0/0.04)]',
        'transition-transform duration-300 ease-out',
        count > 0 ? 'translate-x-0' : 'translate-x-full'
      )}>
        {/* Header del panel */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-200 flex-shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Consumo a registrar
            <span className="badge badge-primary badge-sm font-bold">{count}</span>
          </div>
          <button
            className="btn btn-ghost btn-xs text-error gap-1"
            onClick={onClear}
          >
            <X className="h-3 w-3" /> Vaciar
          </button>
        </div>

        <ItemsList />
        <Footer />
      </div>

      {/* ━━━ MÓVIL: Bottom drawer (< md) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <>
        {isExpanded && (
          <div
            className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] md:hidden"
            onClick={onToggle}
          />
        )}

        <div className={cn(
          'fixed bottom-0 left-0 right-0 z-40 md:hidden',
          'bg-base-100 border-t border-base-200 shadow-2xl',
          'transition-all duration-300 ease-out',
          isExpanded ? 'rounded-t-3xl' : 'rounded-t-2xl',
        )}>
          {/* Handle colapsado */}
          <div className="w-full flex items-center justify-between px-4 py-3 gap-3">
            <button
              className="flex items-center gap-2 flex-1 text-left min-w-0"
              onClick={onToggle}
            >
              <ChevronDown className={cn(
                'h-4 w-4 text-base-content/40 transition-transform duration-300',
                !isExpanded && 'rotate-180'
              )} />
              <span className="font-bold text-sm">
                {isExpanded
                  ? 'Consumo a registrar'
                  : `${count} ${count === 1 ? 'item' : 'items'} agregado${count === 1 ? '' : 's'}`}
              </span>
              {!isExpanded && (
                <span className="badge badge-primary badge-sm font-bold ml-1">{count}</span>
              )}
            </button>
            {!isExpanded && (
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-xl gap-1 flex-shrink-0"
                onClick={e => { e.stopPropagation(); handleConfirmClick() }}
                disabled={isPending || confirmarBloqueado}
              >
                {isPending
                  ? <span className="loading loading-spinner loading-xs" />
                  : hayCargando
                    ? <><span className="loading loading-spinner loading-xs" /> Cargando…</>
                    : <><Zap className="h-3.5 w-3.5" /> Confirmar</>}
              </button>
            )}
          </div>

          {isExpanded && (
            <div className="flex flex-col max-h-[70vh]">
              <div className="flex items-center justify-between px-4 pb-2">
                <span className="text-xs text-base-content/40">{count} {count === 1 ? 'item' : 'items'}</span>
                <button className="btn btn-ghost btn-xs text-error gap-1" onClick={onClear}>
                  <X className="h-3 w-3" /> Vaciar
                </button>
              </div>
              <ItemsList />
              <Footer />
            </div>
          )}
        </div>
      </>
    </>
  )
}

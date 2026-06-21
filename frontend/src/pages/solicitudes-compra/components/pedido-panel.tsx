// frontend/src/pages/solicitudes-compra/components/pedido-panel.tsx
import { ShoppingCart, Plus, Minus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { cn } from '@/lib/utils'
import { CantidadConUnidad } from '@/components/ui/cantidad'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProductoImage } from '@/components/ui/producto-image'
import type { SolicitudItem, Proveedor } from '@/types'
import {
  HORIZONTE_CHIPS,
  calcularDiasCubiertos,
  pillClasses,
  pillText,
  unidadLabel,
  formatPesos,
  horizonLabel,
} from '../solicitud-utils'

interface PedidoPanelProps {
  proveedor?: Proveedor | null
  items: SolicitudItem[]
  itemsByProveedor: Array<{
    proveedor_id: number
    proveedor_nombre: string
    items: SolicitudItem[]
    subtotal: number
  }>
  totalGeneral: number
  solicitudId: string | null
  isSaving: boolean
  isGuardando: boolean
  horizonteGlobal: number
  popoverOpenId: string | null
  monedaCodigo: string
  onUpdateQty: (pid: string, val: number) => void
  onUpdatePrecio: (pid: string, precioUnitarioBase: number) => void
  onRemove: (pid: string) => void
  onGlobalHorizonteChange: (dias: number) => void
  onHorizonteChip: (pid: string, dias: number) => void
  onResetHorizonteToGlobal: (pid: string) => void
  onPopoverToggle: (pid: string | null) => void
  onSaveBorrador: () => void
  onGuardar: () => void
}

function PedidoItem({
  item,
  horizonteGlobal,
  popoverOpenId,
  onUpdateQty,
  onUpdatePrecio,
  onRemove,
  onHorizonteChip,
  onResetHorizonteToGlobal,
  onPopoverToggle,
}: {
  item: SolicitudItem
  horizonteGlobal: number
  popoverOpenId: string | null
  onUpdateQty: (pid: string, val: number) => void
  onUpdatePrecio: (pid: string, precioUnitarioBase: number) => void
  onRemove: (pid: string) => void
  onHorizonteChip: (pid: string, dias: number) => void
  onResetHorizonteToGlobal: (pid: string) => void
  onPopoverToggle: (pid: string | null) => void
}) {
  const diasCubiertos = calcularDiasCubiertos(item)
  const esPersonalizado = item.horizonte_personalizado === true
  const popoverAbierto = popoverOpenId === item.producto_id
  const hasPres = !!(item.presentacion_id && item.factor_conversion)

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200/50 border border-transparent hover:border-primary/10 transition-all rounded-xl group">
      {item.imagen_url && (
        <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
      )}

      <span className="flex-1 min-w-0 font-medium text-xs truncate">
        {item.producto_nombre}
      </span>

      {item.tipo_estimacion_demanda === 'historial_corto' && (
        <span
          className="inline-flex items-center gap-1 shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20"
          title={item.horizonte_razon ?? 'Estimacion provisional por historial corto'}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          Historial corto
        </span>
      )}

      {/* Pill de cobertura */}
      <div className="relative shrink-0" data-popover-item>
        <button
          onClick={() => onPopoverToggle(popoverAbierto ? null : item.producto_id)}
          className={cn(
            "text-[10px] font-bold border rounded-full px-2.5 py-1 whitespace-nowrap transition-all hover:opacity-80",
            pillClasses(diasCubiertos, esPersonalizado)
          )}
        >
          {pillText(diasCubiertos, esPersonalizado)}
        </button>
        {popoverAbierto && (
          <div className="app-floating-menu absolute top-full right-0 mt-1.5 rounded-box p-3 min-w-[220px]">
            <p className="text-[10px] font-bold opacity-60 uppercase tracking-wider mb-2">
              Ajustar horizonte
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {HORIZONTE_CHIPS.map(d => (
                <button
                  key={d}
                  onClick={() => onHorizonteChip(item.producto_id, d)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all",
                    item.horizonte_dias === d
                      ? "bg-primary text-primary-content border-primary"
                      : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40"
                  )}
                >
                  {horizonLabel(d)}
                  {d === horizonteGlobal && item.horizonte_dias !== d && (
                    <span className="ml-1 opacity-50 text-[8px]">global</span>
                  )}
                </button>
              ))}
            </div>
            {esPersonalizado && (
              <button
                onClick={() => onResetHorizonteToGlobal(item.producto_id)}
                className="text-[10px] text-primary hover:underline w-full text-left opacity-70"
              >
                ↩ Usar global ({horizonteGlobal}d)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Control de cantidad */}
      <div className="flex items-center bg-base-100 rounded-lg border border-base-300 p-0.5 shadow-inner shrink-0">
        <button
          className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
          onClick={() => onUpdateQty(item.producto_id, item.cantidad - 1)}
        >
          <Minus className="h-2.5 w-2.5" />
        </button>
        <input
          type="number"
          className="w-9 text-center text-xs font-black bg-transparent focus:outline-none no-spinners"
          value={item.cantidad}
          onChange={e => onUpdateQty(item.producto_id, parseInt(e.target.value) || 1)}
        />
        <button
          className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
          onClick={() => onUpdateQty(item.producto_id, item.cantidad + 1)}
        >
          <Plus className="h-2.5 w-2.5" />
        </button>
      </div>

      <span className="text-[10px] font-bold text-primary w-14 truncate shrink-0">
        {unidadLabel(item, item.cantidad)}
      </span>

      <div className="text-right w-28 shrink-0">
        {(() => {
          const factor = item.factor_conversion ?? 1
          const unidadPrecio = hasPres ? (item.presentacion_nombre ?? 'pres.') : item.unidad_base
          return (
            <div className="flex items-center justify-end gap-1">
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.precio_unitario > 0 ? item.precio_unitario * factor : ''}
                placeholder="0"
                title={`Precio por ${unidadPrecio}`}
                onChange={e => onUpdatePrecio(item.producto_id, (parseFloat(e.target.value) || 0) / factor)}
                className="w-16 text-right text-[10px] font-bold font-mono bg-base-100 border border-base-300 rounded px-1 py-0.5 focus:outline-none focus:border-primary no-spinners"
              />
              <span className="text-[9px] opacity-50 truncate max-w-[3rem]">/ {unidadPrecio}</span>
            </div>
          )
        })()}
        {hasPres && (
          <p className="text-[9px] opacity-35 truncate">
            <CantidadConUnidad qty={item.cantidad * item.factor_conversion!} unidad={item.unidad_base} pluralUnidad={item.unidad_base_plural ?? undefined} />
          </p>
        )}
      </div>

      <button
        className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={() => onRemove(item.producto_id)}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

export function PedidoPanel({
  proveedor,
  items,
  itemsByProveedor,
  totalGeneral,
  solicitudId,
  isSaving,
  isGuardando,
  horizonteGlobal,
  popoverOpenId,
  monedaCodigo,
  onUpdateQty,
  onUpdatePrecio,
  onRemove,
  onGlobalHorizonteChange,
  onHorizonteChip,
  onResetHorizonteToGlobal,
  onPopoverToggle,
  onSaveBorrador,
  onGuardar,
}: PedidoPanelProps) {
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  return (
    <div className="flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative min-w-0 min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200 bg-primary/5 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 bg-primary text-primary-content rounded-xl shadow-md shrink-0">
              <ShoppingCart className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold leading-tight truncate">
                Pedido · {proveedor?.nombre ?? 'Multi-proveedor'}
              </h2>
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary/50">
                {items.length} {items.length === 1 ? 'producto' : 'productos'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {solicitudId && (
              <Badge className="bg-success/10 text-success border-success/20 px-2 py-0.5 text-[9px]">
                Guardado
              </Badge>
            )}
          </div>
        </div>

        {/* Chips de horizonte global */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold opacity-35 uppercase tracking-wider shrink-0">Cubrir:</span>
          <MetricTooltip
            size="sm"
            position="right"
            text="Horizonte de cobertura: período que se quiere cubrir con la compra. La cantidad sugerida = consumo diario × horizonte + stock seguridad − stock actual."
          />
          {HORIZONTE_CHIPS.map(d => (
            <button
              key={d}
              onClick={() => onGlobalHorizonteChange(d)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all",
                horizonteGlobal === d
                  ? "bg-primary text-primary-content border-primary shadow-sm"
                  : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
              )}
            >
              {horizonLabel(d)}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-0">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-25 p-8 gap-3">
            <div className="w-12 h-12 bg-base-200 rounded-full flex items-center justify-center">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-sm">Lista vacía</p>
              <p className="text-xs mt-0.5">Agrega desde las sugerencias o el buscador.</p>
            </div>
          </div>
        ) : itemsByProveedor.length <= 1 ? (
          /* Mono-proveedor: lista plana */
          <div className="space-y-1">
            {items.map(item => (
              <PedidoItem
                key={item.producto_id}
                item={item}
                horizonteGlobal={horizonteGlobal}
                popoverOpenId={popoverOpenId}
                onUpdateQty={onUpdateQty}
                onUpdatePrecio={onUpdatePrecio}
                onRemove={onRemove}
                onHorizonteChip={onHorizonteChip}
                onResetHorizonteToGlobal={onResetHorizonteToGlobal}
                onPopoverToggle={onPopoverToggle}
              />
            ))}
          </div>
        ) : (
          /* Multi-proveedor: grupos con subtotales */
          <div className="space-y-3">
            {itemsByProveedor.map(grupo => (
              <div key={grupo.proveedor_id} className="rounded-xl border border-base-200 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-base-200/60 text-[10px] font-bold">
                  <span className="truncate">{grupo.proveedor_nombre}</span>
                  <span className="font-mono opacity-60 shrink-0 ml-2">{fmt(grupo.subtotal)}</span>
                </div>
                <div className="space-y-1 p-1.5">
                  {grupo.items.map(item => (
                    <PedidoItem
                      key={item.producto_id}
                      item={item}
                      horizonteGlobal={horizonteGlobal}
                      popoverOpenId={popoverOpenId}
                      onUpdateQty={onUpdateQty}
                onUpdatePrecio={onUpdatePrecio}
                      onRemove={onRemove}
                      onHorizonteChip={onHorizonteChip}
                      onResetHorizonteToGlobal={onResetHorizonteToGlobal}
                      onPopoverToggle={onPopoverToggle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-base-200/50 border-t border-base-300 space-y-2.5 shrink-0">
        <div className="space-y-1">
          <div className="flex justify-between items-center text-[10px] opacity-50">
            <span className="uppercase tracking-widest font-bold">Subtotal neto</span>
            <span className="font-mono">{fmt(totalGeneral)}</span>
          </div>
          <div className="flex justify-between items-center text-[10px] opacity-50">
            <span className="uppercase tracking-widest font-bold">IVA (19%)</span>
            <span className="font-mono">{fmt(totalGeneral * 0.19)}</span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-base-300">
            <span className="opacity-40 uppercase tracking-widest text-[9px] font-bold">Total c/IVA</span>
            <span className="text-base font-black flex items-center gap-1.5">
              {fmt(totalGeneral * 1.19)}
              <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl h-9 text-xs font-medium px-3 opacity-50 hover:opacity-100 shrink-0"
            onClick={onSaveBorrador}
            disabled={items.length === 0 || isSaving}
            title="Guarda el progreso para continuar más tarde"
          >
            {isSaving ? <span className="loading loading-spinner loading-xs" /> : 'Pausar'}
          </Button>
          <Button
            className="rounded-xl h-9 font-bold gap-2 shadow-md shadow-primary/20 flex-1"
            disabled={items.length === 0 || isGuardando}
            onClick={onGuardar}
          >
            {isGuardando
              ? <span className="loading loading-spinner loading-sm" />
              : <><CheckCircle2 className="h-4 w-4" /> Finalizar solicitud</>
            }
          </Button>
        </div>
      </div>
    </div>
  )
}

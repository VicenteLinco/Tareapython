// frontend/src/pages/solicitudes-compra/components/pedido-panel.tsx
import { ShoppingCart, Plus, Minus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { cn, formatCantidad } from '@/lib/utils'
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
  proveedor: Proveedor
  items: SolicitudItem[]
  solicitudId: string | null
  isSaving: boolean
  isGuardando: boolean
  horizonteGlobal: number
  popoverOpenId: string | null
  monedaCodigo: string
  onUpdateQty: (pid: string, val: number) => void
  onRemove: (pid: string) => void
  onGlobalHorizonteChange: (dias: number) => void
  onHorizonteChip: (pid: string, dias: number) => void
  onResetHorizonteToGlobal: (pid: string) => void
  onPopoverToggle: (pid: string | null) => void
  onSaveBorrador: () => void
  onGuardar: () => void
}

export function PedidoPanel({
  proveedor,
  items,
  solicitudId,
  isSaving,
  isGuardando,
  horizonteGlobal,
  popoverOpenId,
  monedaCodigo,
  onUpdateQty,
  onRemove,
  onGlobalHorizonteChange,
  onHorizonteChip,
  onResetHorizonteToGlobal,
  onPopoverToggle,
  onSaveBorrador,
  onGuardar,
}: PedidoPanelProps) {
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)
  const totalEstimado = items.reduce((acc, i) => {
    const precio = i.presentacion_id && i.factor_conversion
      ? i.precio_unitario * i.factor_conversion
      : i.precio_unitario
    return acc + i.cantidad * precio
  }, 0)

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
                Pedido · {proveedor.nombre}
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
        ) : (
          items.map(item => {
            const diasCubiertos = calcularDiasCubiertos(item)
            const esPersonalizado = item.horizonte_personalizado === true
            const popoverAbierto = popoverOpenId === item.producto_id
            const hasPres = !!(item.presentacion_id && item.factor_conversion)

            return (
              <div
                key={item.producto_id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200/50 border border-transparent hover:border-primary/10 transition-all rounded-xl group"
              >
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

                <div className="text-right w-24 shrink-0">
                  {hasPres ? (
                    <>
                      <p className="text-[10px] font-bold font-mono truncate">
                        {item.precio_unitario > 0
                          ? `${fmt(item.precio_unitario * item.factor_conversion!)} / ${item.presentacion_nombre ?? 'pres.'}`
                          : <span className="opacity-30">—</span>
                        }
                      </p>
                      <p className="text-[9px] opacity-35 truncate">
                        {formatCantidad(item.cantidad * item.factor_conversion!, item.unidad_base, item.unidad_base_plural ?? undefined)}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] font-bold font-mono truncate">
                      {item.precio_unitario > 0
                        ? `${fmt(item.precio_unitario)} / ${item.unidad_base}`
                        : <span className="opacity-30">—</span>
                      }
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
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-base-200/50 border-t border-base-300 space-y-2.5 shrink-0">
        <div className="flex justify-between items-center">
          <span className="opacity-40 uppercase tracking-widest text-[9px] font-bold">Costo Estimado</span>
          <span className="text-base font-black flex items-center gap-1.5">
            {fmt(totalEstimado)}
            <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
          </span>
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

// frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx
import { Search, CheckCircle2, Plus } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { cn, formatCantidad } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { SolicitudBuscador } from './solicitud-buscador'
import type { ItemRecomendado, Proveedor, Producto, SolicitudItem } from '@/types'

type TabIzquierdo = 'quiebres' | 'buscar'

interface QuiebresPanelProps {
  proveedor: Proveedor
  recomendaciones: ItemRecomendado[]
  isLoadingRecs: boolean
  itemsEnPedido: SolicitudItem[]
  tab: TabIzquierdo
  monedaCodigo: string
  onTabChange: (t: TabIzquierdo) => void
  onAddFromRec: (r: ItemRecomendado) => void
  onAddFromSearch: (p: Producto) => void
}

export function QuiebresPanelIzquierdo({
  proveedor,
  recomendaciones,
  isLoadingRecs,
  itemsEnPedido,
  tab,
  monedaCodigo,
  onTabChange,
  onAddFromRec,
  onAddFromSearch,
}: QuiebresPanelProps) {
  const excluidos = itemsEnPedido.map(i => i.producto_id)

  return (
    <div className="flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm min-h-0">
      {/* Tab selector */}
      <div className="shrink-0 p-2.5 border-b border-base-200">
        <div className="flex bg-base-200/70 rounded-xl p-0.5 gap-0.5">
          <button
            onClick={() => onTabChange('buscar')}
            className={cn(
              "flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
              tab === 'buscar'
                ? "bg-base-100 text-base-content shadow-sm"
                : "text-base-content/40 hover:text-base-content/60"
            )}
          >
            <Search className="h-3 w-3" /> Buscar
          </button>

          {recomendaciones.length === 0 ? (
            <div className="flex-1 py-2 text-[11px] font-bold rounded-[10px] flex items-center justify-center gap-1.5 text-base-content/20 cursor-not-allowed select-none">
              <span>⚠</span> Sin quiebres
            </div>
          ) : (
            <button
              onClick={() => onTabChange('quiebres')}
              className={cn(
                "relative flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
                tab === 'quiebres'
                  ? "bg-warning/15 text-warning shadow-sm"
                  : "bg-warning/8 text-warning hover:bg-warning/20"
              )}
            >
              {tab !== 'quiebres' && (
                <span className="absolute inset-0 rounded-[10px] animate-ping bg-warning/20 pointer-events-none" />
              )}
              <span>⚠</span> Quiebres
              <span className={cn(
                "text-[9px] font-black min-w-[16px] h-4 flex items-center justify-center rounded-full px-1.5",
                tab === 'quiebres'
                  ? "bg-warning text-warning-content"
                  : "bg-warning text-warning-content animate-pulse"
              )}>
                {recomendaciones.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      {tab === 'buscar' ? (
        <div className="p-3 overflow-visible">
          <SolicitudBuscador
            proveedorId={proveedor.id}
            monedaCodigo={monedaCodigo}
            excluidos={excluidos}
            onAdd={onAddFromSearch}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar min-h-0">
          {isLoadingRecs ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : recomendaciones.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-6 gap-3">
              <div className="w-10 h-10 rounded-2xl bg-base-200 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 stroke-[1.5px]" />
              </div>
              <div>
                <p className="font-bold text-xs">¡Todo al día!</p>
                <p className="text-[10px] mt-0.5">Sin quiebres para {proveedor.nombre}.</p>
              </div>
            </div>
          ) : (
            recomendaciones.map(r => {
              const alreadyAdded = excluidos.includes(r.producto_id)
              const isCritica = r.nivel_urgencia === 'critica'
              const isAlta = r.nivel_urgencia === 'alta'
              const confianza = (r.confianza ?? 'baja') as 'alta' | 'media' | 'baja'
              const confianzaColor = confianza === 'alta' ? 'bg-success/15 text-success'
                                   : confianza === 'media' ? 'bg-warning/15 text-warning'
                                   : 'bg-base-300 text-base-content/60'
              const confianzaLabel = confianza === 'alta' ? '✓ datos sólidos'
                                   : confianza === 'media' ? '~ datos parciales'
                                   : '⚠ historial corto'
              const confianzaTooltip = confianza === 'alta'
                ? 'Predicción basada en historial sólido (≥30 días con consumo). La cantidad sugerida es confiable.'
                : confianza === 'media'
                ? 'Historial parcial (14–29 días). La cantidad sugerida es orientativa; se recomienda revisar.'
                : 'Historial insuficiente (<14 días con consumo). No se genera cantidad automática; ingresar manualmente.'
              const yaPedido = parseFloat(r.ya_pedido_unidades)
              const sugBase = parseFloat(r.cantidad_sugerida_base)
              const sugLabel = r.cantidad_sugerida_presentacion
                ? formatCantidad(
                    Math.ceil(parseFloat(r.cantidad_sugerida_presentacion)),
                    r.presentacion_nombre,
                    r.presentacion_nombre_plural ?? undefined
                  )
                : formatCantidad(Math.ceil(sugBase), r.unidad_base, r.unidad_base_plural ?? undefined)
              const unidadEnCamino = r.unidad_base_plural || r.unidad_base
              const cubierto = yaPedido > 0 && sugBase === 0

              return (
                <div
                  key={r.producto_id}
                  className={cn(
                    "relative flex flex-col gap-2 p-3 pl-4 rounded-2xl border transition-all overflow-hidden",
                    alreadyAdded
                      ? "opacity-40 bg-base-200/30 border-transparent"
                      : isCritica
                        ? "bg-error/5 border-error/20 hover:border-error/40"
                        : isAlta
                          ? "bg-warning/5 border-warning/20 hover:border-warning/40"
                          : "bg-base-100 border-base-200 hover:border-primary/30"
                  )}
                >
                  <div className={cn(
                    "absolute left-0 inset-y-0 w-[3px]",
                    isCritica ? 'bg-error' : isAlta ? 'bg-warning' : 'bg-primary/40'
                  )} />

                  <div className="flex items-start justify-between gap-1">
                    <p className="font-bold text-[11px] leading-snug line-clamp-2 flex-1 min-w-0">
                      {r.producto_nombre}
                    </p>
                    {!alreadyAdded && (isCritica || isAlta) && (
                      <span className={cn(
                        "shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full leading-tight",
                        isCritica ? "bg-error/15 text-error" : "bg-warning/15 text-warning"
                      )}>
                        {isCritica ? "crítico" : "alta"}
                      </span>
                    )}
                    {!alreadyAdded && (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <span
                          className={cn(
                            "text-[8px] font-medium px-1.5 py-0.5 rounded-full leading-tight",
                            confianzaColor
                          )}
                        >
                          {confianzaLabel}
                        </span>
                        <MetricTooltip size="sm" position="left" text={confianzaTooltip} />
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <p className={cn(
                      "text-[9px] font-medium tabular-nums",
                      parseFloat(r.stock_actual) === 0 ? "text-error font-bold" : "text-base-content/40"
                    )}>
                      Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_seguridad)}
                    </p>
                    {yaPedido === 0 && (
                      <p className="text-[9px] text-base-content/35 font-medium" title={r.razon ?? ''}>Sug: {sugLabel}</p>
                    )}
                  </div>

                  {yaPedido > 0 && (
                    <div className={cn(
                      "flex items-center gap-1.5 text-[9px] font-bold rounded-lg px-2 py-1",
                      cubierto
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-info/10 text-info border border-info/20"
                    )}>
                      <span>📦</span>
                      <span className="tabular-nums">{Math.round(yaPedido)} {unidadEnCamino} en camino</span>
                      <span className="ml-auto font-medium opacity-70 shrink-0">
                        {cubierto ? '✓ cubierto' : `+ ${sugLabel} sug.`}
                      </span>
                    </div>
                  )}

                  <button
                    className={cn(
                      "btn btn-xs w-full rounded-xl gap-1 text-[10px] font-bold transition-all",
                      alreadyAdded
                        ? "btn-ghost cursor-default text-success pointer-events-none"
                        : isCritica
                          ? "bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error"
                          : "btn-primary shadow-sm shadow-primary/20"
                    )}
                    onClick={() => !alreadyAdded && onAddFromRec(r)}
                    disabled={alreadyAdded}
                  >
                    {alreadyAdded
                      ? <><CheckCircle2 className="h-3 w-3" /> Agregado</>
                      : <><Plus className="h-3 w-3" /> Agregar</>
                    }
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

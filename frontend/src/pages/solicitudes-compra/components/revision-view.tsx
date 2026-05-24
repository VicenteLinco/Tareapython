// frontend/src/pages/solicitudes-compra/components/revision-view.tsx
import { useState } from 'react'
import { CheckCircle2, X, RotateCcw, ShoppingCart, Eye, EyeOff, Minus, Plus } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { cn, formatCantidad } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { UrgenciaTag } from '@/components/ui/urgencia-tag'
import { toDecimal, toNum } from '@/domain/parse'
import type { ItemRecomendado, SolicitudItem } from '@/types'

interface RevisionViewProps {
  recomendaciones: ItemRecomendado[]
  isLoading: boolean
  itemsEnPedido: SolicitudItem[]
  descartados: Set<string>
  onAceptarConCantidad: (r: ItemRecomendado, cantidad: number) => void
  onUpdateQty: (productoId: string, cantidad: number) => void
  onRemove: (productoId: string) => void
  onDescartar: (productoId: string) => void
  onRestaurar: (productoId: string) => void
  onCambiarAAvanzado: () => void
}

const URGENCIA_ORDER: Record<string, number> = { critica: 0, critico: 0, alta: 1, media: 2, baja: 3, normal: 4 }

const unitLabel = (qty: number, singular: string, plural?: string | null) =>
  formatCantidad(qty, singular, plural ?? undefined).replace(/^[\d.,\s]+/, '').trim()

export function RevisionView({
  recomendaciones,
  isLoading,
  itemsEnPedido,
  descartados,
  onAceptarConCantidad,
  onUpdateQty,
  onRemove,
  onDescartar,
  onRestaurar,
  onCambiarAAvanzado,
}: RevisionViewProps) {
  const [mostrarDescartados, setMostrarDescartados] = useState(false)
  const [cantidadesPendientes, setCantidadesPendientes] = useState<Record<string, string>>({})

  const aceptadosIds = new Set(itemsEnPedido.map(i => i.producto_id))

  const pendientesRaw = recomendaciones.filter(r => !aceptadosIds.has(r.producto_id) && !descartados.has(r.producto_id))
  const descartadosList = recomendaciones.filter(r => descartados.has(r.producto_id))
  const aceptados = recomendaciones.filter(r => aceptadosIds.has(r.producto_id))

  const pendientes = [...pendientesRaw].sort((a, b) => {
    const ua = URGENCIA_ORDER[a.nivel_urgencia] ?? 4
    const ub = URGENCIA_ORDER[b.nivel_urgencia] ?? 4
    if (ua !== ub) return ua - ub
    return (a.autonomia_dias ?? 999) - (b.autonomia_dias ?? 999)
  })

  const criticosPendientes = pendientes.filter(r =>
    (r.nivel_urgencia === 'critica' || r.nivel_urgencia === 'critico') && r.confianza !== 'baja'
  )

  const getCantidadInput = (r: ItemRecomendado): string => {
    if (r.producto_id in cantidadesPendientes) return cantidadesPendientes[r.producto_id]
    return r.confianza !== 'baja' ? String(toDecimal(r.cantidad_sugerida_base).ceil().toNumber()) : ''
  }

  const setCantidad = (productoId: string, val: string) =>
    setCantidadesPendientes(prev => ({ ...prev, [productoId]: val }))

  const handleAgregarAlPedido = (r: ItemRecomendado) => {
    const raw = getCantidadInput(r)
    const val = toNum(raw)
    if (val > 0) {
      onAceptarConCantidad(r, val)
      setCantidadesPendientes(prev => { const next = { ...prev }; delete next[r.producto_id]; return next })
    }
  }

  const handleAceptarCriticos = () => {
    for (const r of criticosPendientes) {
      const sugBase = toDecimal(r.cantidad_sugerida_base).ceil().toNumber()
      const cantInput = getCantidadInput(r)
      const val = toNum(cantInput)
      onAceptarConCantidad(r, val > 0 ? val : sugBase)
    }
  }

  const confianzaInfo = (c: string) => {
    if (c === 'alta') return { label: 'Alta', color: 'text-success bg-success/10', tooltip: 'Predicción basada en historial sólido (≥30 días). La cantidad sugerida es confiable.' }
    if (c === 'media') return { label: 'Media', color: 'text-warning bg-warning/10', tooltip: 'Historial parcial (14–29 días). Cantidad orientativa, se recomienda revisar.' }
    return { label: 'Baja', color: 'text-base-content/50 bg-base-200', tooltip: 'Historial insuficiente (<14 días). No se genera cantidad automática — debes ingresar la cantidad.' }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
      </div>
    )
  }

  if (recomendaciones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
        <CheckCircle2 className="h-10 w-10 stroke-[1.5px]" />
        <p className="font-bold">¡Todo al día!</p>
        <p className="text-sm">No hay recomendaciones pendientes.</p>
      </div>
    )
  }

  const renderFila = (r: ItemRecomendado, estado: 'pendiente' | 'aceptado' | 'descartado') => {
    const isCritica = r.nivel_urgencia === 'critica' || r.nivel_urgencia === 'critico'
    const isAlta = r.nivel_urgencia === 'alta'
    const stockActual = toNum(r.stock_actual)
    const stockMin = toNum(r.stock_seguridad)
    const consumoDiario = toNum(r.consumo_diario)
    const autonomia = r.autonomia_dias
    const cf = confianzaInfo(r.confianza ?? 'baja')

    const itemEnPedido = itemsEnPedido.find(i => i.producto_id === r.producto_id)
    const cantidadAceptada = itemEnPedido?.cantidad ?? 0

    const cantidadInput = getCantidadInput(r)
    const cantidadInputValida = toNum(cantidadInput) > 0

    return (
      <div
        key={r.producto_id}
        className={cn(
          'relative flex items-center gap-3 p-3 pl-4 rounded-2xl border transition-all',
          estado === 'aceptado' && 'opacity-60 bg-success/5 border-success/20',
          estado === 'descartado' && 'opacity-40 bg-base-200/30 border-transparent',
          estado === 'pendiente' && isCritica && 'bg-error/5 border-error/20',
          estado === 'pendiente' && isAlta && 'bg-warning/5 border-warning/20',
          estado === 'pendiente' && !isCritica && !isAlta && 'bg-base-100 border-base-200',
        )}
      >
        <div className={cn(
          'absolute left-0 inset-y-0 w-[3px] rounded-l-2xl',
          estado === 'aceptado' ? 'bg-success' :
          estado === 'descartado' ? 'bg-base-300' :
          isCritica ? 'bg-error' : isAlta ? 'bg-warning' : 'bg-primary/40'
        )} />

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="font-bold text-sm leading-tight">{r.producto_nombre}</span>
            {estado === 'pendiente' && (
              <UrgenciaTag valor={r.nivel_urgencia} size="sm" />
            )}
            {estado === 'aceptado' && (
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-success/15 text-success shrink-0">
                en pedido
              </span>
            )}
            {estado === 'descartado' && (
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-base-300 text-base-content/40 shrink-0">
                descartado
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-base-content/50">
            <span title="Stock actual / mínimo">
              Stock: <span className={cn('font-bold', stockActual <= 0 ? 'text-error' : stockActual < stockMin ? 'text-warning' : 'text-base-content/70')}>
                {stockActual}
              </span> / {stockMin} {unitLabel(stockMin, r.unidad_base, r.unidad_base_plural)}
            </span>
            {consumoDiario > 0 && (
              <span>Cons/día: <span className="font-bold text-base-content/70">{consumoDiario.toFixed(2)}</span></span>
            )}
            {autonomia !== null && autonomia !== undefined && (
              <span>Autonomía: <span className={cn('font-bold', autonomia <= 7 ? 'text-error' : autonomia <= 14 ? 'text-warning' : 'text-base-content/70')}>
                ~{Math.round(autonomia)} días
              </span></span>
            )}
            {r.proveedor_nombre && (
              <span className="text-primary/60">{r.proveedor_nombre}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0 self-start pt-0.5">
          <div className="flex items-center gap-1">
            {r.confianza !== 'baja' && (
              <span className="text-[10px] font-bold text-base-content/40">sugerido</span>
            )}
            <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', cf.color)}>{cf.label}</span>
            <MetricTooltip size="sm" position="left" text={cf.tooltip} />
          </div>

          {estado === 'pendiente' && (
            <div className="flex flex-col items-end gap-1 mt-0.5">
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  'flex items-center gap-1 rounded-xl px-1.5 py-0.5 transition-all',
                  r.confianza === 'baja' && !cantidadInputValida
                    ? 'bg-warning/8 border border-dashed border-warning/50'
                    : 'bg-base-200/60'
                )}>
                  <button
                    className="btn btn-ghost btn-xs p-0 h-5 w-5 min-h-0 rounded-lg"
                    onClick={() => {
                      const v = toNum(cantidadInput)
                      if (v > 1) setCantidad(r.producto_id, String(v - 1))
                    }}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <input
                    type="number"
                    className="input input-ghost w-14 h-6 text-center text-sm font-bold p-0 border-0 focus:outline-none bg-transparent"
                    placeholder={r.confianza === 'baja' ? '?' : '—'}
                    value={cantidadInput}
                    min={1}
                    onChange={e => setCantidad(r.producto_id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && cantidadInputValida) handleAgregarAlPedido(r)
                    }}
                  />
                  <button
                    className="btn btn-ghost btn-xs p-0 h-5 w-5 min-h-0 rounded-lg"
                    onClick={() => {
                      const v = toNum(cantidadInput)
                      setCantidad(r.producto_id, String(v + 1))
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <span className="text-[9px] text-base-content/40 ml-0.5">{unitLabel(toNum(cantidadInput), r.unidad_base, r.unidad_base_plural)}</span>
                </div>
                <button
                  className={cn(
                    'btn btn-xs rounded-xl gap-1 text-[10px] font-bold',
                    !cantidadInputValida && 'btn-disabled opacity-40',
                    cantidadInputValida && isCritica && 'bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error',
                    cantidadInputValida && !isCritica && 'btn-primary',
                  )}
                  disabled={!cantidadInputValida}
                  onClick={() => handleAgregarAlPedido(r)}
                >
                  <CheckCircle2 className="h-3 w-3" /> Agregar
                </button>
                <button
                  className="btn btn-xs btn-ghost rounded-xl text-base-content/40 hover:text-error"
                  title="Descartar recomendación"
                  onClick={() => onDescartar(r.producto_id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {r.confianza === 'baja' && !cantidadInputValida && (
                <p className="text-[9px] text-warning/80 font-medium">
                  Sin historial — ingresa la cantidad manualmente
                </p>
              )}
            </div>
          )}

          {estado === 'aceptado' && itemEnPedido && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex items-center gap-1 bg-success/10 rounded-xl px-1.5 py-0.5">
                <button
                  className="btn btn-ghost btn-xs p-0 h-5 w-5 min-h-0 rounded-lg"
                  onClick={() => {
                    if (cantidadAceptada > 1) onUpdateQty(r.producto_id, cantidadAceptada - 1)
                  }}
                >
                  <Minus className="h-3 w-3" />
                </button>
                <input
                  type="number"
                  className="input input-ghost w-14 h-6 text-center text-sm font-bold p-0 border-0 focus:outline-none bg-transparent"
                  value={cantidadAceptada}
                  min={1}
                  onChange={e => {
                    const v = toNum(e.target.value)
                    if (v > 0) onUpdateQty(r.producto_id, v)
                  }}
                />
                <button
                  className="btn btn-ghost btn-xs p-0 h-5 w-5 min-h-0 rounded-lg"
                  onClick={() => onUpdateQty(r.producto_id, cantidadAceptada + 1)}
                >
                  <Plus className="h-3 w-3" />
                </button>
                <span className="text-[9px] text-base-content/40 ml-0.5">{unitLabel(cantidadAceptada, r.unidad_base, r.unidad_base_plural)}</span>
              </div>
              <button
                className="btn btn-xs btn-ghost rounded-xl text-base-content/40 hover:text-error text-[10px] gap-1"
                onClick={() => onRemove(r.producto_id)}
              >
                <X className="h-3 w-3" /> Quitar
              </button>
            </div>
          )}

          {estado === 'descartado' && (
            <button
              className="btn btn-xs btn-ghost rounded-xl gap-1 text-[10px] opacity-60"
              onClick={() => onRestaurar(r.producto_id)}
            >
              <RotateCcw className="h-3 w-3" /> Restaurar
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold">
            {pendientes.length > 0
              ? `${pendientes.length} sugerencia${pendientes.length !== 1 ? 's' : ''} pendiente${pendientes.length !== 1 ? 's' : ''}`
              : aceptados.length > 0
                ? '¡Todo en pedido!'
                : 'Sin sugerencias'}
          </span>
          {aceptados.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
              <ShoppingCart className="h-3 w-3" /> {aceptados.length} en pedido
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {criticosPendientes.length > 0 && (
            <button
              className="btn btn-xs rounded-xl gap-1 text-[10px] bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error font-bold"
              onClick={handleAceptarCriticos}
            >
              <CheckCircle2 className="h-3 w-3" />
              Agregar {criticosPendientes.length} crítico{criticosPendientes.length !== 1 ? 's' : ''}
            </button>
          )}
          {descartadosList.length > 0 && (
            <button
              className="btn btn-xs btn-ghost rounded-xl gap-1 text-[10px] opacity-60"
              onClick={() => setMostrarDescartados(v => !v)}
            >
              {mostrarDescartados ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {descartadosList.length} descartados
            </button>
          )}
          <button
            className="btn btn-xs btn-ghost rounded-xl gap-1 text-[10px] text-primary"
            onClick={onCambiarAAvanzado}
          >
            Armar por proveedor →
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {pendientes.length === 0 && aceptados.length > 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 opacity-50">
            <CheckCircle2 className="h-8 w-8 stroke-[1.5px] text-success" />
            <p className="text-sm font-bold text-success">¡Todo en pedido!</p>
            <p className="text-xs">Revisaste todas las sugerencias.</p>
          </div>
        )}
        {pendientes.map(r => renderFila(r, 'pendiente'))}
      </div>

      {aceptados.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-30 mb-2">En pedido</p>
          <div className="space-y-1.5">
            {aceptados.map(r => renderFila(r, 'aceptado'))}
          </div>
        </div>
      )}

      {mostrarDescartados && descartadosList.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-30 mb-2">Descartados</p>
          <div className="space-y-1.5">
            {descartadosList.map(r => renderFila(r, 'descartado'))}
          </div>
        </div>
      )}
    </div>
  )
}

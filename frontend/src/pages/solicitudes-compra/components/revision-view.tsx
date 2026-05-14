// frontend/src/pages/solicitudes-compra/components/revision-view.tsx
import { useState } from 'react'
import { CheckCircle2, X, Pencil, RotateCcw, ShoppingCart, Eye, EyeOff } from 'lucide-react'
import { MetricTooltip } from '@/components/ui/metric-tooltip'
import { cn, formatCantidad } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { ItemRecomendado, SolicitudItem } from '@/types'

interface RevisionViewProps {
  recomendaciones: ItemRecomendado[]
  isLoading: boolean
  itemsEnPedido: SolicitudItem[]
  descartados: Set<string>
  horizonteGlobal: number
  onAceptar: (r: ItemRecomendado) => void
  onAceptarConCantidad: (r: ItemRecomendado, cantidad: number) => void
  onDescartar: (productoId: string) => void
  onRestaurar: (productoId: string) => void
  onCambiarAAvanzado: () => void
}

export function RevisionView({
  recomendaciones,
  isLoading,
  itemsEnPedido,
  descartados,
  onAceptar,
  onAceptarConCantidad,
  onDescartar,
  onRestaurar,
  onCambiarAAvanzado,
}: RevisionViewProps) {
  const [mostrarDescartados, setMostrarDescartados] = useState(false)
  const [ajustandoId, setAjustandoId] = useState<string | null>(null)
  const [ajusteValor, setAjusteValor] = useState('')

  const aceptadosIds = new Set(itemsEnPedido.map(i => i.producto_id))

  const pendientes = recomendaciones.filter(r => !aceptadosIds.has(r.producto_id) && !descartados.has(r.producto_id))
  const descartadosList = recomendaciones.filter(r => descartados.has(r.producto_id))
  const aceptados = recomendaciones.filter(r => aceptadosIds.has(r.producto_id))

  const handleAjusteConfirmar = (r: ItemRecomendado) => {
    const val = parseFloat(ajusteValor)
    if (!isNaN(val) && val > 0) {
      onAceptarConCantidad(r, val)
    }
    setAjustandoId(null)
    setAjusteValor('')
  }

  const confianzaInfo = (c: string) => {
    if (c === 'alta') return { label: 'Alta', color: 'text-success bg-success/10', tooltip: 'Predicción basada en historial sólido (≥30 días). La cantidad sugerida es confiable.' }
    if (c === 'media') return { label: 'Media', color: 'text-warning bg-warning/10', tooltip: 'Historial parcial (14–29 días). Cantidad orientativa, se recomienda revisar.' }
    return { label: 'Baja', color: 'text-base-content/50 bg-base-200', tooltip: 'Historial insuficiente (<14 días). No se genera cantidad automática.' }
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
    const isCritica = r.nivel_urgencia === 'critica'
    const isAlta = r.nivel_urgencia === 'alta'
    const stockActual = parseFloat(r.stock_actual)
    const stockMin = parseFloat(r.stock_seguridad)
    const consumoDiario = parseFloat(r.consumo_diario)
    const autonomia = r.autonomia_dias
    const sugBase = parseFloat(r.cantidad_sugerida_base)
    const sugLabel = r.cantidad_sugerida_presentacion && r.presentacion_nombre
      ? formatCantidad(
          Math.ceil(parseFloat(r.cantidad_sugerida_presentacion)),
          r.presentacion_nombre,
          r.presentacion_nombre_plural ?? undefined
        )
      : formatCantidad(Math.ceil(sugBase), r.unidad_base, r.unidad_base_plural ?? undefined)
    const cf = confianzaInfo(r.confianza ?? 'baja')
    const estaAjustando = ajustandoId === r.producto_id

    return (
      <div
        key={r.producto_id}
        className={cn(
          'relative flex items-start gap-3 p-3 pl-4 rounded-2xl border transition-all',
          estado === 'aceptado' && 'opacity-50 bg-success/5 border-success/20',
          estado === 'descartado' && 'opacity-40 bg-base-200/30 border-transparent',
          estado === 'pendiente' && isCritica && 'bg-error/5 border-error/20',
          estado === 'pendiente' && isAlta && 'bg-warning/5 border-warning/20',
          estado === 'pendiente' && !isCritica && !isAlta && 'bg-base-100 border-base-200',
        )}
      >
        {/* Barra de urgencia */}
        <div className={cn(
          'absolute left-0 inset-y-0 w-[3px] rounded-l-2xl',
          estado === 'aceptado' ? 'bg-success' :
          estado === 'descartado' ? 'bg-base-300' :
          isCritica ? 'bg-error' : isAlta ? 'bg-warning' : 'bg-primary/40'
        )} />

        {/* Nombre + datos */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="font-bold text-sm leading-tight">{r.producto_nombre}</span>
            {estado === 'pendiente' && (isCritica || isAlta) && (
              <span className={cn(
                'text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full shrink-0',
                isCritica ? 'bg-error/15 text-error' : 'bg-warning/15 text-warning'
              )}>
                {isCritica ? 'crítico' : 'alta'}
              </span>
            )}
            {estado === 'aceptado' && (
              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-success/15 text-success shrink-0">
                aceptado
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
              </span> / {stockMin} {r.unidad_base}
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

          {/* Ajuste inline */}
          {estaAjustando && (
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="number"
                className="input input-xs input-bordered w-24 rounded-xl text-sm"
                placeholder={String(Math.ceil(sugBase))}
                value={ajusteValor}
                onChange={e => setAjusteValor(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAjusteConfirmar(r)
                  if (e.key === 'Escape') { setAjustandoId(null); setAjusteValor('') }
                }}
                autoFocus
              />
              <span className="text-[10px] text-base-content/40">{r.unidad_base}</span>
              <button
                className="btn btn-xs btn-success rounded-xl"
                onClick={() => handleAjusteConfirmar(r)}
              >
                Confirmar
              </button>
              <button
                className="btn btn-xs btn-ghost rounded-xl"
                onClick={() => { setAjustandoId(null); setAjusteValor('') }}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>

        {/* Columna derecha: sugerido + confianza + acciones */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {!estaAjustando && r.confianza !== 'baja' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-base-content/60">{sugLabel}</span>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', cf.color)}>{cf.label}</span>
              <MetricTooltip size="sm" position="left" text={cf.tooltip} />
            </div>
          )}
          {!estaAjustando && r.confianza === 'baja' && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] opacity-40">cantidad manual</span>
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', cf.color)}>{cf.label}</span>
              <MetricTooltip size="sm" position="left" text={cf.tooltip} />
            </div>
          )}

          {estado === 'pendiente' && !estaAjustando && (
            <div className="flex items-center gap-1 mt-0.5">
              <button
                className={cn(
                  'btn btn-xs rounded-xl gap-1 text-[10px] font-bold',
                  isCritica
                    ? 'bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error'
                    : 'btn-primary'
                )}
                onClick={() => onAceptar(r)}
              >
                <CheckCircle2 className="h-3 w-3" /> Aceptar
              </button>
              <button
                className="btn btn-xs btn-ghost rounded-xl gap-1 text-[10px]"
                title="Ajustar cantidad"
                onClick={() => {
                  setAjustandoId(r.producto_id)
                  setAjusteValor(r.confianza !== 'baja' ? String(Math.ceil(sugBase)) : '')
                }}
              >
                <Pencil className="h-3 w-3" /> Ajustar
              </button>
              <button
                className="btn btn-xs btn-ghost rounded-xl text-base-content/40 hover:text-error"
                title="Descartar recomendación"
                onClick={() => onDescartar(r.producto_id)}
              >
                <X className="h-3 w-3" />
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
      {/* Header de revisión */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold">
            {pendientes.length > 0
              ? `${pendientes.length} recomendación${pendientes.length !== 1 ? 'es' : ''} pendiente${pendientes.length !== 1 ? 's' : ''}`
              : aceptados.length > 0
                ? '¡Revisión completa!'
                : 'Sin pendientes'}
          </span>
          {aceptados.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
              <ShoppingCart className="h-3 w-3" /> {aceptados.length} en pedido
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
            Vista avanzada →
          </button>
        </div>
      </div>

      {/* Lista pendientes */}
      <div className="space-y-2">
        {pendientes.length === 0 && aceptados.length > 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 opacity-50">
            <CheckCircle2 className="h-8 w-8 stroke-[1.5px] text-success" />
            <p className="text-sm font-bold text-success">Revisión completa</p>
            <p className="text-xs">Todos los ítems fueron aceptados o descartados.</p>
          </div>
        )}
        {pendientes.map(r => renderFila(r, 'pendiente'))}
      </div>

      {/* Aceptados */}
      {aceptados.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-30 mb-2">Aceptados</p>
          <div className="space-y-1.5">
            {aceptados.map(r => renderFila(r, 'aceptado'))}
          </div>
        </div>
      )}

      {/* Descartados */}
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

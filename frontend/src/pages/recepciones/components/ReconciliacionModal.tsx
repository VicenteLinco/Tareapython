import { cn, formatStockHumano, formatCantidad } from '@/lib/utils'
import type { DetalleLineUI } from './item-card'

interface SolicitudItemSimple {
  producto_id: string
  producto_nombre: string
  cantidad_base: number
  unidad: string
  unidad_plural?: string | null
  presentacion_id?: number | null
  presentacion_nombre?: string | null
  presentacion_nombre_plural?: string | null
  factor_conversion?: number | null
  cantidad_presentaciones?: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  solicitudItems: SolicitudItemSimple[]
  detalles: DetalleLineUI[]
  onConfirmar: (payload: unknown) => void
  pendingPayload: unknown | null
  nota: string
  onNotaChange: (nota: string) => void
}

type EstadoReconciliacion = 'ok' | 'faltante' | 'no_recibido' | 'sobrante' | 'extra'

export function ReconciliacionModal({
  open,
  onClose,
  solicitudItems,
  detalles,
  onConfirmar,
  pendingPayload,
  nota,
  onNotaChange,
}: Props) {
  if (!open || !pendingPayload) return null

  const recibidoMap: Record<string, number> = {}
  const recibidoNombreMap: Record<string, string> = {}
  detalles.forEach(d => {
    const total = d.lotes.reduce((s, l) => s + (l.cantidad_presentacion * d.factor_conversion), 0)
    recibidoMap[d.producto_id] = (recibidoMap[d.producto_id] ?? 0) + total
    recibidoNombreMap[d.producto_id] = d.producto_nombre
  })

  const solicitadosSet = new Set(solicitudItems.map(si => si.producto_id))
  const filasSolicitadas = solicitudItems.map(si => {
    const recibido = recibidoMap[si.producto_id] ?? 0
    const estado: EstadoReconciliacion =
      recibido === 0 ? 'no_recibido' :
      recibido < si.cantidad_base ? 'faltante' :
      recibido > si.cantidad_base ? 'sobrante' :
      'ok'
    return { ...si, recibido, estado }
  })

  const filasExtra = Object.entries(recibidoMap)
    .filter(([productoId]) => !solicitadosSet.has(productoId))
    .map(([productoId, recibido]) => {
      const d = detalles.find(det => det.producto_id === productoId)
      return {
        producto_id: productoId,
        producto_nombre: recibidoNombreMap[productoId] ?? 'Producto no solicitado',
        cantidad_base: 0,
        unidad: d?.unidad_base_nombre ?? 'no solicitado',
        unidad_plural: d?.unidad_base_nombre_plural ?? null,
        presentacion_id: d?.presentacion_id ?? null,
        presentacion_nombre: d?.presentacion_nombre ?? null,
        presentacion_nombre_plural: d?.presentacion_nombre_plural ?? null,
        factor_conversion: d?.factor_conversion ?? 1,
        cantidad_presentaciones: null,
        recibido,
        estado: 'extra' as EstadoReconciliacion,
      }
    })

  const filas = [...filasSolicitadas, ...filasExtra]
  const requiereNota = filas.some(f => f.estado !== 'ok')
  const tieneFaltantes = filas.some(f => f.estado === 'faltante' || f.estado === 'no_recibido')

  const estadoClass = (estado: EstadoReconciliacion) =>
    estado === 'ok' ? 'bg-success/5 border-success/20' :
    estado === 'sobrante' ? 'bg-info/5 border-info/30' :
    estado === 'extra' ? 'bg-warning/5 border-warning/30' :
    'bg-error/5 border-error/30'

  const estadoLabel = (estado: EstadoReconciliacion) =>
    estado === 'ok' ? 'OK' :
    estado === 'faltante' ? 'Faltante' :
    estado === 'no_recibido' ? 'No recibido' :
    estado === 'sobrante' ? 'Sobrante' :
    'Extra'

  const formatFilaQty = (total: number, item: typeof filas[0]) => {
    const factor = item.factor_conversion ?? 1
    const uBase = item.unidad || 'unidad'
    const uBasePlural = item.unidad_plural || (uBase === 'unidad' ? 'unidades' : uBase)
    const uPres = item.presentacion_nombre || ''
    const uPresPlural = item.presentacion_nombre_plural || uPres

    if (item.presentacion_id && factor > 1) {
      const presText = formatStockHumano(total, factor, uBase, uBasePlural, uPres, uPresPlural)
      return `${presText} (${total} ${total === 1 ? uBase : uBasePlural})`
    }
    return formatCantidad(total, uBase, uBasePlural)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-base-100 rounded-3xl shadow-2xl w-full max-w-2xl border border-base-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-base-200">
          <h2 className="font-bold text-base">Comparar con solicitud vinculada</h2>
          <p className="text-xs opacity-50 mt-0.5">
            Revisa faltantes, sobrantes e items extra antes de confirmar la recepcion.
          </p>
        </div>

        <div className="px-6 py-4 space-y-2 max-h-80 overflow-y-auto">
          {filas.map(f => (
            <div
              key={f.producto_id}
              className={cn('flex items-center gap-3 px-3 py-2 rounded-xl border', estadoClass(f.estado))}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{f.producto_nombre}</p>
                <p className="text-[10px] opacity-40">
                  {f.presentacion_id && (f.factor_conversion ?? 1) > 1
                    ? `${f.presentacion_nombre} (factor: ${f.factor_conversion})`
                    : f.unidad}
                </p>
              </div>
              <div className="text-right text-xs tabular-nums flex flex-col items-end gap-0.5">
                <span className="opacity-50">Pedido: {formatFilaQty(f.cantidad_base, f)}</span>
                <span className="font-bold">Llegó: {formatFilaQty(f.recibido, f)}</span>
              </div>
              <span className="text-[9px] font-black bg-base-100/70 px-1.5 py-0.5 rounded-full shrink-0">
                {estadoLabel(f.estado)}
              </span>
            </div>
          ))}
        </div>

        {requiereNota && (
          <div className="px-6 pb-2">
            <p className="text-xs font-bold text-warning mb-1">
              Hay diferencias con la solicitud. Explica el motivo:
            </p>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full text-xs rounded-xl"
              placeholder="Ej: proveedor entrego menos unidades, se acepta sobrante, o llegaron items extra..."
              rows={2}
              value={nota}
              onChange={e => onNotaChange(e.target.value)}
            />
            {tieneFaltantes && (
              <p className="text-[11px] opacity-60 mt-1">
                Si faltan items, la solicitud quedara como recepcion parcial y no se cerrara.
              </p>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t border-base-200 flex gap-2">
          <button className="btn btn-ghost btn-sm flex-1 rounded-xl" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary btn-sm flex-1 rounded-xl"
            disabled={requiereNota && !nota.trim()}
            onClick={() => onConfirmar(pendingPayload)}
          >
            Confirmar recepcion
          </button>
        </div>
      </div>
    </div>
  )
}

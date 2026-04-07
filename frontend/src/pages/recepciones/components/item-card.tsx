// frontend/src/pages/recepciones/components/item-card.tsx
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductoImage } from '@/components/ui/producto-image'
import { formatCantidad } from '@/lib/utils'
import type { Area, Presentacion } from '@/types'

export interface DetalleLineUI {
  id: string
  producto_id: string
  producto_nombre: string
  codigo_interno: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  cantidad_presentacion: number
  cantidad_solicitada?: number | null   // hint desde solicitud vinculada
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  codigo_lote: string
  fecha_vencimiento: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
  precio_unitario: string
  imagen_url?: string | null
  incluir_etiqueta: boolean
  cantidad_etiquetas: number
}

interface Props {
  detalle: DetalleLineUI
  areas: Area[]
  onChange: (id: string, patch: Partial<DetalleLineUI>) => void
  onRemove: (id: string) => void
  monedaSimbolo?: string
}

function isComplete(d: DetalleLineUI): boolean {
  return !!(d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
}

export function ReceptionItemCard({ detalle: d, areas, onChange, onRemove, monedaSimbolo = '$' }: Props) {
  const complete = isComplete(d)

  const unidadNombre = d.cantidad_presentacion === 1
    ? (d.presentacion_nombre || d.unidad_base_nombre)
    : (d.presentacion_nombre_plural || d.unidad_base_nombre_plural || d.presentacion_nombre || d.unidad_base_nombre)

  const baseEquiv = d.presentacion_id && d.factor_conversion > 1
    ? formatCantidad(
        d.cantidad_presentacion * d.factor_conversion,
        d.unidad_base_nombre,
        d.unidad_base_nombre_plural
      )
    : null

  return (
    <div className={`card bg-base-100 border p-4 transition-colors ${
      complete ? 'border-success/40' : 'border-warning/40'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <ProductoImage src={d.imagen_url} size="md" className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{d.producto_nombre}</p>
          {d.codigo_interno && (
            <p className="text-xs opacity-50 font-mono truncate">{d.codigo_interno}</p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {d.area_destino_id ? (
              <span className="badge badge-sm badge-ghost">{d.area_destino_nombre}</span>
            ) : (
              <select
                className="select select-bordered select-xs select-warning"
                value=""
                onChange={e => {
                  const aid = Number(e.target.value)
                  if (!aid) return
                  const nombre = areas.find(a => a.id === aid)?.nombre ?? ''
                  onChange(d.id, { area_destino_id: aid, area_destino_nombre: nombre })
                }}
              >
                <option value="">⚠ Asignar área…</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            )}
            <span className={`badge badge-xs ${complete ? 'badge-success' : 'badge-warning'}`}>
              {complete ? '✓ Completo' : '⚠ Incompleto'}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onRemove(d.id)}>
          <Trash2 className="h-4 w-4 text-error" />
        </Button>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Lote</span></label>
          <input
            className={`input input-sm input-bordered w-full font-mono ${!d.codigo_lote ? 'input-warning' : ''}`}
            placeholder="Nº lote"
            value={d.codigo_lote}
            onChange={e => onChange(d.id, { codigo_lote: e.target.value })}
          />
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Vencimiento</span></label>
          <input
            type="date"
            className={`input input-sm input-bordered w-full ${!d.fecha_vencimiento ? 'input-warning' : ''}`}
            value={d.fecha_vencimiento}
            onChange={e => onChange(d.id, { fecha_vencimiento: e.target.value })}
          />
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Cantidad</span></label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              className="input input-sm input-bordered w-16"
              value={d.cantidad_presentacion}
              onChange={e => onChange(d.id, { cantidad_presentacion: Number(e.target.value) || 1 })}
            />
            {d.presentaciones.length > 1 ? (
              <select
                className="select select-bordered select-xs flex-1"
                value={d.presentacion_id ?? ''}
                onChange={e => {
                  const pid = Number(e.target.value)
                  const pres = d.presentaciones.find(p => p.id === pid)
                  if (!pres) return
                  onChange(d.id, {
                    presentacion_id: pres.id,
                    presentacion_nombre: pres.nombre,
                    presentacion_nombre_plural: pres.nombre_plural ?? '',
                    factor_conversion: Number(pres.factor_conversion),
                  })
                }}
              >
                {d.presentaciones.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs opacity-50 truncate">{unidadNombre}</span>
            )}
          </div>
          {d.cantidad_solicitada != null && (
            <p className="text-xs text-info mt-0.5">
              Pedido: {formatCantidad(d.cantidad_solicitada, d.presentacion_nombre || d.unidad_base_nombre, d.presentacion_nombre_plural || d.unidad_base_nombre_plural)}
            </p>
          )}
          {baseEquiv && (
            <p className="text-xs opacity-40 mt-0.5">= {baseEquiv}</p>
          )}
        </div>
        <div>
          <label className="label py-0"><span className="label-text text-xs opacity-60">Precio unit.</span></label>
          <input
            type="number"
            className="input input-sm input-bordered w-full"
            placeholder={`${monedaSimbolo}0`}
            value={d.precio_unitario}
            onChange={e => onChange(d.id, { precio_unitario: e.target.value })}
          />
        </div>
      </div>

      {/* Etiqueta toggle */}
      {complete && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-base-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={d.incluir_etiqueta}
              onChange={e => onChange(d.id, { incluir_etiqueta: e.target.checked })}
            />
            <span className="text-xs">🏷️ Imprimir etiqueta</span>
          </label>
          {d.incluir_etiqueta && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs opacity-50">Cant.:</span>
              <input
                type="number"
                min={1}
                max={99}
                className="input input-xs input-bordered w-14 text-center"
                value={d.cantidad_etiquetas}
                onChange={e => onChange(d.id, { cantidad_etiquetas: Math.max(1, Number(e.target.value)) })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

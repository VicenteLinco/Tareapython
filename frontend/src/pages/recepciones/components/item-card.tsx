// frontend/src/pages/recepciones/components/item-card.tsx
import { useState } from 'react'
import { Trash2, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductoImage } from '@/components/ui/producto-image'
import { formatCantidad } from '@/lib/utils'
import type { Area, Presentacion } from '@/types'

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface LoteLineUI {
  id: string
  codigo_lote: string
  fecha_vencimiento: string
  cantidad_presentacion: number
  incluir_etiqueta: boolean
  cantidad_etiquetas: number
}

export interface DetalleLineUI {
  id: string
  producto_id: string
  producto_nombre: string
  codigo_interno: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
  precio_unitario: string
  imagen_url?: string | null
  cantidad_solicitada?: number | null
  lotes: LoteLineUI[]
  collapsed: boolean
}

interface Props {
  detalle: DetalleLineUI
  areas: Area[]
  onChange: (id: string, patch: Partial<Omit<DetalleLineUI, 'lotes'>>) => void
  onChangeLote: (detalleId: string, loteId: string, patch: Partial<LoteLineUI>) => void
  onAddLote: (detalleId: string) => void
  onRemoveLote: (detalleId: string, loteId: string) => void
  onRemove: (id: string) => void
  monedaSimbolo?: string
}

// ─── Helpers exportados ───────────────────────────────────────────────────────

export function isLoteComplete(l: LoteLineUI): boolean {
  return !!(l.codigo_lote && l.fecha_vencimiento)
}

export function isCardComplete(d: DetalleLineUI): boolean {
  return !!(d.area_destino_id && d.lotes.length > 0 && d.lotes.every(isLoteComplete))
}

function formatPrecioDisplay(raw: string, simbolo: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return `${simbolo}${Number(digits).toLocaleString('es-CL')}`
}

// ─── Sub-componente: fila de lote ─────────────────────────────────────────────

interface LoteRowProps {
  lote: LoteLineUI
  index: number
  presentacion_nombre: string
  presentacion_nombre_plural: string
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  canDelete: boolean
  onChange: (patch: Partial<LoteLineUI>) => void
  onDelete: () => void
}

function LoteRow({
  lote,
  index,
  presentacion_nombre,
  presentacion_nombre_plural,
  unidad_base_nombre,
  unidad_base_nombre_plural,
  canDelete,
  onChange,
  onDelete,
}: LoteRowProps) {
  const unitLabel = lote.cantidad_presentacion === 1
    ? (presentacion_nombre || unidad_base_nombre)
    : (presentacion_nombre_plural || unidad_base_nombre_plural || presentacion_nombre || unidad_base_nombre)

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs opacity-30 w-4 text-right shrink-0">{index + 1}</span>
      <input
        className={`input input-sm input-bordered w-28 font-mono ${!lote.codigo_lote ? 'input-warning' : ''}`}
        placeholder="Nº lote"
        value={lote.codigo_lote}
        onChange={e => onChange({ codigo_lote: e.target.value })}
      />
      <input
        type="date"
        className={`input input-sm input-bordered flex-1 ${!lote.fecha_vencimiento ? 'input-warning' : ''}`}
        value={lote.fecha_vencimiento}
        onChange={e => onChange({ fecha_vencimiento: e.target.value })}
      />
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          min={1}
          className="input input-sm input-bordered w-16"
          value={lote.cantidad_presentacion}
          onChange={e => onChange({ cantidad_presentacion: Number(e.target.value) || 1 })}
        />
        <span className="text-xs opacity-50 w-14 truncate">{unitLabel}</span>
      </div>
      {canDelete ? (
        <button className="btn btn-ghost btn-xs btn-circle shrink-0" onClick={onDelete}>
          <Trash2 className="h-3 w-3 text-error" />
        </button>
      ) : (
        <div className="w-6 shrink-0" />
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ReceptionItemCard({
  detalle: d,
  areas,
  onChange,
  onChangeLote,
  onAddLote,
  onRemoveLote,
  onRemove,
  monedaSimbolo = '$',
}: Props) {
  const [precioFocus, setPrecioFocus] = useState(false)

  const complete = isCardComplete(d)
  const totalCantidad = d.lotes.reduce((s, l) => s + l.cantidad_presentacion, 0)
  const rawPrecio = d.precio_unitario.replace(/\D/g, '')

  const unidadResumen = formatCantidad(
    totalCantidad,
    d.presentacion_nombre || d.unidad_base_nombre,
    d.presentacion_nombre_plural || d.unidad_base_nombre_plural
  )

  return (
    <div className={`card bg-base-100 border transition-colors ${
      complete ? 'border-success/40' : 'border-warning/40'
    }`}>

      {/* ── Header (siempre visible) ── */}
      <div className="flex items-center gap-3 p-4">
        <ProductoImage src={d.imagen_url} size="md" className="shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{d.producto_nombre}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {d.codigo_interno && (
              <span className="text-xs opacity-50 font-mono">{d.codigo_interno}</span>
            )}
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
          </div>
          {/* Resumen colapsado */}
          {d.collapsed && (
            <p className="text-xs opacity-50 mt-0.5">
              {d.lotes.length === 1 ? '1 lote' : `${d.lotes.length} lotes`}
              {' · '}{unidadResumen}
              {rawPrecio ? ` · ${formatPrecioDisplay(rawPrecio, monedaSimbolo)}` : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className={`badge badge-xs ${complete ? 'badge-success' : 'badge-warning'}`}>
            {complete ? '✓ Listo' : '⚠'}
          </span>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => onChange(d.id, { collapsed: !d.collapsed })}
            aria-label={d.collapsed ? 'Expandir' : 'Colapsar'}
          >
            {d.collapsed
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronUp className="h-4 w-4" />
            }
          </button>
          <Button variant="ghost" size="sm" onClick={() => onRemove(d.id)}>
            <Trash2 className="h-4 w-4 text-error" />
          </Button>
        </div>
      </div>

      {/* ── Contenido expandido ── */}
      {!d.collapsed && (
        <div className="border-t border-base-200 px-4 py-3 space-y-3">

          {/* Selector de presentación compartido (solo si hay más de una) */}
          {d.presentaciones.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs opacity-60 shrink-0">Presentación:</label>
              <select
                className="select select-bordered select-xs"
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
            </div>
          )}

          {/* Hint de cantidad solicitada */}
          {d.cantidad_solicitada != null && (
            <p className="text-xs text-info">
              Pedido: {formatCantidad(
                d.cantidad_solicitada,
                d.presentacion_nombre || d.unidad_base_nombre,
                d.presentacion_nombre_plural || d.unidad_base_nombre_plural
              )}
            </p>
          )}

          {/* Cabecera de columnas */}
          <div className="flex items-center gap-2 text-xs opacity-40 pb-0.5">
            <span className="w-4" />
            <span className="w-28">Lote</span>
            <span className="flex-1">Vencimiento</span>
            <span className="w-[88px]">Cantidad</span>
            <span className="w-6" />
          </div>

          {/* Filas de lotes */}
          <div className="space-y-2">
            {d.lotes.map((l, i) => (
              <LoteRow
                key={l.id}
                lote={l}
                index={i}
                presentacion_nombre={d.presentacion_nombre}
                presentacion_nombre_plural={d.presentacion_nombre_plural}
                unidad_base_nombre={d.unidad_base_nombre}
                unidad_base_nombre_plural={d.unidad_base_nombre_plural}
                canDelete={d.lotes.length > 1}
                onChange={patch => onChangeLote(d.id, l.id, patch)}
                onDelete={() => onRemoveLote(d.id, l.id)}
              />
            ))}
          </div>

          {/* Agregar lote */}
          <button
            className="btn btn-sm btn-ghost btn-outline w-full border-dashed text-xs gap-1"
            onClick={() => onAddLote(d.id)}
          >
            <Plus className="h-3 w-3" />
            Agregar lote distinto
          </button>

          {/* Precio unitario */}
          <div className="flex items-center gap-2 pt-2 border-t border-base-200">
            <label className="text-xs opacity-60 shrink-0">Precio unit.:</label>
            <input
              type="text"
              inputMode="numeric"
              className="input input-sm input-bordered w-36"
              placeholder={`${monedaSimbolo}0`}
              value={precioFocus
                ? rawPrecio
                : rawPrecio ? formatPrecioDisplay(rawPrecio, monedaSimbolo) : ''
              }
              onFocus={() => setPrecioFocus(true)}
              onBlur={() => setPrecioFocus(false)}
              onChange={e => onChange(d.id, { precio_unitario: e.target.value.replace(/\D/g, '') })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

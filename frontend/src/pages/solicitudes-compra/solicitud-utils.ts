// frontend/src/pages/solicitudes-compra/solicitud-utils.ts
import { formatCantidad } from '@/lib/utils'
import type { SolicitudItem } from '@/types'
import api from '@/lib/api'
import Decimal from 'decimal.js'

export const HORIZONTE_CHIPS = [7, 15, 30, 90, 180, 365] as const
export type HorizonChip = typeof HORIZONTE_CHIPS[number]

/** Calcula unidades a pedir dado un horizonte de cobertura. */
export function calcularCantidad(
  horizonte: number,
  consumoDiario: number,
  leadTime: number,
  stockMinimo: number,
  stockActual: number,
  factorConversion?: number | null,
): number {
  const base = Decimal.max(
    1,
    new Decimal(stockMinimo)
      .plus(new Decimal(consumoDiario).times(leadTime + horizonte))
      .minus(stockActual)
      .ceil(),
  )
  if (factorConversion && factorConversion > 0) {
    return Decimal.max(1, base.dividedBy(factorConversion).ceil()).toNumber()
  }
  return base.toNumber()
}

/** Días de stock cubiertos con la cantidad actual del ítem. */
export function calcularDiasCubiertos(item: SolicitudItem): number | null {
  if (item.consumo_diario <= 0) return null
  const unidadesBase = item.factor_conversion
    ? item.cantidad * item.factor_conversion
    : item.cantidad
  return Math.round(unidadesBase / item.consumo_diario)
}

/** Clases CSS del pill de cobertura según días cubiertos. */
export function pillClasses(dias: number | null, personalizado: boolean): string {
  if (personalizado) return 'bg-purple-500/10 text-purple-300 border-purple-500/30'
  if (dias === null)  return 'bg-base-200 text-base-content/40 border-base-300'
  if (dias < 15)     return 'bg-error/10 text-error border-error/30'
  if (dias < 30)     return 'bg-warning/10 text-warning border-warning/30'
  if (dias < 90)     return 'bg-success/10 text-success border-success/30'
  return 'bg-info/10 text-info border-info/30'
}

/** Texto del pill de cobertura. */
export function pillText(dias: number | null, personalizado: boolean): string {
  if (dias === null) return '📅 Sin historial'
  return personalizado ? `📌 ~${dias} días` : `📅 ~${dias} días`
}

/** Etiqueta de unidad para un ítem (presentación o unidad base). */
export function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return formatCantidad(qty, item.presentacion_nombre, item.presentacion_nombre_plural ?? undefined)
      .replace(/^[\d.,\s]+/, '').trim()
  }
  return formatCantidad(qty, item.unidad_base, item.unidad_base_plural ?? undefined)
    .replace(/^[\d.,\s]+/, '').trim()
}

/** Formatea un valor como moneda. */
export function formatPesos(val: number | string | null, monedaCodigo = 'CLP'): string {
  if (val === null) return '$0'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: monedaCodigo }).format(n)
}

/** Llama al backend para obtener el horizonte sugerido de un producto. */
export async function fetchHorizonte(productoId: string, proveedorId: number | null) {
  if (!proveedorId) {
    return {
      horizonte_sugerido: 30,
      razon: 'sin proveedor — estimación por defecto',
      consumo_diario: 0,
      consumo_diario_forecast: 0,
      consumo_diario_planificacion: 0,
      tipo_estimacion_demanda: 'sin_proveedor' as const,
      stock_actual: 0,
      stock_minimo: 0,
    }
  }
  const res = await api.get<{
    horizonte_sugerido: number
    razon: string
    consumo_diario: number
    consumo_diario_forecast: number
    consumo_diario_planificacion: number
    tipo_estimacion_demanda: 'forecast' | 'historial_corto' | 'sin_historial' | 'sin_proveedor'
    stock_actual: number
    stock_minimo: number
  }>('/solicitudes-compra/horizonte', {
    params: { producto_id: productoId, proveedor_id: proveedorId }
  })
  return res.data
}

/** Etiqueta legible para un número de días de horizonte. */
export function horizonLabel(d: number): string {
  if (d >= 365) return '1 año'
  if (d >= 180) return '6m'
  if (d >= 90)  return '3m'
  return `${d}d`
}

import type { StockItem, EstadoCantidad } from '@/types'
import { daysUntil } from '@/lib/utils'

// Stock state collapsed to a single row label for the monochrome PDF, by urgency
// priority: sin stock > vencido > por vencer > bajo. Source of truth is the
// two-axis model (migration 002: estado_cantidad / estado_vencimiento), with a
// fallback to the legacy estado_alerta enum for robustness.
export type RowEstado = 'sin_stock' | 'vencido' | 'vencer' | 'bajo' | null

// Quantity axis with legacy fallback (both share agotado/critico/reponer values).
export function ejeCantidad(item: StockItem): string {
  return (item.estado_cantidad ?? (item.estado_alerta as EstadoCantidad | undefined)) ?? ''
}

export function esSinStock(item: StockItem): boolean {
  return ejeCantidad(item) === 'agotado'
}

export function esBajo(item: StockItem): boolean {
  return ['critico', 'reponer'].includes(ejeCantidad(item))
}

// Expiry within the 30-day résumé horizon. Honors the expiry axis but always
// clamps to the actual days-until date so internal cascade states never leak a
// far-off expiry into the "por vencer" bucket.
export function esPorVencer30(item: StockItem): boolean {
  if (!item.proximo_vencimiento) return false
  const d = daysUntil(item.proximo_vencimiento)
  return d !== null && d >= 0 && d <= 30
}

export function getEstado(item: StockItem): RowEstado {
  if (esSinStock(item)) return 'sin_stock'
  if (item.estado_vencimiento === 'vencido') return 'vencido'
  if (esPorVencer30(item)) return 'vencer'
  if (esBajo(item)) return 'bajo'
  return null
}

export const ESTADO_LABEL: Record<NonNullable<RowEstado>, string> = {
  sin_stock: 'SIN STOCK',
  vencido:   'Vencido',
  vencer:    'Por vencer',
  bajo:      'Bajo',
}

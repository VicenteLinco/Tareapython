import type { ConteoItem, Presentacion } from '@/types'

/**
 * Resolves a scanned code against the items already loaded in a conteo session.
 * Pure client-side: no network. Match order:
 *   1. Exact `numero_lote` → that specific lote.
 *   2. Presentation `codigo_barras` / `gtin` → the product; returns its first
 *      matching lote (the group is expanded so the rest stay visible).
 * Returns null when nothing matches the current session.
 */
export function resolverScanConteo(
  code: string,
  items: ConteoItem[],
  presentaciones: Presentacion[],
): ConteoItem | null {
  const norm = code.trim()
  if (!norm) return null

  const byLote = items.find((i) => i.numero_lote === norm)
  if (byLote) return byLote

  const pres = presentaciones.find(
    (p) => p.codigo_barras === norm || p.gtin === norm,
  )
  if (pres) {
    const delProducto = items.filter((i) => i.producto_id === pres.producto_id)
    if (delProducto.length > 0) return delProducto[0]
  }

  return null
}

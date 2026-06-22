import type { ConteoItem, Presentacion } from '@/types'
import { parseGS1 } from '@/lib/gs1'

export type ScanConteoResult =
  // Resolved to exactly one lote in the session.
  | { kind: 'lote'; item: ConteoItem }
  // A GTIN/barcode matched a product that has several lotes in the session → ask which.
  | { kind: 'elegir'; items: ConteoItem[] }
  // Nothing in the current session matched the scanned code.
  | { kind: 'no-match' }

/**
 * Resolves a scanned code against the items loaded in a conteo session.
 * Pure, client-side (no network) — conteo can run offline, so GS1 parsing lives
 * here (frontend) rather than going to the backend.
 *
 * A GS1 DataMatrix is parsed first to extract its lot (AI 10) and GTIN (AI 01);
 * a plain code is matched as-is (backward compatible). Match order:
 *   1. Exact `numero_lote` (case-insensitive) → that specific lote.
 *   2. Presentation `codigo_barras` / `gtin` → the product's lotes
 *      (one → that lote; several → 'elegir').
 */
export function resolverScanConteo(
  code: string,
  items: ConteoItem[],
  presentaciones: Presentacion[],
): ScanConteoResult {
  const norm = code.trim()
  if (!norm) return { kind: 'no-match' }

  const parsed = parseGS1(norm)
  const loteCandidato = (parsed?.lote ?? norm).trim().toUpperCase()
  const gtinCandidato = parsed?.gtin ?? norm

  // 1. Match by lot number (the code carries the lot → unambiguous).
  const byLote = items.find(
    (i) => (i.numero_lote ?? '').trim().toUpperCase() === loteCandidato,
  )
  if (byLote) return { kind: 'lote', item: byLote }

  // 2. Match by presentation barcode/GTIN → the product's lotes in this session.
  const pres = presentaciones.find(
    (p) => p.codigo_barras === gtinCandidato || p.gtin === gtinCandidato,
  )
  if (pres) {
    const delProducto = items.filter((i) => i.producto_id === pres.producto_id)
    if (delProducto.length === 1) return { kind: 'lote', item: delProducto[0] }
    if (delProducto.length > 1) return { kind: 'elegir', items: delProducto }
  }

  return { kind: 'no-match' }
}

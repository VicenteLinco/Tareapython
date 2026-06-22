// frontend/src/pages/recepciones/recepcion-scan.ts
//
// Pure decision logic for GS1 scans in the reception flow.
// Given the current item list and a `/productos/scan` GS1 result, it decides
// what to do WITHOUT touching React state, the network, or the DOM — so it can
// be unit-tested in isolation. The hook executes the chosen outcome.
//
// Golden rule (PENDIENTES3 #7): if the code carries a lot, the scanned lot is
// respected; otherwise we fall back to the manual form.

/** Subset of a reception line the reducer needs to read. */
export interface ScanLikeDetalle {
  id: string
  producto_id: string
  lotes: Array<{ id: string; codigo_lote: string }>
}

/** Subset of the `/productos/scan` GS1 response the reducer reads. */
export interface Gs1ScanData {
  encontrado?: boolean
  tipo?: string
  producto_id: string | number
  producto_nombre: string
  gs1?: { gtin?: string; numero_lote?: string | null; fecha_vencimiento?: string | null } | null
}

export type Gs1ScanOutcome =
  // Same product + same lot already in the list → +1 to that lot line.
  | { kind: 'increment'; detalleId: string; loteId: string }
  // Same product, new lot with expiry → append a prefilled lot line.
  | { kind: 'append-lote'; detalleId: string; numeroLote: string; fechaVencimiento: string }
  // New product, lot + expiry → add a fully prefilled line built from the scan.
  | { kind: 'new-line'; numeroLote: string; fechaVencimiento: string }
  // Lot present but no expiry → open the sheet with the lot prefilled, asking only the expiry.
  | { kind: 'prompt-venc'; numeroLote: string }
  // No lot in the code → current manual form behaviour.
  | { kind: 'manual' }

/**
 * Decides how to apply a GS1 scan result against the current item list.
 * Assumes `data.tipo === 'gs1'` and `data.encontrado`.
 */
export function decideGs1Scan(detalles: ScanLikeDetalle[], data: Gs1ScanData): Gs1ScanOutcome {
  const numeroLote = data.gs1?.numero_lote?.trim() || ''
  const fechaVencimiento = data.gs1?.fecha_vencimiento?.trim() || ''

  // No lot → keep the existing manual form path.
  if (!numeroLote) return { kind: 'manual' }

  const productoId = String(data.producto_id)
  const existing = detalles.find(d => d.producto_id === productoId)

  if (existing) {
    const matchingLote = existing.lotes.find(l => l.codigo_lote === numeroLote)
    if (matchingLote) {
      // Re-scan of the same lot → bump that specific line (we already have its expiry).
      return { kind: 'increment', detalleId: existing.id, loteId: matchingLote.id }
    }
    // New lot for an existing product.
    if (fechaVencimiento) {
      return { kind: 'append-lote', detalleId: existing.id, numeroLote, fechaVencimiento }
    }
    return { kind: 'prompt-venc', numeroLote }
  }

  // New product.
  if (fechaVencimiento) {
    return { kind: 'new-line', numeroLote, fechaVencimiento }
  }
  return { kind: 'prompt-venc', numeroLote }
}

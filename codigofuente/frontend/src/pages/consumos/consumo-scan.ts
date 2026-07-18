// frontend/src/pages/consumos/consumo-scan.ts
//
// Pure decision logic for GS1 scans in the consumption flow.
// Golden rule (PENDIENTES3 #7): if the scanned code carries a lot, discount
// from THAT lot (bypassing FEFO); if the lot has no stock in the active area,
// warn and offer FEFO or cancel (never blindly); if there is no lot, use FEFO.
//
// Kept free of React/network so it can be unit-tested in isolation. The page
// orchestrates the fetches and feeds the resolved facts in.

export type ConsumoScanOutcome =
  // No lot in the code → fall back to automatic FEFO.
  | { kind: "fefo" }
  // Lot found with stock in the active area → discount from that exact lot.
  | { kind: "lote-exacto"; loteId: string }
  // Lot exists in stock but not in the active area → warn + FEFO/cancel.
  | { kind: "sin-stock-en-area"; numeroLote: string }
  // Lot not found in stock at all → warn + FEFO/cancel.
  | { kind: "lote-no-encontrado"; numeroLote: string };

export interface ConsumoScanInput {
  numeroLote?: string | null;
  /** Matched lot that has stock in the active area (or anywhere when no area filter). */
  loteEnArea?: { lote_id: string } | null;
  /** Whether the lot exists with stock in any area. */
  existeEnStock?: boolean;
}

export function classifyConsumoScan({
  numeroLote,
  loteEnArea,
  existeEnStock,
}: ConsumoScanInput): ConsumoScanOutcome {
  const lote = numeroLote?.trim() || "";
  if (!lote) return { kind: "fefo" };
  if (loteEnArea) return { kind: "lote-exacto", loteId: loteEnArea.lote_id };
  if (existeEnStock) return { kind: "sin-stock-en-area", numeroLote: lote };
  return { kind: "lote-no-encontrado", numeroLote: lote };
}

/** Case-insensitive lot lookup by manufacturer lot number. */
export function findLoteByNumero<T extends { numero_lote: string }>(
  lotes: T[],
  numeroLote: string,
): T | null {
  const target = numeroLote.trim().toUpperCase();
  return (
    lotes.find((l) => l.numero_lote.trim().toUpperCase() === target) ?? null
  );
}

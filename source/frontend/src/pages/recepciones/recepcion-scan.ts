/* eslint-disable no-control-regex */
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
  id: string;
  producto_id: string;
  lotes: Array<{ id: string; codigo_lote: string }>;
}

/** Subset of the `/productos/scan` GS1 response the reducer reads. */
export interface Gs1ScanData {
  encontrado?: boolean;
  tipo?: string;
  producto_id: string | number;
  producto_nombre: string;
  control_lote?: string;
  gs1?: {
    gtin?: string;
    numero_lote?: string | null;
    fecha_vencimiento?: string | null;
  } | null;
}

export type Gs1ScanOutcome =
  // Same product + same lot already in the list → +1 to that lot line.
  | { kind: "increment"; detalleId: string; loteId: string }
  // Same product, new lot with expiry → append a prefilled lot line.
  | {
      kind: "append-lote";
      detalleId: string;
      numeroLote: string;
      fechaVencimiento: string;
    }
  // New product, lot + expiry → add a fully prefilled line built from the scan.
  | { kind: "new-line"; numeroLote: string; fechaVencimiento: string }
  // Lot present but no expiry → open the sheet with the lot prefilled, asking only the expiry.
  | { kind: "prompt-venc"; numeroLote: string }
  // No lot in the code → current manual form behaviour.
  | { kind: "manual" };

/**
 * Decides how to apply a GS1 scan result against the current item list.
 * Assumes `data.tipo === 'gs1'` and `data.encontrado`.
 */
export function decideGs1Scan(
  detalles: ScanLikeDetalle[],
  data: Gs1ScanData,
): Gs1ScanOutcome {
  const numeroLote = data.gs1?.numero_lote?.trim() || "";
  const fechaVencimiento = data.gs1?.fecha_vencimiento?.trim() || "";

  // Simple product -> direct add or increment
  if (data.control_lote === "simple") {
    const productoId = String(data.producto_id);
    const existing = detalles.find((d) => d.producto_id === productoId);
    if (existing && existing.lotes.length > 0) {
      return {
        kind: "increment",
        detalleId: existing.id,
        loteId: existing.lotes[0].id,
      };
    }
    return { kind: "new-line", numeroLote: "", fechaVencimiento: "" };
  }

  // No lot → keep the existing manual form path.
  if (!numeroLote) return { kind: "manual" };

  const productoId = String(data.producto_id);
  const existing = detalles.find((d) => d.producto_id === productoId);

  if (existing) {
    const matchingLote = existing.lotes.find(
      (l) => l.codigo_lote === numeroLote,
    );
    if (matchingLote) {
      // Re-scan of the same lot → bump that specific line (we already have its expiry).
      return {
        kind: "increment",
        detalleId: existing.id,
        loteId: matchingLote.id,
      };
    }
    // New lot for an existing product.
    if (fechaVencimiento) {
      return {
        kind: "append-lote",
        detalleId: existing.id,
        numeroLote,
        fechaVencimiento,
      };
    }
    return { kind: "prompt-venc", numeroLote };
  }

  // New product.
  if (fechaVencimiento) {
    return { kind: "new-line", numeroLote, fechaVencimiento };
  }
  return { kind: "prompt-venc", numeroLote };
}

export interface ParsedGs1 {
  gtin?: string;
  lote?: string;
  vencimiento?: string; // YYYY-MM-DD
  fabricacion?: string; // YYYY-MM-DD
  ref?: string; // from AI 240
}

export function parseGs1Client(code: string): ParsedGs1 | null {
  const clean = code
    .trim()
    .replace(/^[\x00-\x1F\x7F\s]+/, "")
    .replace(/[()]/g, "");

  if (!clean.startsWith("01") || clean.length < 16) {
    return null;
  }

  const gtin = clean.substring(2, 16);
  const remaining = clean.substring(16);

  let lote: string | undefined;
  let vencimiento: string | undefined;
  let fabricacion: string | undefined;
  let ref: string | undefined;

  let i = 0;
  while (i < remaining.length) {
    const charCode = remaining.charCodeAt(i);
    if (charCode < 32 || charCode === 127) {
      i++;
      continue;
    }

    if (remaining.substring(i, i + 2) === "17") {
      const dateStr = remaining.substring(i + 2, i + 8);
      if (dateStr.length === 6 && /^\d+$/.test(dateStr)) {
        vencimiento = formatGs1Date(dateStr);
        i += 8;
        continue;
      }
    }
    if (remaining.substring(i, i + 2) === "11") {
      const dateStr = remaining.substring(i + 2, i + 8);
      if (dateStr.length === 6 && /^\d+$/.test(dateStr)) {
        fabricacion = formatGs1Date(dateStr);
        i += 8;
        continue;
      }
    }
    if (remaining.substring(i, i + 2) === "10") {
      let lotEnd = remaining.length;
      for (let j = i + 2; j < remaining.length; j++) {
        const charCodeJ = remaining.charCodeAt(j);
        if (charCodeJ < 32 || charCodeJ === 127) {
          lotEnd = j;
          break;
        }
        const next2 = remaining.substring(j, j + 2);
        const next3 = remaining.substring(j, j + 3);
        if (
          next2 === "17" &&
          /^\d{6}/.test(remaining.substring(j + 2, j + 8))
        ) {
          lotEnd = j;
          break;
        }
        if (
          next2 === "11" &&
          /^\d{6}/.test(remaining.substring(j + 2, j + 8))
        ) {
          lotEnd = j;
          break;
        }
        if (next3 === "240") {
          lotEnd = j;
          break;
        }
      }
      lote = remaining.substring(i + 2, lotEnd);
      i = lotEnd;
      continue;
    }
    if (remaining.substring(i, i + 3) === "240") {
      let refEnd = remaining.length;
      for (let j = i + 3; j < remaining.length; j++) {
        const charCodeJ = remaining.charCodeAt(j);
        if (charCodeJ < 32 || charCodeJ === 127) {
          refEnd = j;
          break;
        }
        const next2 = remaining.substring(j, j + 2);
        if (
          next2 === "17" &&
          /^\d{6}/.test(remaining.substring(j + 2, j + 8))
        ) {
          refEnd = j;
          break;
        }
        if (
          next2 === "11" &&
          /^\d{6}/.test(remaining.substring(j + 2, j + 8))
        ) {
          refEnd = j;
          break;
        }
        if (next2 === "10") {
          refEnd = j;
          break;
        }
      }
      ref = remaining.substring(i + 3, refEnd);
      i = refEnd;
      continue;
    }
    i++;
  }

  return { gtin, lote, vencimiento, fabricacion, ref };
}

function formatGs1Date(yyyymmdd: string): string {
  const yy = parseInt(yyyymmdd.substring(0, 2), 10);
  const mm = parseInt(yyyymmdd.substring(2, 4), 10);
  let dd = parseInt(yyyymmdd.substring(4, 6), 10);

  const year = 2000 + yy;

  if (dd === 0) {
    const nextMonth = new Date(year, mm, 1);
    nextMonth.setDate(nextMonth.getDate() - 1);
    dd = nextMonth.getDate();
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(mm)}-${pad(dd)}`;
}

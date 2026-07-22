export interface GuideItemForValidation {
  nombre_producto: string;
  lote: string | null;
  fecha_vencimiento: string | null;
  control_lote?: "trazable" | "con_vto" | "simple";
}

/**
 * Normaliza fechas provenientes de extracción por IA en múltiples formatos
 * (ej: "31/12/2027", "31-12-2027", "2027/12/31", "2027-12", "2027-12-31T00:00:00Z")
 * retornando siempre una fecha válida en formato YYYY-MM-DD o null si es inválida.
 */
export function normalizeImportedDate(rawDate: string | null | undefined): string | null {
  if (!rawDate || !rawDate.trim()) return null;
  const cleaned = rawDate.trim();

  // Caso ISO string: "2027-12-31T00:00:00.000Z" -> "2027-12-31"
  if (cleaned.includes("T")) {
    const part = cleaned.split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) return part;
  }

  // YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD
  const yyyymmdd = cleaned.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, "0");
    const day = yyyymmdd[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY, DD-MM-YY
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2}|\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    let year = ddmmyyyy[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${year}-${month}-${day}`;
  }

  // YYYY-MM
  const yyyymm = cleaned.match(/^(\d{4})[\/\-\.](\d{1,2})$/);
  if (yyyymm) {
    const year = yyyymm[1];
    const month = yyyymm[2].padStart(2, "0");
    return `${year}-${month}-28`;
  }

  // MM/YYYY o MM-YYYY
  const mmyyyy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{4})$/);
  if (mmyyyy) {
    const month = mmyyyy[1].padStart(2, "0");
    const year = mmyyyy[2];
    return `${year}-${month}-28`;
  }

  return null;
}

/**
 * Parsea montos de precios ingresados por el usuario o extraídos por IA,
 * respetando separadores de miles y decimales comunes en Chile / Latinoamérica.
 */
export function parseCurrencyInput(inputVal: string): number | null {
  if (!inputVal || !inputVal.trim()) return null;
  let s = inputVal.trim();
  // Remover símbolo de moneda
  s = s.replace(/[$]/g, "").trim();
  if (!s) return null;

  // Si contiene solo dígitos
  if (/^\d+$/.test(s)) {
    return Number(s);
  }

  // Si tiene formato chileno tipo "12.500" o "12.500,50"
  if (s.includes(".")) {
    const parts = s.split(".");
    // Caso "12.500" (puntos como separadores de miles)
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (parts.length === 2 && parts[1].length <= 2) {
      // Caso decimal estándar "12500.50"
      s = s.replace(",", "");
    } else {
      s = s.replace(/\./g, "").replace(",", ".");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

  const num = parseFloat(s);
  return isNaN(num) || !isFinite(num) ? null : num;
}

export function validateImportedGuideItem(
  item: GuideItemForValidation,
): Record<string, boolean> {
  const errors: Record<string, boolean> = {};
  if (!item.nombre_producto?.trim()) errors.nombre_producto = true;

  const mode = item.control_lote || "con_vto";

  if (mode === "trazable") {
    // Trazable requiere lote
    if (!item.lote?.trim()) errors.lote = true;
  } else if (mode === "con_vto") {
    // Con Vto requiere lote y fecha válida
    if (!item.lote?.trim()) errors.lote = true;
    const normalizedVto = normalizeImportedDate(item.fecha_vencimiento);
    if (!normalizedVto) {
      errors.fecha_vencimiento = true;
    }
  }
  // mode === "simple" no requiere lote ni vencimiento

  return errors;
}

export function autoFixGuideItem<T extends GuideItemForValidation & { cantidad?: number }>(
  item: T,
  idx: number,
): T {
  const name = item.nombre_producto?.trim() || `Producto Ítem ${idx + 1}`;
  const qty = item.cantidad && !isNaN(item.cantidad) && item.cantidad > 0 ? item.cantidad : 1;
  let control_lote = item.control_lote || "simple";
  let lote = item.lote;
  let vto = item.fecha_vencimiento;

  if (control_lote === "con_vto" && (!lote?.trim() || !normalizeImportedDate(vto))) {
    control_lote = "simple";
    lote = null;
    vto = null;
  } else if (control_lote === "trazable" && !lote?.trim()) {
    control_lote = "simple";
    lote = null;
  }

  return {
    ...item,
    nombre_producto: name,
    cantidad: qty,
    control_lote,
    lote,
    fecha_vencimiento: vto,
  };
}

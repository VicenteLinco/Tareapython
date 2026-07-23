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
  // Remover prefijos de moneda (CLP, USD, etc) y símbolo de moneda $
  s = s.replace(/^(clp|usd|cl|\$)\s*/i, "").replace(/[$]/g, "").trim();
  if (!s) return null;

  // Si contiene solo dígitos
  if (/^\d+$/.test(s)) {
    return Number(s);
  }

  // Caso comas como separadores de miles en inglés ("1,250,000" o "1,250,000.50")
  if (/^\d{1,3}(,\d{3})+(?:\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  }
  // Caso puntos como separadores de miles en español/CLP ("12.500", "1.250.000", "12.500,50")
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // Caso decimal simple con punto ("12500.50")
  else if (/^\d+\.\d{1,2}$/.test(s)) {
    // mantener punto
  } else if (s.includes(".")) {
    s = s.replace(/\./g, "");
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

/**
 * Diccionario de sinonimia clínica y equivalencias de insumos médicos.
 */
const CLINICAL_SYNONYMS: Record<string, string[]> = {
  "cloruro de sodio": ["suero fisiologico", "nacl 0.9%", "solucion fisiologica"],
  "alcohol etilico": ["alcohol gel", "alcohol 70", "alcohol desnaturalizado"],
  "agua inyectable": ["agua destilada", "agua bidestilada", "agua para inyeccion"],
  "paracetamol": ["acetaminofen", "panadol", "tylenol"],
  "povidona yodada": ["betadine", "yodopovidona", "desinfectante yodado"],
};

/**
 * Calcula la similitud de Levenshtein entre dos cadenas de texto (retorna entre 0.0 y 1.0).
 */
export function calculateLevenshteinSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return Number((1 - distance / maxLen).toFixed(2));
}

/**
 * Calcula el puntaje de coincidencia clínica considerando sinonimia y Levenshtein.
 */
export function matchClinicalSynonym(query: string, candidate: string): number {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();

  if (q === c) return 1.0;
  if (c.includes(q) || q.includes(c)) return 0.85;

  for (const [key, synonyms] of Object.entries(CLINICAL_SYNONYMS)) {
    const keyMatchesQ = q.includes(key) || key.includes(q);
    const keyMatchesC = c.includes(key) || key.includes(c);

    for (const syn of synonyms) {
      const synMatchesQ = q.includes(syn) || syn.includes(q);
      const synMatchesC = c.includes(syn) || syn.includes(c);

      if ((keyMatchesQ && synMatchesC) || (synMatchesQ && keyMatchesC)) {
        return 0.9;
      }
    }
  }

  return calculateLevenshteinSimilarity(q, c);
}


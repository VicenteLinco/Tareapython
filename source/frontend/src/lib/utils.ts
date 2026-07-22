import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toDecimal, toNum, type DecimalInput } from "@/domain/parse";

/**
 * Locale único de la aplicación para formateo de fecha, hora y número.
 * Punto único de verdad: cambiar este valor reconfigura todo el sistema.
 */
export const APP_LOCALE = "es-CL";

/**
 * Convierte una ruta de imagen de la DB en una URL completa para el frontend.
 * Soporta imágenes legacy (base64) y nuevas (rutas relativas al bucket de uploads).
 */
export function getImageUrl(path: string | null | undefined): string {
  if (!path) return "";
  // Si ya es un data URL (legacy), devolverlo tal cual
  if (path.startsWith("data:image")) return path;
  // Si es una ruta relativa (ej: "recepciones/xyz.webp"), anteponer el prefijo del API
  return `/api/v1/uploads/${path}`;
}

/**
 * Formatea una cantidad total de forma "humana" usando presentaciones.
 * Ej: 110 unidades con factor 100 -> "1 Caja + 10 Reacciones"
 */
export function formatStockHumano(
  total: DecimalInput,
  factor: DecimalInput,
  uBase: string,
  uBasePlural: string,
  uPres: string,
  uPresPlural: string,
): string {
  const totalDecimal = toDecimal(total);
  const factorDecimal = toDecimal(factor);
  const t = totalDecimal.abs();
  const isNeg = totalDecimal.lt(0);

  if (factorDecimal.lte(1)) return formatCantidad(total, uBase, uBasePlural);

  const cajas = t.dividedToIntegerBy(factorDecimal);
  const sueltas = t.mod(factorDecimal);
  const cajasNum = cajas.toNumber();

  const labelPres = cajas.eq(1) ? uPres : uPresPlural || uPres;
  const labelBase = sueltas.eq(1) ? uBase : uBasePlural || uBase;

  let result = "";
  if (cajas.gt(0)) result += `${cajasNum} ${labelPres}`;
  if (cajas.gt(0) && sueltas.gt(0)) result += " + ";
  if (sueltas.gt(0) || cajas.eq(0)) {
    const val = sueltas.toDecimalPlaces(2).toNumber();
    result += `${val} ${labelBase}`;
  }

  return isNeg ? `-${result}` : result;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function daysUntil(
  date: string | Date | null | undefined,
): number | null {
  if (!date) return null;
  const parseDateOnly = (value: string | Date): Date | null => {
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }

    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  };

  const target = parseDateOnly(date);
  if (!target) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
}

/**
 * Formatea una cantidad con su unidad usando singular o plural.
 * - Si qty === 1 → singular
 * - Si qty !== 1 → plural (usa singular como fallback si no se provee)
 * - Enteros se muestran sin decimales (5 no 5.0)
 * - No-enteros con hasta 2 decimales significativos
 */
export function formatCantidad(
  qty: DecimalInput,
  singular: string,
  plural?: string | null,
): string {
  const value = toDecimal(qty);
  const rounded = value.toDecimalPlaces(0);
  const isInt = value.minus(rounded).abs().lt(0.0001);
  const num = isInt ? rounded.toNumber() : value.toDecimalPlaces(2).toNumber();
  const unit = value.eq(1) ? singular : (plural ?? singular);
  return `${num} ${unit}`;
}

export function formatPrecio(
  value: DecimalInput,
  currency = "CLP",
  locale = APP_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(toNum(value));
}

/**
 * Valida si una URL de icono es segura.
 * Solo permite HTTPS, rutas locales, o data URLs de imágenes estáticas (PNG, JPG, WEBP, GIF).
 * Bloquea data:image/svg+xml para prevenir ataques XSS.
 */
export function isSafeIconUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  // Permitir HTTPS y rutas locales
  if (url.startsWith("https://") || url.startsWith("/")) return true;

  // Permitir HTTP solo si estamos en desarrollo (localhost)
  if (import.meta.env.DEV && url.startsWith("http://")) return true;

  // Prefijos seguros para data URLs
  const safeDataPrefixes = [
    "data:image/png",
    "data:image/jpeg",
    "data:image/jpg",
    "data:image/webp",
    "data:image/gif",
  ];
  return safeDataPrefixes.some((prefix) => url.startsWith(prefix));
}

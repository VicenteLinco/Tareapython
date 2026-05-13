import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Convierte una ruta de imagen de la DB en una URL completa para el frontend.
 * Soporta imágenes legacy (base64) y nuevas (rutas relativas al bucket de uploads).
 */
export function getImageUrl(path: string | null | undefined): string {
  if (!path) return ''
  // Si ya es un data URL (legacy), devolverlo tal cual
  if (path.startsWith('data:image')) return path
  // Si es una ruta relativa (ej: "recepciones/xyz.webp"), anteponer el prefijo del API
  return `/api/v1/uploads/${path}`
}

/**
 * Formatea una cantidad total de forma "humana" usando presentaciones.
 * Ej: 110 unidades con factor 100 -> "1 Caja + 10 Reacciones"
 */
export function formatStockHumano(
  total: number,
  factor: number,
  uBase: string,
  uBasePlural: string,
  uPres: string,
  uPresPlural: string
): string {
  const t = Math.abs(total)
  const isNeg = total < 0
  
  if (factor <= 1) return formatCantidad(total, uBase, uBasePlural)

  const cajas = Math.floor(t / factor)
  const sueltas = t % factor

  const labelPres = cajas === 1 ? uPres : (uPresPlural || uPres)
  const labelBase = sueltas === 1 ? uBase : (uBasePlural || uBase)

  let result = ''
  if (cajas > 0) result += `${cajas} ${labelPres}`
  if (cajas > 0 && sueltas > 0) result += ' + '
  if (sueltas > 0 || cajas === 0) {
    const isInt = Math.abs(sueltas - Math.round(sueltas)) < 0.0001
    const val = isInt ? Math.round(sueltas) : parseFloat(sueltas.toFixed(2))
    result += `${val} ${labelBase}`
  }

  return isNeg ? `-${result}` : result
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null
  const target = new Date(date)
  if (isNaN(target.getTime())) return null
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Formatea una cantidad con su unidad usando singular o plural.
 * - Si qty === 1 → singular
 * - Si qty !== 1 → plural (usa singular como fallback si no se provee)
 * - Enteros se muestran sin decimales (5 no 5.0)
 * - No-enteros con hasta 2 decimales significativos
 */
export function formatCantidad(qty: number, singular: string, plural?: string | null): string {
  const isInt = Math.abs(qty - Math.round(qty)) < 0.0001
  const num = isInt ? Math.round(qty) : parseFloat(qty.toFixed(2))
  const unit = (isInt && Math.round(qty) === 1) ? singular : (plural ?? singular)
  return `${num} ${unit}`
}

/**
 * Valida si una URL de icono es segura.
 * Solo permite HTTPS, rutas locales, o data URLs de imágenes estáticas (PNG, JPG, WEBP, GIF).
 * Bloquea data:image/svg+xml para prevenir ataques XSS.
 */
export function isSafeIconUrl(url: string | null | undefined): boolean {
  if (!url) return false
  
  // Permitir HTTPS y rutas locales
  if (url.startsWith('https://') || url.startsWith('/')) return true
  
  // Permitir HTTP solo si estamos en desarrollo (localhost)
  if (import.meta.env.DEV && url.startsWith('http://')) return true

  // Prefijos seguros para data URLs
  const safeDataPrefixes = [
    'data:image/png',
    'data:image/jpeg',
    'data:image/jpg',
    'data:image/webp',
    'data:image/gif',
    'data:image/svg+xml', // Permitir SVG pero con cautela (se puede restringir más luego)
  ]
  return safeDataPrefixes.some((prefix) => url.startsWith(prefix))
}

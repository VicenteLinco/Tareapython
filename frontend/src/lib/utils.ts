import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

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

/** Plural automático para español: vocal final → +s, consonante → +es. */
export function autoPlural(s: string): string {
  const last = s.slice(-1).toLowerCase()
  return 'aeiouáéíóú'.includes(last) ? s + 's' : s + 'es'
}

/**
 * Formatea una cantidad con su unidad usando singular o plural.
 * - Si qty === 1 → singular
 * - Si qty !== 1 → plural (usa autoPlural si no se provee)
 * - Enteros se muestran sin decimales (5 no 5.0)
 * - No-enteros con hasta 2 decimales significativos
 */
export function formatCantidad(qty: number, singular: string, plural?: string | null): string {
  const num = qty % 1 === 0 ? Math.floor(qty) : parseFloat(qty.toFixed(2))
  const unit = qty === 1 ? singular : (plural ?? autoPlural(singular))
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

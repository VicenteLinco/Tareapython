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

export function daysUntil(date: string | Date): number {
  const target = new Date(date)
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

/** Devuelve singular o plural. Si no hay plural explícito, aplica regla básica española. */
export function pluralize(singular: string, qty: number, plural?: string | null): string {
  if (qty === 1) return singular
  if (plural) return plural
  const last = singular.slice(-1).toLowerCase()
  const vowels = ['a', 'e', 'i', 'o', 'u']
  return vowels.includes(last) ? singular + 's' : singular + 'es'
}

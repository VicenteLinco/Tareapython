const KEY = 'lab_pres_formatos'

export interface PresFormato {
  nombre: string
  nombre_plural: string
}

export const PRES_FORMATOS_DEFAULT: PresFormato[] = [
  { nombre: 'Ampolla', nombre_plural: 'Ampollas' },
  { nombre: 'Blister', nombre_plural: 'Blísters' },
  { nombre: 'Bolsa', nombre_plural: 'Bolsas' },
  { nombre: 'Botella', nombre_plural: 'Botellas' },
  { nombre: 'Caja', nombre_plural: 'Cajas' },
  { nombre: 'Frasco', nombre_plural: 'Frascos' },
  { nombre: 'Kit', nombre_plural: 'Kits' },
  { nombre: 'Paquete', nombre_plural: 'Paquetes' },
  { nombre: 'Rollo', nombre_plural: 'Rollos' },
  { nombre: 'Sobre', nombre_plural: 'Sobres' },
  { nombre: 'Tubo', nombre_plural: 'Tubos' },
  { nombre: 'Unidad', nombre_plural: 'Unidades' },
]

export function getPresFormatos(): PresFormato[] {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Migración: si es array de strings, convertir a objetos
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        return (parsed as string[]).map((s) => ({
          nombre: s,
          nombre_plural: s,
        }))
      }
      return parsed
    }
  } catch {
    return [...PRES_FORMATOS_DEFAULT]
  }
  return [...PRES_FORMATOS_DEFAULT]
}

export function savePresFormatos(list: PresFormato[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

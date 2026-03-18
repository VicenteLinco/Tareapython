const KEY = 'lab_pres_formatos'

export const PRES_FORMATOS_DEFAULT = [
  'Ampolla', 'Blister', 'Bolsa', 'Botella', 'Caja', 'Frasco',
  'Kit', 'Paquete', 'Rollo', 'Sobre', 'Tubo', 'Unidad',
]

export function getPresFormatos(): string[] {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return [...PRES_FORMATOS_DEFAULT]
}

export function savePresFormatos(list: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

import type { DetalleLineUI, LoteLineUI } from './item-card'

export function isLoteComplete(l: LoteLineUI): boolean {
  return !!(l.codigo_lote && l.fecha_vencimiento)
}

export function isCardComplete(d: DetalleLineUI): boolean {
  return !!(d.area_destino_id && d.lotes.length > 0 && d.lotes.every(isLoteComplete))
}

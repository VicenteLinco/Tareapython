import type { ControlLote } from '@/types'

/**
 * Per-product lot policy. Drives lot/expiry requirements across product
 * creation, reception and consumption. Default is 'con_vto' (current behavior).
 */
export const CONTROL_LOTE_OPTIONS: {
  value: ControlLote
  label: string
  help: string
}[] = [
  {
    value: 'con_vto',
    label: 'Con vencimiento',
    help: 'Lote opcional, vencimiento obligatorio. FEFO automático. Comportamiento por defecto.',
  },
  {
    value: 'trazable',
    label: 'Trazable (reactivo crítico)',
    help: 'Lote y vencimiento obligatorios. Se consume el lote exacto escaneado.',
  },
  {
    value: 'simple',
    label: 'Simple (consumible)',
    help: 'Sin lote ni vencimiento. Descuento directo de stock.',
  },
]

export function controlLoteLabel(value: ControlLote): string {
  return CONTROL_LOTE_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export function controlLoteHelp(value: ControlLote): string {
  return CONTROL_LOTE_OPTIONS.find((o) => o.value === value)?.help ?? ''
}

import { describe, it, expect } from 'vitest'
import { classifyConsumoScan, findLoteByNumero } from './consumo-scan'

describe('classifyConsumoScan', () => {
  it('sin numero de lote → fefo', () => {
    expect(classifyConsumoScan({ numeroLote: null }).kind).toBe('fefo')
    expect(classifyConsumoScan({ numeroLote: '   ' }).kind).toBe('fefo')
  })

  it('lote con stock en el área → lote-exacto con el loteId', () => {
    const out = classifyConsumoScan({ numeroLote: 'AB123', loteEnArea: { lote_id: 'L-1' }, existeEnStock: true })
    expect(out.kind).toBe('lote-exacto')
    if (out.kind !== 'lote-exacto') return
    expect(out.loteId).toBe('L-1')
  })

  it('lote existe en stock pero no en el área activa → sin-stock-en-area', () => {
    const out = classifyConsumoScan({ numeroLote: 'AB123', loteEnArea: null, existeEnStock: true })
    expect(out.kind).toBe('sin-stock-en-area')
    if (out.kind !== 'sin-stock-en-area') return
    expect(out.numeroLote).toBe('AB123')
  })

  it('lote no existe en stock → lote-no-encontrado', () => {
    const out = classifyConsumoScan({ numeroLote: 'ZZ9', loteEnArea: null, existeEnStock: false })
    expect(out.kind).toBe('lote-no-encontrado')
    if (out.kind !== 'lote-no-encontrado') return
    expect(out.numeroLote).toBe('ZZ9')
  })
})

describe('findLoteByNumero', () => {
  const lotes = [
    { id: 'L-1', numero_lote: 'ab123' },
    { id: 'L-2', numero_lote: 'XY-9' },
  ]

  it('matchea sin distinguir mayúsculas/minúsculas', () => {
    expect(findLoteByNumero(lotes, 'AB123')?.id).toBe('L-1')
    expect(findLoteByNumero(lotes, 'xy-9')?.id).toBe('L-2')
  })

  it('tolera espacios alrededor', () => {
    expect(findLoteByNumero(lotes, '  AB123 ')?.id).toBe('L-1')
  })

  it('devuelve null si no hay match', () => {
    expect(findLoteByNumero(lotes, 'NOPE')).toBeNull()
  })
})

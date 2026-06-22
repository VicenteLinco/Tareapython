import { describe, it, expect } from 'vitest'
import { decideGs1Scan, type ScanLikeDetalle, type Gs1ScanData } from './recepcion-scan'

// Minimal detalle factory — only the fields the reducer reads.
function detalle(detalleId: string, productoId: string, lotes: Array<{ id: string; codigo_lote: string }>): ScanLikeDetalle {
  return {
    id: detalleId,
    producto_id: productoId,
    lotes: lotes.map(l => ({
      id: l.id,
      codigo_lote: l.codigo_lote,
      fecha_vencimiento: '2026-01-01',
      cantidad_presentacion: 1,
    })),
  }
}

function gs1Scan(numeroLote: string | null, fechaVencimiento: string | null): Gs1ScanData {
  return {
    encontrado: true,
    tipo: 'gs1',
    producto_id: 'P1',
    producto_nombre: 'Reactivo X',
    gs1: { gtin: '07501234567890', numero_lote: numeroLote, fecha_vencimiento: fechaVencimiento },
  }
}

describe('decideGs1Scan', () => {
  it('producto nuevo + lote + venc → new-line con los datos del scan', () => {
    const out = decideGs1Scan([], gs1Scan('AB123', '2026-08-15'))
    expect(out.kind).toBe('new-line')
    if (out.kind !== 'new-line') return
    expect(out.numeroLote).toBe('AB123')
    expect(out.fechaVencimiento).toBe('2026-08-15')
  })

  it('producto existente + lote nuevo + venc → append-lote al detalle existente', () => {
    const detalles = [detalle('D1', 'P1', [{ id: 'L-old', codigo_lote: 'OLD' }])]
    const out = decideGs1Scan(detalles, gs1Scan('NEW1', '2026-08-15'))
    expect(out.kind).toBe('append-lote')
    if (out.kind !== 'append-lote') return
    expect(out.detalleId).toBe('D1')
    expect(out.numeroLote).toBe('NEW1')
    expect(out.fechaVencimiento).toBe('2026-08-15')
  })

  it('producto existente + mismo lote → increment de esa línea de lote', () => {
    const detalles = [detalle('D1', 'P1', [{ id: 'L-1', codigo_lote: 'AB123' }])]
    const out = decideGs1Scan(detalles, gs1Scan('AB123', '2026-08-15'))
    expect(out.kind).toBe('increment')
    if (out.kind !== 'increment') return
    expect(out.detalleId).toBe('D1')
    expect(out.loteId).toBe('L-1')
  })

  it('producto existente + mismo lote pero scan SIN venc → igual increment (ya tenemos el venc)', () => {
    const detalles = [detalle('D1', 'P1', [{ id: 'L-1', codigo_lote: 'AB123' }])]
    const out = decideGs1Scan(detalles, gs1Scan('AB123', null))
    expect(out.kind).toBe('increment')
    if (out.kind !== 'increment') return
    expect(out.loteId).toBe('L-1')
  })

  it('producto nuevo + lote SIN venc → prompt-venc con el lote prellenado', () => {
    const out = decideGs1Scan([], gs1Scan('AB123', null))
    expect(out.kind).toBe('prompt-venc')
    if (out.kind !== 'prompt-venc') return
    expect(out.numeroLote).toBe('AB123')
  })

  it('producto existente + lote nuevo SIN venc → prompt-venc (lote nuevo, falta venc)', () => {
    const detalles = [detalle('D1', 'P1', [{ id: 'L-old', codigo_lote: 'OLD' }])]
    const out = decideGs1Scan(detalles, gs1Scan('ZZ9', null))
    expect(out.kind).toBe('prompt-venc')
    if (out.kind !== 'prompt-venc') return
    expect(out.numeroLote).toBe('ZZ9')
  })

  it('gs1 sin numero_lote → manual (formulario actual)', () => {
    const out = decideGs1Scan([], gs1Scan(null, '2026-08-15'))
    expect(out.kind).toBe('manual')
  })

  it('sin objeto gs1 → manual', () => {
    const data: Gs1ScanData = { encontrado: true, tipo: 'gs1', producto_id: 'P1', producto_nombre: 'X', gs1: null }
    const out = decideGs1Scan([], data)
    expect(out.kind).toBe('manual')
  })
})

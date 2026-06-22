import { describe, it, expect } from 'vitest'
import { parseGS1 } from './gs1'

const GS = '\x1d' // FNC1 / group separator

describe('parseGS1 — bracketed format', () => {
  it('parses GTIN + expiry + lot in (AI) notation', () => {
    const r = parseGS1('(01)07501234567890(17)260815(10)LOTE123')
    expect(r).not.toBeNull()
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.vencimiento).toBe('2026-08-15')
    expect(r!.lote).toBe('LOTE123')
  })

  it('parses regardless of AI order (lot before expiry)', () => {
    const r = parseGS1('(01)07501234567890(10)AB-99(17)270101')
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.lote).toBe('AB-99')
    expect(r!.vencimiento).toBe('2027-01-01')
  })

  it('tolerates spaces around brackets', () => {
    const r = parseGS1(' (01) 07501234567890 (10) X1 ')
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.lote).toBe('X1')
  })
})

describe('parseGS1 — FNC1 / plain concatenated format', () => {
  it('parses fixed-length AIs concatenated without separators', () => {
    // 01(14) + 17(6) + 10(rest) — 10 is last, no separator needed
    const r = parseGS1('01075012345678901726081510LOTE123')
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.vencimiento).toBe('2026-08-15')
    expect(r!.lote).toBe('LOTE123')
  })

  it('uses FNC1 to terminate a variable AI followed by another AI', () => {
    // (10)LOTE123 <GS> (17)260815
    const r = parseGS1('0107501234567890' + '10LOTE123' + GS + '17260815')
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.lote).toBe('LOTE123')
    expect(r!.vencimiento).toBe('2026-08-15')
  })

  it('captures serial (AI 21) and production date (AI 11)', () => {
    const r = parseGS1('0107501234567890' + '11250101' + '21SN-7' + GS + '17260815')
    expect(r!.gtin).toBe('07501234567890')
    expect(r!.fechaProduccion).toBe('2025-01-01')
    expect(r!.serial).toBe('SN-7')
    expect(r!.vencimiento).toBe('2026-08-15')
  })
})

describe('parseGS1 — date rules', () => {
  it('expands DD=00 to the last day of the month', () => {
    const r = parseGS1('(17)260800')
    expect(r!.vencimiento).toBe('2026-08-31')
  })

  it('handles DD=00 in February (leap year)', () => {
    const r = parseGS1('(17)240200')
    expect(r!.vencimiento).toBe('2024-02-29')
  })

  it('maps YY to the 21st century', () => {
    const r = parseGS1('(17)301231')
    expect(r!.vencimiento).toBe('2030-12-31')
  })
})

describe('parseGS1 — non-GS1 / invalid input', () => {
  it('returns null for a plain EAN-13 with no AIs', () => {
    expect(parseGS1('7501234567890')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(parseGS1('')).toBeNull()
    expect(parseGS1('   ')).toBeNull()
  })

  it('returns null for a bare lot string', () => {
    expect(parseGS1('LOTE123')).toBeNull()
  })

  it('keeps the original input in raw', () => {
    const input = '(01)07501234567890'
    expect(parseGS1(input)!.raw).toBe(input)
  })
})

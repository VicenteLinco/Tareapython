/**
 * Minimal GS1 Application Identifier parser for inventory scanning.
 *
 * A GS1-128 barcode or GS1 DataMatrix encodes several fields in one symbol via
 * Application Identifiers (AIs). For clinical inventory the relevant ones are:
 *
 *   (01) GTIN            — 14 digits, the commercial trade item
 *   (17) expiry date     — YYMMDD
 *   (11) production date — YYMMDD
 *   (10) batch / lot     — variable length (alphanumeric)
 *   (21) serial number   — variable length
 *
 * The parser accepts three real-world encodings:
 *   - Human-readable brackets:  (01)07501234567890(17)260815(10)LOTE123
 *   - FNC1-separated / plain:    0107501234567890172608 15...  with \x1d (GS)
 *     terminating variable-length AIs that are followed by another AI.
 *   - Plain concatenated when only fixed-length AIs precede a final variable AI.
 *
 * Returns `null` when the input is not GS1 (e.g. a bare EAN-13 or a lot code),
 * so callers can fall back to plain code matching.
 */

const GS = '\x1d' // FNC1 / group separator

// Data length (excluding the 2-digit AI) for the fixed-length AIs we support.
const AI_FIXED: Record<string, number> = {
  '01': 14, // GTIN
  '11': 6, // production date YYMMDD
  '17': 6, // expiry date YYMMDD
}

// Variable-length AIs we support (terminated by GS or end of string).
const AI_VARIABLE = new Set(['10', '21'])

export interface GS1ParseResult {
  gtin?: string
  lote?: string
  vencimiento?: string // ISO YYYY-MM-DD
  fechaProduccion?: string // ISO YYYY-MM-DD
  serial?: string
  raw: string
}

/** Converts a GS1 YYMMDD field to ISO. DD=00 means the last day of the month. */
function parseGS1Date(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined
  const year = 2000 + Number(yymmdd.slice(0, 2))
  const month = Number(yymmdd.slice(2, 4))
  let day = Number(yymmdd.slice(4, 6))
  if (month < 1 || month > 12) return undefined
  if (day === 0) day = new Date(year, month, 0).getDate() // last day of month
  if (day < 1 || day > 31) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Extracts (AI, data) pairs from the bracketed notation: (01)...(17)...(10)... */
function parseBracketed(input: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = []
  const re = /\((\d{2,4})\)\s*([^(]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) pairs.push([m[1], m[2].trim()])
  return pairs.length > 0 ? pairs : null
}

/** Extracts (AI, data) pairs from a concatenated / FNC1-separated string. */
function parsePlain(input: string): Array<[string, string]> | null {
  const s = input.replace(/[^\x1d\S]/g, '') // strip whitespace, keep GS
  const pairs: Array<[string, string]> = []
  let i = 0
  while (i < s.length) {
    if (s[i] === GS) {
      i++
      continue
    }
    const ai = s.slice(i, i + 2)
    if (!/^\d{2}$/.test(ai)) break // not an AI here → stop
    i += 2

    if (ai in AI_FIXED) {
      const len = AI_FIXED[ai]
      pairs.push([ai, s.slice(i, i + len)])
      i += len
    } else {
      // Variable-length (known or unknown): read until GS or end of string.
      let end = s.indexOf(GS, i)
      if (end === -1) end = s.length
      if (AI_VARIABLE.has(ai)) pairs.push([ai, s.slice(i, end)])
      i = end
    }
  }
  return pairs.length > 0 ? pairs : null
}

export function parseGS1(input: string): GS1ParseResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const pairs = trimmed.includes('(')
    ? parseBracketed(trimmed)
    : parsePlain(trimmed)
  if (!pairs) return null

  const result: GS1ParseResult = { raw: input }
  let found = false
  for (const [ai, data] of pairs) {
    if (!data) continue
    switch (ai) {
      case '01':
        result.gtin = data
        found = true
        break
      case '17': {
        const d = parseGS1Date(data)
        if (d) {
          result.vencimiento = d
          found = true
        }
        break
      }
      case '11': {
        const d = parseGS1Date(data)
        if (d) {
          result.fechaProduccion = d
          found = true
        }
        break
      }
      case '10':
        result.lote = data
        found = true
        break
      case '21':
        result.serial = data
        found = true
        break
    }
  }

  return found ? result : null
}

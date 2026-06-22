/**
 * GTIN helpers for manual assignment and scan capture.
 *
 * A GTIN (Global Trade Item Number) carries a trailing mod-10 check digit.
 * The backend only validates length (13 or 14 digits); these helpers add the
 * check-digit validation so typos are caught in the UI before saving.
 */

import { parseGS1 } from './gs1'

/**
 * Computes the mod-10 check digit for a GTIN payload (all digits except the
 * trailing check digit). Weights alternate 3,1,3,1… starting from the rightmost
 * payload digit. The length of the payload does not matter, so this works for
 * GTIN-13 and GTIN-14 alike.
 */
export function gtinCheckDigit(payload: string): number {
  let sum = 0
  const reversed = payload.split('').reverse()
  for (let i = 0; i < reversed.length; i++) {
    const digit = Number(reversed[i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10
}

/** True when `gtin` is 13 or 14 digits with a valid mod-10 check digit. */
export function isValidGtin(gtin: string): boolean {
  if (!/^\d+$/.test(gtin)) return false
  if (gtin.length !== 13 && gtin.length !== 14) return false
  const payload = gtin.slice(0, -1)
  const check = Number(gtin.slice(-1))
  return gtinCheckDigit(payload) === check
}

/**
 * Extracts a GTIN candidate from a scanned symbol. GS1 barcodes (DataMatrix /
 * GS1-128) carry the GTIN in AI (01); a bare EAN-13 returns the raw digits.
 * Returns null when nothing GTIN-shaped (13–14 digits) can be recovered.
 */
export function extractGtinFromScan(raw: string): string | null {
  const parsed = parseGS1(raw)
  if (parsed?.gtin) return parsed.gtin

  const digits = raw.replace(/\D/g, '')
  if (digits.length === 13 || digits.length === 14) return digits
  return null
}

import { describe, it, expect } from "vitest";
import { gtinCheckDigit, isValidGtin, extractGtinFromScan } from "./gtin";

describe("gtinCheckDigit", () => {
  it("computes the mod-10 check digit for a GTIN-13 payload", () => {
    // 4006381333931 is a real EAN-13; payload = first 12 digits, check = 1
    expect(gtinCheckDigit("400638133393")).toBe(1);
  });

  it("computes the mod-10 check digit for a GTIN-14 payload", () => {
    // 00012345678905 — payload = first 13 digits, check = 5
    expect(gtinCheckDigit("0001234567890")).toBe(5);
  });

  it("returns 0 when the weighted sum is already a multiple of 10", () => {
    // payload 0 → weighted sum 0 → check digit 0
    expect(gtinCheckDigit("0")).toBe(0);
  });
});

describe("isValidGtin", () => {
  it("accepts a valid GTIN-13", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
  });

  it("accepts a valid GTIN-14", () => {
    expect(isValidGtin("00012345678905")).toBe(true);
  });

  it("rejects a GTIN with a wrong check digit", () => {
    expect(isValidGtin("4006381333930")).toBe(false);
  });

  it("rejects lengths other than 13 or 14", () => {
    expect(isValidGtin("400638133")).toBe(false); // too short
    expect(isValidGtin("123456789012")).toBe(false); // 12 (UPC-A not accepted)
    expect(isValidGtin("400638133393100")).toBe(false); // too long
  });

  it("rejects non-digit input", () => {
    expect(isValidGtin("40063813339A1")).toBe(false);
    expect(isValidGtin("")).toBe(false);
  });
});

describe("extractGtinFromScan", () => {
  it("extracts the GTIN (AI 01) from a GS1 payload", () => {
    const r = extractGtinFromScan("(01)00012345678905(17)260815(10)LOTE1");
    expect(r).toBe("00012345678905");
  });

  it("falls back to a bare EAN-13 scan", () => {
    expect(extractGtinFromScan("4006381333931")).toBe("4006381333931");
  });

  it("strips surrounding whitespace and separators from a bare scan", () => {
    expect(extractGtinFromScan("  4006381333931 ")).toBe("4006381333931");
  });

  it("returns null when no GTIN-shaped value can be found", () => {
    expect(extractGtinFromScan("LOTE-ABC")).toBeNull();
  });

  it("extracts unbracketed GS1 GTIN AI(01) from raw scanner input", () => {
    const r = extractGtinFromScan("01000123456789051726081510LOTE1");
    expect(r).toBe("00012345678905");
  });

  it("normalizes GTIN-13 to 14 digits with leading zero when required", () => {
    expect(extractGtinFromScan("(01)04006381333931")).toBe("04006381333931");
  });
});

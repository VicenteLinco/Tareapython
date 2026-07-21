import { describe, expect, it } from "vitest";
import {
  validateImportedGuideItem,
  normalizeImportedDate,
  parseCurrencyInput,
} from "./importador-guia-validation";

describe("validateImportedGuideItem", () => {
  it("marks an empty normalized product name as invalid", () => {
    expect(validateImportedGuideItem({
      nombre_producto: "",
      lote: null,
      fecha_vencimiento: null,
      control_lote: "simple",
    })).toEqual({ nombre_producto: true });
  });

  it("accepts a corrected name for a simple item", () => {
    expect(validateImportedGuideItem({
      nombre_producto: "Reactivo corregido",
      lote: null,
      fecha_vencimiento: null,
      control_lote: "simple",
    })).toEqual({});
  });
});

describe("normalizeImportedDate", () => {
  it("normalizes DD/MM/YYYY to YYYY-MM-DD", () => {
    expect(normalizeImportedDate("31/12/2027")).toBe("2027-12-31");
    expect(normalizeImportedDate("5/3/2026")).toBe("2026-03-05");
  });

  it("normalizes ISO timestamp to YYYY-MM-DD", () => {
    expect(normalizeImportedDate("2027-12-31T00:00:00Z")).toBe("2027-12-31");
  });

  it("returns null for invalid strings", () => {
    expect(normalizeImportedDate("invalid")).toBeNull();
    expect(normalizeImportedDate(null)).toBeNull();
  });
});

describe("parseCurrencyInput", () => {
  it("parses numeric strings with currency symbol", () => {
    expect(parseCurrencyInput("$25000")).toBe(25000);
    expect(parseCurrencyInput(" $ 12.500 ")).toBe(12500);
  });

  it("parses decimal values correctly", () => {
    expect(parseCurrencyInput("2500.50")).toBe(2500.5);
  });
});

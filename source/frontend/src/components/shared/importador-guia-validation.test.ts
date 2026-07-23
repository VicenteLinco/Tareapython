import { describe, expect, it } from "vitest";
import {
  validateImportedGuideItem,
  normalizeImportedDate,
  parseCurrencyInput,
  autoFixGuideItem,
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

describe("autoFixGuideItem", () => {
  it("auto-corrects empty product names, zero quantities, and missing lot/expiry controls", () => {
    const invalidItem = {
      nombre_producto: "   ",
      cantidad: 0,
      control_lote: "con_vto" as const,
      lote: null,
      fecha_vencimiento: null,
    };

    // Before fix: validateImportedGuideItem fails with errors
    const errorsBefore = validateImportedGuideItem(invalidItem);
    expect(Object.keys(errorsBefore).length).toBeGreaterThan(0);

    // Run autoFixGuideItem
    const fixedItem = autoFixGuideItem(invalidItem, 0);

    // After fix:
    // 1. Name defaulted to 'Producto Ítem 1'
    expect(fixedItem.nombre_producto).toBe("Producto Ítem 1");
    // 2. Quantity defaulted to 1
    expect(fixedItem.cantidad).toBe(1);
    // 3. Control lote switched to 'simple' because lote/vto were missing
    expect(fixedItem.control_lote).toBe("simple");

    // 4. validateImportedGuideItem now returns 0 errors!
    const errorsAfter = validateImportedGuideItem(fixedItem);
    expect(errorsAfter).toEqual({});
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

  it("normalizes dot dates, 2-digit year dates, and MM/YYYY format", () => {
    expect(normalizeImportedDate("31.12.2027")).toBe("2027-12-31");
    expect(normalizeImportedDate("31/12/27")).toBe("2027-12-31");
    expect(normalizeImportedDate("12/2027")).toBe("2027-12-28");
    expect(normalizeImportedDate("2027.12.31")).toBe("2027-12-31");
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

describe("matchClinicalSynonym & calculateLevenshteinSimilarity", () => {
  it("matches clinical synonyms with high confidence score", () => {
    const score = matchClinicalSynonym("Suero Fisiologico 500ml", "Cloruro de Sodio 0.9%");
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it("calculates Levenshtein similarity for fuzzy strings", () => {
    const score = calculateLevenshteinSimilarity("Alcohol Gel 70%", "Alcohol Gel 70% 500ml");
    expect(score).toBeGreaterThan(0.6);
  });
});


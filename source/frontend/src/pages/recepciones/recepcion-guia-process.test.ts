import { describe, expect, it } from "vitest";
import {
  validateImportedGuideItem,
  normalizeImportedDate,
  parseCurrencyInput,
  autoFixGuideItem,
} from "../../components/shared/importador-guia-validation";
import { parseConfiguredAiModels } from "../../components/shared/ai-model-options";

describe("Guía Process Unit Tests & Edge Cases", () => {
  it("handles complex guide item validation with lot and expiration date", () => {
    const validItem = {
      nombre_producto: "Alcohol Desnaturalizado 70%",
      lote: "LOT-2026-99",
      fecha_vencimiento: "2027-11-30",
      control_lote: "con_vto" as const,
      cantidad: 25,
      precio_unitario: "3500.00",
    };
    expect(validateImportedGuideItem(validItem)).toEqual({});
  });

  it("fails validation when control_lote is con_vto but date is invalid", () => {
    const invalidDateItem = {
      nombre_producto: "Reactivo Químico A",
      lote: "LOT-123",
      fecha_vencimiento: "invalid-date",
      control_lote: "con_vto" as const,
      cantidad: 10,
    };
    const errors = validateImportedGuideItem(invalidDateItem);
    expect(errors.fecha_vencimiento).toBe(true);
  });

  it("handles edge cases in parseCurrencyInput with dots, commas, and CLP formatting", () => {
    expect(parseCurrencyInput("1.250.000")).toBe(1250000);
    expect(parseCurrencyInput("1,250,000")).toBe(1250000);
    expect(parseCurrencyInput("CLP $45.990")).toBe(45990);
    expect(parseCurrencyInput("0")).toBe(0);
    expect(parseCurrencyInput("-")).toBeNull();
  });

  it("parses AI model JSON configuration correctly", () => {
    const configString = JSON.stringify([
      { id: "gpt-4o", name: "GPT-4o Vision", provider: "openai", model: "gpt-4o" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", model: "gemini-2.5-flash" },
    ]);
    const models = parseConfiguredAiModels(configString);
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("gpt-4o");
    expect(models[0].label).toContain("GPT-4o Vision");
    expect(models[1].id).toBe("gemini-2.5-flash");
  });

  it("returns empty list when configString is empty or null", () => {
    const models = parseConfiguredAiModels(null);
    expect(models).toEqual([]);
  });
});

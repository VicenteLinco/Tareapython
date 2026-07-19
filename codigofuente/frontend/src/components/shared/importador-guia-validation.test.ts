import { describe, expect, it } from "vitest";
import { validateImportedGuideItem } from "./importador-guia-validation";

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

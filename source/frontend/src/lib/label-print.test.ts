import { describe, expect, it } from "vitest";
import { generarComandoZPL, generarComandoTSPL, type LoteParaEtiqueta } from "./label-print";

describe("Direct Thermal Label Command Generators (ZPL / TSPL)", () => {
  const mockLotes: LoteParaEtiqueta[] = [
    {
      lote_id: "123e4567-e89b-12d3-a456-426614174000",
      numero_lote: "LOTE-2026-X",
      fecha_vencimiento: "2027-12-31",
      producto_nombre: "Cloruro de Sodio 0.9% 500ml",
      presentacion_nombre: "Frasco",
      area_nombre: "Laboratorio Central",
      cantidad_etiquetas: 2,
    },
  ];

  it("generates valid ZPL command block with ^XA and ^XZ", () => {
    const zpl = generarComandoZPL(mockLotes);
    expect(zpl).toContain("^XA");
    expect(zpl).toContain("^XZ");
    expect(zpl).toContain("Cloruro de Sodio 0.9%");
    expect(zpl).toContain("LOTE-2026-X");
    expect(zpl).toContain("^PQ2");
  });

  it("generates valid TSPL command block with SIZE, GAP and PRINT", () => {
    const tspl = generarComandoTSPL(mockLotes);
    expect(tspl).toContain("SIZE 50 mm,25 mm");
    expect(tspl).toContain("LOTE-2026-X");
    expect(tspl).toContain("PRINT 2,1");
  });
});

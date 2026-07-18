import { describe, it, expect } from "vitest";
import type { ConteoItem, Presentacion } from "@/types";
import { resolverScanConteo } from "./scan-utils";

function item(id: string, productoId: string, numeroLote: string): ConteoItem {
  return { id, producto_id: productoId, numero_lote: numeroLote } as ConteoItem;
}
function pres(
  productoId: string,
  opts: { gtin?: string; codigo_barras?: string },
): Presentacion {
  return {
    producto_id: productoId,
    gtin: opts.gtin ?? null,
    codigo_barras: opts.codigo_barras ?? null,
  } as unknown as Presentacion;
}

const GS1 = "(01)07501234567890(10)LOTE123";

describe("resolverScanConteo — GS1", () => {
  it("GS1 con lote presente en la sesión → lote exacto", () => {
    const items = [item("I1", "P1", "LOTE123"), item("I2", "P1", "OTRO")];
    const r = resolverScanConteo(GS1, items, []);
    expect(r.kind).toBe("lote");
    if (r.kind !== "lote") return;
    expect(r.item.id).toBe("I1");
  });

  it("GS1 cuyo lote no está, pero el GTIN matchea un producto con 1 solo lote → ese lote", () => {
    const items = [item("I1", "P1", "NO-COINCIDE")];
    const presentaciones = [pres("P1", { gtin: "07501234567890" })];
    const r = resolverScanConteo(GS1, items, presentaciones);
    expect(r.kind).toBe("lote");
    if (r.kind !== "lote") return;
    expect(r.item.id).toBe("I1");
  });

  it("GS1 cuyo lote no está y el GTIN matchea un producto con varios lotes → elegir", () => {
    const items = [item("I1", "P1", "L-A"), item("I2", "P1", "L-B")];
    const presentaciones = [pres("P1", { gtin: "07501234567890" })];
    const r = resolverScanConteo(GS1, items, presentaciones);
    expect(r.kind).toBe("elegir");
    if (r.kind !== "elegir") return;
    expect(r.items.map((i) => i.id)).toEqual(["I1", "I2"]);
  });

  it("match de lote es case-insensitive", () => {
    const items = [item("I1", "P1", "lote123")];
    const r = resolverScanConteo(GS1, items, []);
    expect(r.kind).toBe("lote");
  });
});

describe("resolverScanConteo — código plano (sin GS1)", () => {
  it("código = numero_lote exacto → lote", () => {
    const items = [item("I1", "P1", "AB-99")];
    const r = resolverScanConteo("AB-99", items, []);
    expect(r.kind).toBe("lote");
    if (r.kind !== "lote") return;
    expect(r.item.id).toBe("I1");
  });

  it("código = codigo_barras de presentación, 1 lote → lote", () => {
    const items = [item("I1", "P1", "X")];
    const presentaciones = [pres("P1", { codigo_barras: "12345" })];
    const r = resolverScanConteo("12345", items, presentaciones);
    expect(r.kind).toBe("lote");
  });

  it("nada matchea → no-match", () => {
    const r = resolverScanConteo("ZZZ", [item("I1", "P1", "A")], []);
    expect(r.kind).toBe("no-match");
  });

  it("código vacío → no-match", () => {
    expect(resolverScanConteo("   ", [], []).kind).toBe("no-match");
  });
});

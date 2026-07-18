import { describe, it, expect } from "vitest";
import type { StockItem } from "@/types";
import {
  getEstado,
  esSinStock,
  esBajo,
  esPorVencer30,
  ESTADO_LABEL,
} from "./stock-pdf-estado";

// Minimal StockItem factory: only the fields the estado classification reads.
function item(overrides: Partial<StockItem>): StockItem {
  return {
    producto_id: "p1",
    codigo_interno: "COD-1",
    producto_nombre: "Reactivo",
    categoria: null,
    unidad: "unidad",
    unidad_plural: "unidades",
    stock_total: 0,
    proximo_vencimiento: null,
    proveedor_nombre: null,
    proveedor_icono: null,
    ...overrides,
  };
}

// Date helper: ISO string N days from today.
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

describe("getEstado — taxonomía de estados del PDF", () => {
  it("clasifica agotado como SIN STOCK, nunca como bajo (regresión reportada)", () => {
    const it1 = item({ estado_cantidad: "agotado" });
    expect(getEstado(it1)).toBe("sin_stock");
    expect(esSinStock(it1)).toBe(true);
    expect(esBajo(it1)).toBe(false);
  });

  it("usa el enum legado estado_alerta como fallback cuando no hay estado_cantidad", () => {
    expect(getEstado(item({ estado_alerta: "agotado" }))).toBe("sin_stock");
    expect(getEstado(item({ estado_alerta: "critico" }))).toBe("bajo");
  });

  it("clasifica critico y reponer como bajo", () => {
    expect(getEstado(item({ estado_cantidad: "critico" }))).toBe("bajo");
    expect(getEstado(item({ estado_cantidad: "reponer" }))).toBe("bajo");
  });

  it("prioriza sin stock sobre vencido", () => {
    expect(
      getEstado(
        item({ estado_cantidad: "agotado", estado_vencimiento: "vencido" }),
      ),
    ).toBe("sin_stock");
  });

  it("clasifica vencido cuando hay stock usable", () => {
    expect(
      getEstado(
        item({ estado_cantidad: "normal", estado_vencimiento: "vencido" }),
      ),
    ).toBe("vencido");
  });

  it("clasifica por vencer dentro de 30 días", () => {
    const it1 = item({
      estado_cantidad: "normal",
      proximo_vencimiento: inDays(15),
    });
    expect(esPorVencer30(it1)).toBe(true);
    expect(getEstado(it1)).toBe("vencer");
  });

  it("NO marca por vencer un vencimiento lejano (> 30 días)", () => {
    const it1 = item({
      estado_cantidad: "normal",
      proximo_vencimiento: inDays(120),
    });
    expect(esPorVencer30(it1)).toBe(false);
    expect(getEstado(it1)).toBe(null);
  });

  it('un vencimiento ya pasado no cuenta como "por vencer 30d"', () => {
    expect(esPorVencer30(item({ proximo_vencimiento: inDays(-5) }))).toBe(
      false,
    );
  });

  it("prioriza por vencer sobre bajo cuando coinciden", () => {
    const it1 = item({
      estado_cantidad: "reponer",
      proximo_vencimiento: inDays(10),
    });
    expect(getEstado(it1)).toBe("vencer");
  });

  it("devuelve null para un ítem normal sin alertas", () => {
    expect(getEstado(item({ estado_cantidad: "normal" }))).toBe(null);
  });

  it("los rótulos visibles cubren todos los estados no nulos", () => {
    expect(ESTADO_LABEL.sin_stock).toBe("SIN STOCK");
    expect(ESTADO_LABEL.bajo).toBe("Bajo");
    expect(ESTADO_LABEL.vencer).toBe("Por vencer");
    expect(ESTADO_LABEL.vencido).toBe("Vencido");
  });
});

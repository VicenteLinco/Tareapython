// frontend/src/pages/solicitudes-compra/solicitud-utils.ts
import { formatCantidad, formatPrecio } from "@/lib/utils";
import type { SolicitudItem } from "@/types";
import api from "@/lib/api";
import { toDecimal, type DecimalInput } from "@/domain/parse";

export const HORIZONTE_CHIPS = [7, 15, 30, 90, 180, 365] as const;
export type HorizonChip = (typeof HORIZONTE_CHIPS)[number];

/** Calcula unidades a pedir dado un horizonte de cobertura. */
export function calcularCantidad(
  horizonte: number,
  consumoDiario: DecimalInput,
  leadTime: number,
  stockMinimo: DecimalInput,
  stockActual: DecimalInput,
  factorConversion?: DecimalInput,
): number {
  const base = toDecimal(stockMinimo)
    .plus(toDecimal(consumoDiario).times(leadTime + horizonte))
    .minus(toDecimal(stockActual))
    .ceil();
  const requerido = base.lt(1) ? toDecimal(1) : base;
  const fc = toDecimal(factorConversion);

  if (fc.gt(0)) {
    const presentaciones = requerido.dividedBy(fc).ceil();
    return (presentaciones.lt(1) ? toDecimal(1) : presentaciones).toNumber();
  }

  return requerido.toNumber();
}

/** Dias de stock cubiertos con la cantidad actual del item. */
export function calcularDiasCubiertos(item: SolicitudItem): number | null {
  const consumoDiario = toDecimal(item.consumo_diario);
  if (consumoDiario.lte(0)) return null;
  const unidadesBase = item.factor_conversion
    ? toDecimal(item.cantidad).times(item.factor_conversion)
    : toDecimal(item.cantidad);
  return unidadesBase.dividedBy(consumoDiario).round().toNumber();
}

/** Clases CSS del pill de cobertura segun dias cubiertos. */
export function pillClasses(
  dias: number | null,
  personalizado: boolean,
): string {
  if (personalizado)
    return "bg-purple-500/10 text-purple-300 border-purple-500/30";
  if (dias === null) return "bg-base-200 text-base-content/40 border-base-300";
  if (dias < 15) return "bg-error/10 text-error border-error/30";
  if (dias < 30) return "bg-warning/10 text-warning border-warning/30";
  if (dias < 90) return "bg-success/10 text-success border-success/30";
  return "bg-info/10 text-info border-info/30";
}

/** Texto del pill de cobertura. */
export function pillText(dias: number | null, personalizado: boolean): string {
  if (dias === null) return "📅 Sin historial";
  return personalizado ? `📌 ~${dias} días` : `📅 ~${dias} días`;
}

/** Etiqueta de unidad para un item (presentacion o unidad base). */
export function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return formatCantidad(
      qty,
      item.presentacion_nombre,
      item.presentacion_nombre_plural ?? undefined,
    )
      .replace(/^[\d.,\s]+/, "")
      .trim();
  }
  return formatCantidad(
    qty,
    item.unidad_base,
    item.unidad_base_plural ?? undefined,
  )
    .replace(/^[\d.,\s]+/, "")
    .trim();
}

/** Formatea un valor como moneda. */
export function formatPesos(val: DecimalInput, monedaCodigo = "CLP"): string {
  return formatPrecio(val, monedaCodigo);
}

/** Llama al backend para obtener el horizonte sugerido de un producto. */
export async function fetchHorizonte(
  productoId: string,
  proveedorId: number | null,
) {
  if (!proveedorId) {
    return {
      horizonte_sugerido: 30,
      razon: "sin proveedor — estimación por defecto",
      consumo_diario: 0,
      consumo_diario_forecast: 0,
      consumo_diario_planificacion: 0,
      tipo_estimacion_demanda: "sin_proveedor" as const,
      stock_actual: 0,
      stock_minimo: 0,
      precio_ultimo: null as number | null,
    };
  }
  const res = await api.get<{
    horizonte_sugerido: number;
    razon: string;
    consumo_diario: number;
    consumo_diario_forecast: number;
    consumo_diario_planificacion: number;
    tipo_estimacion_demanda:
      | "forecast"
      | "historial_corto"
      | "sin_historial"
      | "sin_proveedor";
    stock_actual: number;
    stock_minimo: number;
    precio_ultimo: number | null;
  }>("/solicitudes-compra/horizonte", {
    params: { producto_id: productoId, proveedor_id: proveedorId },
  });
  return res.data;
}

/** Etiqueta legible para un numero de dias de horizonte. */
export function horizonLabel(d: number): string {
  if (d >= 365) return "1 año";
  if (d >= 180) return "6m";
  if (d >= 90) return "3m";
  return `${d}d`;
}

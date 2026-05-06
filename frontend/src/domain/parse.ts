/**
 * Transformaciones numéricas seguras para cantidades del inventario.
 * Usa Decimal para evitar errores de punto flotante en sumas y multiplicaciones
 * de cantidades en unidades base.
 *
 * Regla: nunca llamar parseFloat / Number() sobre cantidades fuera de este módulo.
 */

import Decimal from 'decimal.js'

Decimal.set({ rounding: Decimal.ROUND_HALF_UP, toExpPos: 20, toExpNeg: -7 })

/** Convierte cualquier valor de la API (string | number | null | undefined) a Decimal. */
export function toDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  try {
    return new Decimal(value)
  } catch {
    return new Decimal(0)
  }
}

/** Convierte a número JS para uso en UI (evitar usar Decimal directamente en JSX). */
export function toNum(value: string | number | null | undefined): number {
  return toDecimal(value).toNumber()
}

/** Convierte a entero redondeado para mostrar en UI. */
export function toInt(value: string | number | null | undefined): number {
  return toDecimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}

/** Suma segura de un array de cantidades. */
export function sumDecimal(values: (string | number | null | undefined)[]): Decimal {
  return values.reduce((acc, v) => acc.plus(toDecimal(v)), new Decimal(0))
}

/** Multiplica dos cantidades (ej. presentaciones × factor_conversion). */
export function mulDecimal(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): Decimal {
  return toDecimal(a).times(toDecimal(b))
}

/**
 * Calcula la cantidad sugerida para una solicitud de compra.
 * Reemplaza la función calcularCantidad dispersa en varios componentes.
 *
 * cantidad = max(0, horizonte_dias * consumo_diario + stock_minimo - stock_actual)
 * Si factor_conversion, convierte a presentaciones (ceil).
 */
export function calcularCantidadSugerida(
  horizonte: number,
  consumoDiario: string | number | null | undefined,
  stockMinimo: string | number | null | undefined,
  stockActual: string | number | null | undefined,
  factorConversion?: string | number | null,
): number {
  const demanda = toDecimal(consumoDiario).times(horizonte)
  const necesario = demanda.plus(toDecimal(stockMinimo)).minus(toDecimal(stockActual))
  const enBase = Decimal.max(0, necesario)
  if (factorConversion) {
    const fc = toDecimal(factorConversion)
    if (fc.gt(0)) return enBase.dividedBy(fc).ceil().toNumber()
  }
  return enBase.ceil().toNumber()
}

/**
 * Calcula el total recibido en unidades base para un detalle de recepción.
 * cantidad_lote_presentaciones × factor_conversion
 */
export function totalRecibidoBase(
  cantidadPresentaciones: string | number | null | undefined,
  factorConversion: string | number | null | undefined,
): number {
  return mulDecimal(cantidadPresentaciones, factorConversion).toNumber()
}

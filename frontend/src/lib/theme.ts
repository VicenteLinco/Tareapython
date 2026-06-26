// frontend/src/lib/theme.ts

export const STATUS_COLORS = {
  vencido: "bg-error/10 text-error",
  critico: "bg-error/5 text-error/80",
  proximo: "bg-warning/10 text-warning",
  intermedio: "bg-yellow-50 text-yellow-700",
  disponible: "bg-success/10 text-success/80",
} as const;

/** Devuelve la clase Tailwind para un chip de días de autonomía. */
export function daysChipColor(days: number): string {
  if (days <= 0) return STATUS_COLORS.vencido;
  if (days <= 7) return STATUS_COLORS.critico;
  if (days <= 30) return STATUS_COLORS.proximo;
  if (days <= 90) return STATUS_COLORS.intermedio;
  return STATUS_COLORS.disponible;
}

/** Clases para badges de alerta de stock. */
export const STOCK_ALERT_COLORS = {
  sinStock: "bg-error/10 text-error border-error/20",
  stockBajo: "bg-warning/10 text-warning border-warning/20",
  normal: "bg-base-200/50 border-base-200",
} as const;

/** Clases para lotes vencidos / próximos a vencer en tablas. */
export const LOTE_ROW_COLORS = {
  vencido: "border-error/30 bg-error/5",
  proximo:
    "border-warning/30 bg-warning/5 ring-1 ring-warning/20 shadow-sm shadow-warning/10",
  normal: "border-base-200/60 bg-base-100",
} as const;

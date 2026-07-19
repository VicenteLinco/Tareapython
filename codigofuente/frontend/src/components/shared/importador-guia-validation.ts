export interface GuideItemForValidation {
  nombre_producto: string;
  lote: string | null;
  fecha_vencimiento: string | null;
  control_lote?: "trazable" | "con_vto" | "simple";
}

export function validateImportedGuideItem(
  item: GuideItemForValidation,
): Record<string, boolean> {
  const errors: Record<string, boolean> = {};
  if (!item.nombre_producto?.trim()) errors.nombre_producto = true;

  if (item.control_lote !== "simple") {
    if (!item.lote?.trim()) errors.lote = true;
    if (!item.fecha_vencimiento || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_vencimiento)) {
      errors.fecha_vencimiento = true;
    }
  }
  return errors;
}

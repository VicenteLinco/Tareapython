// frontend/src/pages/ordenes-compra/utils.ts
import type { OrdenCompraResumen } from "@/types";

export const ESTADO_LABEL: Record<OrdenCompraResumen["estado"], string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};

export const ESTADO_BADGE_CLASS: Record<OrdenCompraResumen["estado"], string> =
  {
    borrador: "bg-gray-100 text-gray-700",
    enviada: "bg-blue-100 text-blue-700",
    recibida_parcial: "bg-amber-100 text-amber-700",
    recibida_total: "bg-green-100 text-green-700",
    cancelada: "bg-red-100 text-red-700",
  };

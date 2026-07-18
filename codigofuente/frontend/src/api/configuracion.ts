// Dominio: configuración del sistema
import api from "@/lib/api";

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface Configuracion {
  nombre_laboratorio: string;
  moneda_codigo: string;
  moneda_simbolo: string;
  conteo_periodo_dias: number;
  logo_base64?: string | null;
  [key: string]: unknown;
}

export type UpdateConfiguracion = Partial<
  Omit<Configuracion, "logo_base64">
> & {
  logo_base64?: string | null;
};

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /configuracion — Obtener configuración actual del sistema */
export async function obtenerConfiguracion(): Promise<Configuracion> {
  const { data } = await api.get<Configuracion>("/configuracion");
  return data;
}

/** PUT /configuracion — Actualizar configuración del sistema */
export async function actualizarConfiguracion(
  payload: UpdateConfiguracion,
): Promise<Configuracion> {
  const { data } = await api.put<Configuracion>("/configuracion", payload);
  return data;
}

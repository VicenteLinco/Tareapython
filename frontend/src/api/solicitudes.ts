// Dominio: solicitudes de compra
import api from "@/lib/api";
import type {
  SolicitudResumen,
  SolicitudDetalle,
  ItemRecomendado,
  UpdateSolicitudRequest,
  RegistrarEnvioInput,
  CancelarEnvioInput,
  CreateSolicitudItem,
} from "@/types";

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface SolicitudesQuery {
  estado?: string | null;
  page?: number;
  per_page?: number;
  q?: string | null;
}

export interface RecomendacionesQuery {
  area_id?: number | null;
  horizonte_dias?: number;
}

export interface CreateSolicitudRequest {
  nota?: string | null;
  items: CreateSolicitudItem[];
}

export interface GuardarSolicitudResponse {
  id: string;
  numero_documento: string;
  estado: string;
}

export interface CancelarSolicitudRequest {
  motivo?: string | null;
}

export interface PaginatedSolicitudes {
  data: SolicitudResumen[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /solicitudes-compra — Listar solicitudes con filtros */
export async function listarSolicitudes(
  params?: SolicitudesQuery,
): Promise<PaginatedSolicitudes> {
  const { data } = await api.get<PaginatedSolicitudes>("/solicitudes-compra", {
    params,
  });
  return data;
}

/** GET /solicitudes-compra/:id — Detalle completo de una solicitud */
export async function detalleSolicitud(id: string): Promise<SolicitudDetalle> {
  const { data } = await api.get<SolicitudDetalle>(`/solicitudes-compra/${id}`);
  return data;
}

/** GET /solicitudes-compra/borrador — Obtener borrador activo del usuario */
export async function borradorSolicitud(): Promise<SolicitudDetalle | null> {
  const { data } = await api.get<SolicitudDetalle | null>(
    "/solicitudes-compra/borrador",
  );
  return data;
}

/** GET /solicitudes-compra/recomendaciones — Recomendaciones de compra basadas en stock */
export async function recomendacionesSolicitud(
  params?: RecomendacionesQuery,
): Promise<ItemRecomendado[]> {
  const { data } = await api.get<ItemRecomendado[]>(
    "/solicitudes-compra/recomendaciones",
    { params },
  );
  return data;
}

/** POST /solicitudes-compra — Crear nueva solicitud */
export async function crearSolicitud(
  payload: CreateSolicitudRequest,
): Promise<SolicitudDetalle> {
  const { data } = await api.post<SolicitudDetalle>(
    "/solicitudes-compra",
    payload,
  );
  return data;
}

/** PUT /solicitudes-compra/:id — Actualizar ítems y nota de una solicitud borrador */
export async function actualizarSolicitud(
  id: string,
  payload: UpdateSolicitudRequest,
): Promise<SolicitudDetalle> {
  const { data } = await api.put<SolicitudDetalle>(
    `/solicitudes-compra/${id}`,
    payload,
  );
  return data;
}

/** POST /solicitudes-compra/:id/guardar — Finalizar borrador → estado "guardada" */
export async function guardarSolicitud(
  id: string,
): Promise<GuardarSolicitudResponse> {
  const { data } = await api.post<GuardarSolicitudResponse>(
    `/solicitudes-compra/${id}/guardar`,
    {},
  );
  return data;
}

/** POST /solicitudes-compra/:id/cancelar — Cancelar solicitud */
export async function cancelarSolicitud(
  id: string,
  payload?: CancelarSolicitudRequest,
): Promise<void> {
  await api.post(`/solicitudes-compra/${id}/cancelar`, payload ?? {});
}

/** POST /solicitudes-compra/:id/envios — Registrar envío a un proveedor */
export async function registrarEnvio(
  id: string,
  payload: RegistrarEnvioInput,
): Promise<void> {
  await api.post(`/solicitudes-compra/${id}/envios`, payload);
}

/** DELETE /solicitudes-compra/:id/envios/:proveedorId — Cancelar envío a un proveedor */
export async function cancelarEnvio(
  id: string,
  proveedorId: number,
  payload: CancelarEnvioInput,
): Promise<void> {
  await api.delete(`/solicitudes-compra/${id}/envios/${proveedorId}`, {
    data: payload,
  });
}

/** GET /solicitudes-compra/:id/pdf — Generar PDF de solicitud (opcionalmente filtrado por proveedor) */
export async function generarPdfSolicitud(
  id: string,
  proveedorId?: number,
): Promise<Blob> {
  const { data } = await api.get<Blob>(`/solicitudes-compra/${id}/pdf`, {
    params:
      proveedorId !== undefined ? { proveedor_id: proveedorId } : undefined,
    responseType: "blob",
  });
  return data;
}

// Dominio: conteo de inventario
import api from '@/lib/api'
import type {
  PaginatedSesiones,
  SesionConteo,
  ConteoDetalle,
} from '@/types'

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface AreaPendiente {
  area_id: number
  area_nombre: string
  frecuencia_dias: number
  ultimo_conteo_confirmado: string | null
  dias_desde_ultimo: number | null
}

export interface ConteoQuery {
  estado?: string | null
  area_id?: number | null
  page?: number
  per_page?: number
}

export interface CrearSesionRequest {
  area_id: number
}

export interface CrearSesionResponse {
  id: string
  total_items: number
}

export interface GuardarItemsRequest {
  items: {
    item_id: string
    cantidad_contada: number | null
    estado_item: string
    version: number
  }[]
}

export interface ConfirmarConteoRequest {
  nota?: string
}

export interface ConfirmarConteoResponse {
  ajustes_generados: number
}

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /conteo/pendientes — Áreas con conteo pendiente según frecuencia configurada */
export async function listarConteoPendientes(): Promise<AreaPendiente[]> {
  const { data } = await api.get<AreaPendiente[]>('/conteo/pendientes')
  return data
}

/** GET /conteo — Listar sesiones de conteo paginadas */
export async function listarSesionesConteo(params?: ConteoQuery): Promise<PaginatedSesiones> {
  const { data } = await api.get<PaginatedSesiones>('/conteo', { params })
  return data
}

/** POST /conteo — Crear nueva sesión de conteo para un área */
export async function crearSesionConteo(payload: CrearSesionRequest): Promise<CrearSesionResponse> {
  const { data } = await api.post<CrearSesionResponse>('/conteo', payload)
  return data
}

/** GET /conteo/:id — Detalle completo de una sesión (ítems + presentaciones) */
export async function detalleConteoCompleto(sesionId: string): Promise<ConteoDetalle> {
  const { data } = await api.get<ConteoDetalle>(`/conteo/${sesionId}`)
  return data
}

/** GET /conteo/:id — Obtener sesión (resumen sin ítems) */
export async function obtenerSesion(sesionId: string): Promise<SesionConteo> {
  const { data } = await api.get<ConteoDetalle>(`/conteo/${sesionId}`)
  return data.sesion
}

/** PATCH /conteo/:id/items — Guardar cambios parciales de ítems contados */
export async function guardarItemsConteo(sesionId: string, payload: GuardarItemsRequest): Promise<void> {
  await api.patch(`/conteo/${sesionId}/items`, payload)
}

/** POST /conteo/:id/confirmar — Confirmar sesión y aplicar ajustes de stock */
export async function confirmarConteo(sesionId: string, payload?: ConfirmarConteoRequest): Promise<ConfirmarConteoResponse> {
  const { data } = await api.post<ConfirmarConteoResponse>(`/conteo/${sesionId}/confirmar`, payload ?? {})
  return data
}

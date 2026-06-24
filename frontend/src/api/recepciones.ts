// Dominio: recepciones
import api from '@/lib/api'
import type {
  PaginatedRecepciones,
  RecepcionQuery,
  CreateRecepcion,
  SubirFotoInput,
  DetalleRecepcionRow,
  LoteCreado,
  RecepcionReconciliacionRow,
} from '@/types/generated'

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface RecepcionDetalle {
  id: string
  numero_documento: string
  proveedor_id: number
  proveedor_nombre: string
  proveedor_icono: string | null
  guia_despacho: string | null
  estado: string
  fecha_recepcion: string
  nota: string | null
  motivo_rechazo: string | null
  solicitud_id: string | null
  solicitud_numero: string | null
  usuario_nombre: string
  tiene_foto: boolean
  created_at: string
  detalles: DetalleRecepcionRow[]
  lotes_creados: LoteCreado[]
  reconciliacion: RecepcionReconciliacionRow[]
}

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /recepciones — Listar recepciones con filtros y paginación */
export async function listarRecepciones(params?: Partial<RecepcionQuery>): Promise<PaginatedRecepciones> {
  const { data } = await api.get<PaginatedRecepciones>('/recepciones', { params })
  return data
}

/** GET /recepciones/:id — Detalle completo de una recepción */
export async function detalleRecepcion(id: string): Promise<RecepcionDetalle> {
  const { data } = await api.get<RecepcionDetalle>(`/recepciones/${id}`)
  return data
}

/** POST /recepciones — Crear nueva recepción (puede quedar en borrador) */
export async function crearRecepcion(payload: CreateRecepcion): Promise<RecepcionDetalle> {
  const { data } = await api.post<RecepcionDetalle>('/recepciones', payload)
  return data
}

/** POST /recepciones/:id/confirmar — Confirmar recepción borrador */
export async function confirmarRecepcion(id: string, payload?: Record<string, unknown>): Promise<RecepcionDetalle> {
  const { data } = await api.post<RecepcionDetalle>(`/recepciones/${id}/confirmar`, payload ?? {})
  return data
}

/** DELETE /recepciones/:id — Eliminar recepción en estado borrador */
export async function eliminarBorrador(id: string): Promise<void> {
  await api.delete(`/recepciones/${id}`)
}

/** PUT /recepciones/:id/foto — Subir foto de guía de despacho */
export async function subirFoto(id: string, payload: SubirFotoInput): Promise<void> {
  await api.put(`/recepciones/${id}/foto`, payload)
}

export interface ParsedItem {
  nombre_producto: string
  sku_ref: string
  lote: string | null
  fecha_vencimiento: string | null
  cantidad: number
  precio_unitario: number | null
}

export interface ParseGuiaResponse {
  proveedor: string
  items: ParsedItem[]
}

/** POST /recepciones/parse-guia — Parsear texto de guía de despacho */
export async function parseGuia(raw_text: string): Promise<ParseGuiaResponse> {
  const { data } = await api.post<ParseGuiaResponse>('/recepciones/parse-guia', { raw_text })
  return data
}


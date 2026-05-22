// Dominio: stock, lotes, consumos, descartes
import api from '@/lib/api'
import type {
  StockItem,
  StockPorArea,
  AlertasResponse,
  Lote,
  PaginatedResponse,
  DescarteSession,
} from '@/types'
import type { DescarteRequest, DescarteResponse } from '@/types/generated'

// ─── Tipos de query/request locales ──────────────────────────────────────────

export interface StockQuery {
  area_id?: number | null
  categoria_id?: number | null
  q?: string | null
  bajo_minimo?: boolean
  page?: number
  per_page?: number
}

export interface StockAreaResponse {
  productos: StockPorArea[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface LoteQuery {
  producto_id?: string
  area_id?: number
  incluir_agotados?: boolean
  page?: number
  per_page?: number
}

export interface ConsumoRequest {
  producto_id: string
  area_id: number
  cantidad: number
  unidad?: 'base' | 'presentacion'
  presentacion_id?: number
  lote_id?: string
  nota?: string
}

export interface ConsumoResponse {
  grupo_movimiento: string
  movimientos: { id: string; numero_documento: string; cantidad: string; cantidad_resultante: string }[]
}

export interface ConsumoBatchRequest {
  area_id?: number
  items: {
    producto_id: string
    cantidad: number
    unidad: 'base' | 'presentacion'
    presentacion_id?: number
    lote_id?: string
    area_id?: number
  }[]
  nota?: string
}

export interface DescartesHistorialQuery {
  desde?: string | null
  hasta?: string | null
  area_id?: number | null
  page?: number
  per_page?: number
}

// ─── Stock ────────────────────────────────────────────────────────────────────

/** GET /stock — Listar stock global con filtros opcionales */
export async function listarStock(params?: StockQuery): Promise<{ data: StockItem[]; total: number; page: number; per_page: number; total_pages: number }> {
  const { data } = await api.get('/stock', { params })
  return data
}

/** GET /stock/area/:areaId — Stock por área (lotes individuales) */
export async function stockPorArea(areaId: number, params?: { page?: number; per_page?: number; q?: string }): Promise<StockAreaResponse> {
  const { data } = await api.get<StockAreaResponse>(`/stock/area/${areaId}`, { params })
  return data
}

/** GET /stock/alertas — Alertas de stock (bajo mínimo, por vencer, vencidos) */
export async function obtenerAlertas(): Promise<AlertasResponse> {
  const { data } = await api.get<AlertasResponse>('/stock/alertas')
  return data
}

// ─── Lotes ────────────────────────────────────────────────────────────────────

/** GET /lotes — Listar lotes con filtros */
export async function buscarLotes(params?: LoteQuery): Promise<PaginatedResponse<Lote>> {
  const { data } = await api.get<PaginatedResponse<Lote>>('/lotes', { params })
  return data
}

/** GET /lotes/:id — Detalle de un lote */
export async function detalleLote(loteId: string): Promise<Lote> {
  const { data } = await api.get<Lote>(`/lotes/${loteId}`)
  return data
}

/** GET /lotes/scan?codigo=:codigo — Buscar lote por código de barras */
export async function buscarLotePorCodigo(codigo: string): Promise<Lote> {
  const { data } = await api.get<Lote>('/lotes/scan', { params: { codigo } })
  return data
}

// ─── Consumos ─────────────────────────────────────────────────────────────────

/** POST /consumos — Registrar consumo individual (FEFO automático) */
export async function crearConsumo(payload: ConsumoRequest): Promise<ConsumoResponse> {
  const { data } = await api.post<ConsumoResponse>('/consumos', payload)
  return data
}

/** POST /consumos/batch — Registrar múltiples consumos en una operación */
export async function crearConsumoBatch(payload: ConsumoBatchRequest): Promise<ConsumoResponse> {
  const { data } = await api.post<ConsumoResponse>('/consumos/batch', payload)
  return data
}

// ─── Descartes ────────────────────────────────────────────────────────────────

/** POST /descartes — Registrar descarte masivo (vencidos o dañados) */
export async function crearDescarte(payload: DescarteRequest): Promise<DescarteResponse> {
  const { data } = await api.post<DescarteResponse>('/descartes', payload)
  return data
}

/** GET /descartes — Historial de descartes paginado */
export async function historicoDescartes(params?: DescartesHistorialQuery): Promise<PaginatedResponse<DescarteSession>> {
  const { data } = await api.get<PaginatedResponse<DescarteSession>>('/descartes', { params })
  return data
}

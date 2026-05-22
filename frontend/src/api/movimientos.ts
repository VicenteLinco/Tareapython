// Dominio: movimientos
import api from '@/lib/api'
import type { Movimiento, PaginatedResponse } from '@/types'

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface MovimientosQuery {
  tipo?: string | null
  area_id?: number | null
  producto_id?: string | null
  lote_id?: string | null
  desde?: string | null
  hasta?: string | null
  grupo_movimiento?: string | null
  page?: number
  per_page?: number
}

export interface TendenciasQuery {
  granularidad?: 'dia' | 'mes' | 'trimestre' | 'semestre' | 'anio'
  agrupar_por?: 'global' | 'area' | 'producto'
  area_id?: number | null
  producto_id?: string | null
  desde?: string | null
  hasta?: string | null
}

export interface TendenciaRow {
  periodo_inicio: string
  periodo_label: string
  area_id: number | null
  area_nombre: string | null
  producto_id: string | null
  producto_nombre: string | null
  unidad_base_nombre: string | null
  unidad_base_nombre_plural: string | null
  cantidad: number | string
  movimientos: number
  dias_con_consumo: number
}

export interface TendenciasResponse {
  granularidad: string
  agrupar_por: string
  desde: string | null
  hasta: string | null
  resumen: {
    total_consumido: number | string
    total_movimientos: number
    periodos_con_consumo: number
    promedio_por_periodo: number | string
    promedio_por_movimiento: number | string
  }
  series: TendenciaRow[]
}

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /movimientos — Listar movimientos paginados con filtros */
export async function listarMovimientos(params?: MovimientosQuery): Promise<PaginatedResponse<Movimiento>> {
  const { data } = await api.get<PaginatedResponse<Movimiento>>('/movimientos', { params })
  return data
}

/** GET /movimientos/:id — Detalle de un movimiento */
export async function detalleMovimiento(id: string): Promise<Movimiento> {
  const { data } = await api.get<Movimiento>(`/movimientos/${id}`)
  return data
}

/** GET /movimientos/tendencias — Análisis de tendencias de consumo */
export async function tendenciasMovimientos(params?: TendenciasQuery): Promise<TendenciasResponse> {
  const { data } = await api.get<TendenciasResponse>('/movimientos/tendencias', { params })
  return data
}

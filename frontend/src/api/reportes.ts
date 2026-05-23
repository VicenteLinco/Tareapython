import api from '@/lib/api'

export interface ConsumoAreaRow {
  area_id: number
  area_nombre: string
  mes: string
  total_consumido: number
  unidades_distintas: number
  movimientos_count: number
}

export interface TopDescartadoRow {
  producto_id: string
  producto_nombre: string
  total_descartado: number
  unidad: string
  movimientos_count: number
}

export interface ReporteParams {
  desde?: string
  hasta?: string
  limit?: number
}

export const reportesApi = {
  consumoArea: (params: ReporteParams) =>
    api.get<ConsumoAreaRow[]>('/reportes/consumo-area', { params }).then((r) => r.data),

  topDescartados: (params: ReporteParams) =>
    api.get<TopDescartadoRow[]>('/reportes/top-descartados', { params }).then((r) => r.data),
}

import api from "@/lib/api";

export interface ConsumoAreaRow {
  area_id: number;
  area_nombre: string;
  mes: string;
  total_consumido: number;
  unidades_distintas: number;
  movimientos_count: number;
}

export interface TopDescartadoRow {
  producto_id: string;
  producto_nombre: string;
  total_descartado: number;
  unidad: string;
  unidad_plural: string;
  movimientos_count: number;
}

export interface ReporteParams {
  desde?: string;
  hasta?: string;
  limit?: number;
  area_id?: number;
  producto_id?: string;
}

export interface ConsumoCalendarioRow {
  fecha: string;
  area_id: number;
  area_nombre: string;
  producto_id: string;
  producto_nombre: string;
  total_consumido: number;
  unidad: string;
  unidad_plural: string;
  movimientos_count: number;
  ultimo_consumo: string;
}

export interface ConsumoProductoRow {
  producto_id: string;
  producto_nombre: string;
  total_consumido: number;
  unidad: string;
  unidad_plural: string;
  dias_uso: number;
  areas_distintas: number;
  movimientos_count: number;
  ultimo_consumo: string;
}

export const reportesApi = {
  consumoArea: (params: ReporteParams) =>
    api
      .get<ConsumoAreaRow[]>("/reportes/consumo-area", { params })
      .then((r) => r.data),

  consumoCalendario: (params: ReporteParams) =>
    api
      .get<ConsumoCalendarioRow[]>("/reportes/consumo-calendario", { params })
      .then((r) => r.data),

  consumoProductos: (params: ReporteParams) =>
    api
      .get<ConsumoProductoRow[]>("/reportes/consumo-productos", { params })
      .then((r) => r.data),

  topDescartados: (params: ReporteParams) =>
    api
      .get<TopDescartadoRow[]>("/reportes/top-descartados", { params })
      .then((r) => r.data),
};

export * from './generated'

// --- Auth (Frontend Specific or Not Yet Generated) ---
export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface MeResponse {
  id: string
  nombre: string
  email: string
  rol: string
  area_ids: number[]
  version: number
}

// --- Frontend Specific Models or Complex Joins ---

export interface StockItem {
  producto_id: string
  codigo_interno: string
  producto_nombre: string
  categoria: string | null
  unidad: string
  unidad_plural: string | null
  stock_total: number | null
  stock_minimo: number
  dias_autonomia?: number
  lead_time_propio?: number
  proximo_vencimiento: string | null
  proveedor_nombre: string | null
  proveedor_icono: string | null
  imagen_url?: string | null
  area_id?: number
  area_nombre?: string
}

export interface StockPorArea {
  lote_id: string
  producto_id: string
  producto_nombre: string
  codigo_lote: string
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
}

export interface Alerta {
  tipo_alerta: 'bajo_minimo' | 'vence_30d' | 'vence_90d' | 'vencido' | 'dead_stock' | 'anomalia_consumo' | 'agotamiento_proximo' | 'sin_stock'
  producto_id: string
  nombre: string
  proxima_fecha_venc: string | null
  stock_minimo: number | null
  total: number | null
  unidad: string | null
  unidad_plural: string | null
  dias_inactivo?: number
  dias_autonomia?: number
  consumo_diario_30d?: number
  dias_con_consumo?: number
  es_anomalia?: boolean
  total_en_camino?: number
  tiene_pedido_pendiente?: boolean
  dias_despacho?: number
  proveedor_id?: number | null
  proveedor_nombre?: string | null
}

export interface AlertasResponse {
  bajo_minimo: Alerta[]
  por_vencer_30d: Alerta[]
  por_vencer_90d: Alerta[]
  vencidos: Alerta[]
}

export interface Movimiento {
  id: number
  tipo: 'entrada' | 'salida' | 'descarte' | 'ajuste' | 'ajuste_pos' | 'ajuste_neg' | 'transferencia_entrada' | 'transferencia_salida'
  producto_id: string
  producto_nombre?: string
  lote_id: number
  codigo_lote?: string
  area_id: number
  area_nombre?: string
  cantidad: number
  unidad_base_nombre?: string
  unidad_base_nombre_plural?: string
  referencia: string | null
  numero_documento: string | null
  grupo_movimiento: string | null
  usuario_id: number
  usuario_nombre?: string
  notas: string | null
  created_at: string
}

export interface Recepcion {
  id: number
  numero_documento: string
  proveedor_id: number
  proveedor_nombre?: string
  guia_despacho?: string | null
  fecha_recepcion: string
  estado: 'borrador' | 'confirmada'
  nota: string | null
  usuario_id: number
  usuario_nombre?: string
  created_at: string
  detalles?: RecepcionDetalle[]
}

export interface RecepcionDetalle {
  id: number
  recepcion_id: number
  producto_id: string
  producto_nombre?: string
  presentacion_id: number | null
  presentacion_nombre?: string
  cantidad_presentacion: number
  factor_conversion: number
  cantidad_base: number
  codigo_lote: string
  fecha_vencimiento: string
  area_destino_id: number
  area_destino_nombre?: string
}

// --- Solicitudes de Compra (Local/Extended) ---

// Ítem en el borrador (estado local del componente)
export interface SolicitudItem {
  producto_id: string
  producto_nombre: string
  codigo_proveedor: string | null
  codigo_maestro: string | null
  proveedor_id: number | null
  proveedor_nombre: string
  lead_time: number
  presentacion_id: number | null
  presentacion_nombre: string | null
  presentacion_nombre_plural: string | null
  factor_conversion: number | null
  unidad_base: string
  unidad_base_plural: string | null
  cantidad: number
  precio_unitario: number
  imagen_url?: string | null
  // Datos necesarios para recalcular cantidad al cambiar horizonte
  consumo_diario: number
  stock_actual: number
  stock_minimo: number
  // Horizonte de cobertura
  horizonte_dias: number | null      // null = chip desactivado (cantidad manual)
  horizonte_sugerido: number | null  // calculado al agregar, no cambia
  horizonte_razon: string | null     // texto del badge, no cambia
  horizonte_personalizado?: boolean  // true = override del global; undefined/false = sigue el global
}

// --- Pagination ---
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// --- Producto DTOs ---
export interface CreateProducto {
  nombre: string
  descripcion?: string | null
  categoria_id?: number | null
  unidad_base_id: number
  proveedor_id?: number | null
  codigo_proveedor?: string | null
  codigo_maestro?: string | null
  stock_minimo?: number
  precio_unidad?: number | null
  lead_time_propio?: number | null
  ubicacion?: string | null
  presentaciones?: { nombre: string; nombre_plural: string; factor_conversion: number; codigo_barras?: string | null }[]
  area_ids?: number[]
}

export interface UpdateProducto {
  nombre?: string
  descripcion?: string | null
  categoria_id?: number | null
  proveedor_id?: number | null
  codigo_proveedor?: string | null
  codigo_maestro?: string | null
  stock_minimo?: number
  precio_unidad?: number | null
  lead_time_propio?: number | null
  ubicacion?: string | null
  area_ids?: number[]
  version: number
}

// --- Request DTOs (Specific complex ones) ---
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

export interface RecepcionCreateRequest {
  proveedor_id: number
  guia_despacho?: string
  fecha_recepcion: string
  nota?: string
  detalles: {
    producto_id: string
    presentacion_id?: number
    cantidad_presentacion: number
    codigo_lote: string
    fecha_vencimiento: string
    area_destino_id: number
  }[]
}

export interface DescarteRequest {
  items: {
    lote_id: string
    area_id: number
    cantidad: number
    tipo: string
    nota?: string
  }[]
}

// --- Conteo de Inventario ---
export interface SesionConteo {
  id: string
  area_id: number
  area_nombre: string
  estado: 'borrador' | 'en_progreso' | 'confirmado' | 'cancelado'
  usuario_creador_nombre: string
  created_at: string
  confirmed_at: string | null
  total_items: number
  items_contados: number
}

export interface ConteoItem {
  id: string
  lote_id: string
  numero_lote: string
  fecha_vencimiento: string
  producto_id: string
  producto_nombre: string
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  stock_sistema: number
  cantidad_contada: number | null
  estado_item: 'pendiente' | 'contado' | 'no_contado'
  version: number
  imagen_url?: string | null
}

export interface ConteoDetalle {
  sesion: SesionConteo
  nota: string | null
  items: ConteoItem[]
  presentaciones: any[] // TODO: Usar Presentacion de generated
}

export interface PaginatedSesiones {
  data: SesionConteo[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

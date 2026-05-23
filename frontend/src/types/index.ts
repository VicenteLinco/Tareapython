export * from './generated'
import type { Presentacion, EstadoSolicitud, EstadoRecepcion, EstadoOrdenCompra, SolicitudResumen as GeneratedSolicitudResumen, SolicitudDetalle as GeneratedSolicitudDetalle, Usuario as GeneratedUsuario } from './generated'

// Usuario extendido con area_ids (viene de /auth/me y se persiste en el store)
export type Usuario = GeneratedUsuario & { area_ids?: number[] }

// --- Type Overrides (Narrowing) ---
// Los tipos generados usan `estado: string`, pero aquí los especificamos con los enums correctos
export type SolicitudResumen = Omit<GeneratedSolicitudResumen, 'estado'> & { estado: EstadoSolicitud }
export type SolicitudDetalle = Omit<GeneratedSolicitudDetalle, 'estado'> & { estado: EstadoSolicitud }

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
  lotes_count?: number
  stock_minimo: number
  dias_autonomia?: number | null
  dias_autonomia_pico?: number | null
  dias_con_consumo?: number
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
  estado: EstadoRecepcion
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
  tipo_estimacion_demanda?: 'forecast' | 'historial_corto' | 'sin_historial' | 'sin_proveedor'
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
export interface ProveedorProductoInput {
  proveedor_id: number
  es_principal: boolean
  codigo_proveedor?: string | null
  codigo_maestro?: string | null
  presentacion_id?: number | null
  presentacion?: { nombre: string; nombre_plural: string; factor_conversion: number; codigo_barras?: string | null; gtin?: string | null; gs1_habilitado?: boolean | null } | null
  precio_unidad?: string | null
  lead_time_dias?: number | null
  unidad_minima_pedido?: string | null
  imagen_url?: string | null
  imagen_data_url?: string | null
}

export interface CreateProducto {
  nombre: string
  descripcion?: string | null
  categoria_id?: number | null
  unidad_base_id: number
  codigo_maestro?: string | null
  stock_minimo?: number
  ubicacion?: string | null
  temperatura_almacenamiento?: string | null
  requiere_cadena_frio?: boolean
  dias_estabilidad_abierto?: number | null
  clase_riesgo?: string | null
  presentaciones?: { nombre: string; nombre_plural: string; factor_conversion: number; codigo_barras?: string | null; gtin?: string | null; gs1_habilitado?: boolean | null }[]
  area_ids?: number[]
  proveedores?: ProveedorProductoInput[]
}

export interface UpdateProducto {
  nombre?: string
  descripcion?: string | null
  categoria_id?: number | null
  codigo_maestro?: string | null
  stock_minimo?: number
  ubicacion?: string | null
  temperatura_almacenamiento?: string | null
  requiere_cadena_frio?: boolean
  dias_estabilidad_abierto?: number | null
  clase_riesgo?: string | null
  area_ids?: number[]
  proveedores?: ProveedorProductoInput[]
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

// DescarteRequest is re-exported from generated.ts (nota: string | null)

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
  presentaciones: Presentacion[]
}

export interface PaginatedSesiones {
  data: SesionConteo[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface DescarteVencidoItem {
  lote_id: string
  producto_id: string
  producto_nombre: string
  codigo_lote: string
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
  proveedor_id: number | null
  proveedor_nombre: string | null
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
}

export interface DescarteSessionItem {
  producto_nombre: string
  codigo_lote: string
  area_nombre: string
  tipo: 'DESCARTE_VENCIDO' | 'DESCARTE_DAÑADO'
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  fecha_vencimiento: string
  nota: string | null
}

export interface DescarteSession {
  grupo_movimiento: string
  fecha: string
  usuario_nombre: string
  total_items: number
  areas: string[]
  items: DescarteSessionItem[]
}

// ============================================================
// Órdenes de Compra
// ============================================================

export interface OrdenCompraResumen {
  id: string
  numero_documento: string
  proveedor_nombre: string
  estado: EstadoOrdenCompra
  fecha_emision: string
  fecha_entrega_esperada: string | null
  items_count: number
  solicitud_numero: string | null
  usuario_nombre: string
}

export interface OrdenCompraItem {
  id: number
  producto_id: string
  producto_nombre: string
  presentacion_nombre: string | null
  cantidad_solicitada: number
  cantidad_recibida: number
  precio_unitario: number | null
  unidad: string
  area_destino_nombre: string | null
}

export interface RecepcionVinculada {
  id: string
  numero_documento: string
  estado: string
  fecha_recepcion: string
  usuario_nombre: string
}

export interface OrdenCompraDetalle {
  orden_compra: {
    id: string
    numero_documento: string
    proveedor_id: number
    proveedor_nombre: string
    estado: OrdenCompraResumen['estado']
    fecha_emision: string
    fecha_entrega_esperada: string | null
    nota: string | null
    solicitud_id: string | null
    solicitud_numero: string | null
    usuario_nombre: string
  }
  items: OrdenCompraItem[]
  recepciones: RecepcionVinculada[]
}

export interface CreateOrdenCompraRequest {
  solicitud_id?: string
  proveedor_id: number
  fecha_entrega_esperada?: string
  nota?: string
  items: {
    producto_id: string
    presentacion_id?: number
    cantidad_solicitada: number
    precio_unitario?: number
    unidad: string
    area_destino_id?: number
  }[]
}

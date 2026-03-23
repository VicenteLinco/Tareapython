// --- Auth ---
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
}

// --- Models ---
export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: 'admin' | 'tecnologo' | 'consulta'
  area_ids: number[]
}

export interface Area {
  id: number
  nombre: string
  es_bodega: boolean
  activa: boolean
}

export interface Categoria {
  id: number
  nombre: string
  descripcion: string | null
}

export interface UnidadBasica {
  id: number
  nombre: string
  nombre_plural: string
}

export interface Proveedor {
  id: number
  nombre: string
  contacto: string | null
  telefono: string | null
  email: string | null
  icono: string | null
  dias_despacho_aereo: number | null
  dias_despacho_tierra: number | null
  activo: boolean
  version: number
}

export interface Producto {
  id: number
  nombre: string
  descripcion?: string | null
  codigo: string | null
  categoria_id: number | null
  categoria_nombre?: string | null
  unidad_base_id: number
  unidad_base_nombre?: string
  stock_minimo: number
  activo: boolean
  version: number
  presentaciones?: Presentacion[]
}

export interface Presentacion {
  id: number
  producto_id: number
  nombre: string
  nombre_plural: string
  factor_conversion: number
  unidad_medida_id: number
  unidad_medida_nombre?: string
  version: number
}

export interface Lote {
  id: number
  producto_id: number
  producto_nombre?: string
  codigo_lote: string
  codigo_interno: string | null
  fecha_vencimiento: string
  proveedor_id: number | null
  proveedor_nombre?: string
  recepcion_id: number | null
  notas: string | null
  created_at: string
}

export interface StockItem {
  producto_id: string
  codigo_interno: string
  producto_nombre: string
  categoria: string | null
  unidad: string
  unidad_plural: string | null
  stock_total: number | null
  stock_minimo: number
  proximo_vencimiento: string | null
  proveedor_nombre: string | null
  proveedor_icono: string | null
}

export interface StockPorArea {
  lote_id: number
  producto_id: number
  producto_nombre: string
  codigo_lote: string
  fecha_vencimiento: string
  area_id: number
  cantidad: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
}

export interface Alerta {
  tipo: 'bajo_minimo' | 'vence_30d' | 'vence_90d' | 'vencido'
  producto_id: number
  producto_nombre: string
  detalle: string
  total?: number
  unidad?: string
  unidad_plural?: string
}

export interface AlertasResponse {
  bajo_minimo: Alerta[]
  por_vencer_30d: Alerta[]
  por_vencer_90d: Alerta[]
  vencidos: Alerta[]
}

export interface Movimiento {
  id: number
  tipo: 'entrada' | 'salida' | 'transferencia_entrada' | 'transferencia_salida' | 'descarte' | 'ajuste'
  producto_id: number
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
  producto_id: number
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

// --- Pagination ---
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// --- Request DTOs ---
export interface ConsumoRequest {
  producto_id: number
  area_id: number
  cantidad: number
  lote_id?: number
  notas?: string
}

export interface ConsumoBatchRequest {
  area_id: number
  items: {
    producto_id: number
    cantidad: number
    lote_id?: number
  }[]
  notas?: string
}

export interface RecepcionCreateRequest {
  proveedor_id: number
  guia_despacho?: string
  fecha_recepcion: string
  nota?: string
  detalles: {
    producto_id: number
    presentacion_id?: number
    cantidad_presentacion: number
    codigo_lote: string
    fecha_vencimiento: string
    area_destino_id: number
  }[]
}

export interface TransferenciaRequest {
  producto_id: number
  area_origen_id: number
  area_destino_id: number
  cantidad: number
  lote_id?: number
  notas?: string
}

export interface DescarteRequest {
  items: {
    producto_id: number
    lote_id: number
    area_id: number
    cantidad: number
    motivo: string
  }[]
  notas?: string
}

// --- Catalog DTOs ---
export interface CreateCategoria {
  nombre: string
  descripcion?: string
}

export interface UpdateCategoria {
  nombre?: string
  descripcion?: string
}

export interface CreateUnidadBasica {
  nombre: string
  nombre_plural: string
}

export interface UpdateUnidadBasica {
  nombre?: string
  nombre_plural?: string
}

export interface CreateArea {
  nombre: string
  es_bodega?: boolean
}

export interface UpdateArea {
  nombre?: string
  es_bodega?: boolean
}

export interface CreateProveedor {
  nombre: string
  contacto?: string
  telefono?: string
  email?: string
  icono?: string
  dias_despacho_aereo?: number
  dias_despacho_tierra?: number
}

export interface UpdateProveedor {
  nombre?: string
  contacto?: string
  telefono?: string
  email?: string
  icono?: string
  dias_despacho_aereo?: number
  dias_despacho_tierra?: number
  version: number
}

export interface CreateProducto {
  nombre: string
  descripcion?: string
  categoria_id?: number
  unidad_base_id: number
  proveedor_id?: number
  codigo_proveedor?: string
  codigo_maestro?: string
  presentaciones?: { nombre: string; nombre_plural: string; factor_conversion: number; codigo_barras?: string }[]
  area_ids?: number[]
}

export interface UpdateProducto {
  nombre?: string
  descripcion?: string
  categoria_id?: number
  proveedor_id?: number
  codigo_proveedor?: string
  codigo_maestro?: string
  stock_minimo?: number
  area_ids?: number[]
  version: number
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
}

export interface ConteoDetalle {
  sesion: SesionConteo
  nota: string | null
  items: ConteoItem[]
}

export interface PaginatedSesiones {
  data: SesionConteo[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// @generated: Generado automáticamente por el backend.
// Ejecutar `cargo run --bin export_types` para regenerar.
// NO editar manualmente.

export type Area = { id: number; nombre: string; es_bodega: boolean; activa: boolean; created_at: string; conteo_frecuencia_dias: number; version: number; total_items_stock: number | null }
export type Categoria = { id: number; nombre: string; descripcion: string | null; created_at: string; version: number }
export type UnidadBasica = { id: number; nombre: string; nombre_plural: string; version: number }
export type Proveedor = { id: number; nombre: string; contacto: string | null; telefono: string | null; email: string | null; icono: string | null; dias_despacho_aereo: number | null; dias_despacho_tierra: number | null; activa: boolean; version: number; created_at: string; total_productos: number }
export type Producto = { id: string; codigo_interno: string; nombre: string; descripcion: string | null; categoria_id: number | null; unidad_base_id: number; proveedor_id: number | null; codigo_proveedor: string | null; codigo_maestro: string | null; stock_minimo: string; precio_unidad: string | null; lead_time_propio: number | null; ubicacion: string | null; activo: boolean; version: number; created_at: string; updated_at: string }
export type Presentacion = { id: number; producto_id: string; nombre: string; nombre_plural: string; factor_conversion: string; codigo_barras: string | null; activa: boolean; version: number; created_at: string }
export type Lote = { id: string; producto_id: string; proveedor_id: number | null; numero_lote: string; fecha_vencimiento: string; codigo_interno: string; costo_unitario: string | null; created_at: string }
export type Usuario = { id: string; nombre: string; email: string; rol: string; activo: boolean; version: number; created_at: string; updated_at: string }
export type CreateArea = { nombre: string; es_bodega: boolean | null }
export type UpdateArea = { nombre: string | null; es_bodega: boolean | null; conteo_frecuencia_dias: number | null; version: number }
export type ProductoAreaRow = { id: string; codigo_interno: string; nombre: string }
export type AsignarProductosRequest = { producto_ids: string[] }
export type CreateProveedor = { nombre: string; contacto: string | null; telefono: string | null; email: string | null; icono: string | null; dias_despacho_aereo: number | null; dias_despacho_tierra: number | null }
export type UpdateProveedor = { nombre: string | null; contacto: string | null; telefono: string | null; email: string | null; icono: string | null; dias_despacho_aereo: number | null; dias_despacho_tierra: number | null; version: number }
export type ProveedorQuery = { q: string | null; activo: boolean | null }
export type CreateUsuario = { nombre: string; email: string; password: string; rol: string; area_ids: number[] }
export type UpdateUsuario = { nombre: string | null; email: string | null; rol: string | null; area_ids: number[] | null; version: number }
export type UsuarioResponse = { id: string; nombre: string; email: string; rol: string; activo: boolean; areas: AreaSimple[]; version: number }
export type AreaSimple = { id: number; nombre: string }
export type UsuarioQuery = { rol: string | null; activo: boolean | null }
export type ResetPasswordRequest = { password_nueva: string }
export type CreateCategoria = { nombre: string; descripcion: string | null }
export type UpdateCategoria = { nombre: string | null; descripcion: string | null; version: number }
export type CreateUnidadBasica = { nombre: string; nombre_plural: string }
export type UpdateUnidadBasica = { nombre: string | null; nombre_plural: string | null; version: number }
export type ItemRecomendado = { producto_id: string; producto_nombre: string; codigo_proveedor: string | null; codigo_maestro: string | null; proveedor_id: number | null; proveedor_nombre: string | null; lead_time: number; autonomia_dias: number | null; nivel_urgencia: string; stock_actual: string; stock_seguridad: string; consumo_diario: string; dias_historia: number; cantidad_sugerida_base: string; presentacion_id: number | null; presentacion_nombre: string | null; presentacion_nombre_plural: string | null; factor_conversion: string | null; cantidad_sugerida_presentacion: string | null; precio_ultima_recepcion: string | null; unidad_base: string; unidad_base_plural: string | null; imagen_url: string | null }
export type UpdateSolicitudRequest = { nota: string | null; items: CreateSolicitudItem[] }
export type CreateSolicitudItem = { producto_id: string; cantidad_sugerida: string; unidad: string; precio_unitario: string | null; presentacion_id: number | null; cantidad_presentaciones: string | null }
export type SolicitudResumen = { id: string; numero_documento: string; fecha_creacion: string; estado: string; usuario_nombre: string; items_count: number }
export type SolicitudDetalle = { id: string; numero_documento: string; fecha_creacion: string; estado: string; usuario_nombre: string; nota: string | null; items: SolicitudDetalleItem[] }
export type SolicitudDetalleItem = { producto_id: string; producto_nombre: string; cantidad_sugerida: string; unidad: string; codigo_proveedor: string | null; codigo_maestro: string | null; proveedor_nombre: string | null; presentacion_nombre: string | null; presentacion_nombre_plural: string | null; factor_conversion: string | null; precio_unitario: string | null; presentacion_id: number | null; cantidad_presentaciones: string | null; imagen_url: string | null }
export type DescarteRequest = { items: DescarteItem[] }
export type DescarteItem = { lote_id: string; area_id: number; cantidad: string; tipo: string; nota: string | null }
export type DescarteResponse = { grupo_movimiento: string; movimientos: MovimientoGenerado[] }
export type MovimientoGenerado = { id: string; numero_documento: string; cantidad: string; cantidad_resultante: string }
export type RecepcionQuery = { proveedor_id: number | null; estado: string | null; desde: string | null; hasta: string | null; busqueda: string | null; area_id: number | null; page: number | null; per_page: number | null }
export type PaginatedRecepciones = { data: RecepcionListItem[]; total: number; page: number; per_page: number; total_pages: number }
export type RecepcionListItem = { id: string; numero_documento: string; proveedor_nombre: string; proveedor_icono: string | null; guia_despacho: string | null; estado: string; fecha_recepcion: string; usuario_nombre: string; created_at: string; areas_destino: string | null; tiene_foto: boolean; solicitud_id: string | null }
export type SubirFotoInput = { data_url: string }
export type CreateRecepcion = { proveedor_id: number; guia_despacho: string | null; 
/**
 * "completa" | "parcial" | "rechazada" — default "completa"
 */
estado: string | null; fecha_recepcion: string; nota: string | null; motivo_rechazo: string | null; solicitud_id: string | null; detalle: DetalleRecepcionInput[] }
export type DetalleRecepcionInput = { producto_id: string; numero_lote: string; fecha_vencimiento: string; presentacion_id: number | null; cantidad_presentaciones: string; area_destino_id: number; costo_unitario: string | null; precio_unitario: string | null }
export type DetalleRecepcionRow = { id: number; producto_nombre: string; numero_lote: string; fecha_vencimiento: string; presentacion_nombre: string | null; cantidad_presentaciones: string; factor_conversion_usado: string; cantidad_unidades_base: string; unidad_base_nombre: string; unidad_base_nombre_plural: string; area_destino: string }
/**
 * Información del lote creado durante la recepción, para generar etiquetas QR
 */
export type LoteCreado = { lote_id: string; codigo_interno: string; numero_lote: string; fecha_vencimiento: string; producto_id: string; producto_nombre: string; presentacion_nombre: string | null; area_nombre: string; cantidad: string }

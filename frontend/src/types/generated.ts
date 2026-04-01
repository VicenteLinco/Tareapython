// @generated: Generado automáticamente por el backend.
// Ejecutar `cargo run --bin export_types` para regenerar.
// NO editar manualmente.

export type Area = { id: number; nombre: string; es_bodega: boolean; activa: boolean; created_at: string; conteo_frecuencia_dias: number; version: number }
export type Categoria = { id: number; nombre: string; descripcion: string | null; created_at: string; version: number }
export type UnidadBasica = { id: number; nombre: string; nombre_plural: string; version: number }
export type Proveedor = { id: number; nombre: string; contacto: string | null; telefono: string | null; email: string | null; icono: string | null; dias_despacho_aereo: number | null; dias_despacho_tierra: number | null; activo: boolean; version: number; created_at: string }
export type Producto = { id: string; codigo_interno: string; nombre: string; descripcion: string | null; categoria_id: number | null; unidad_base_id: number; proveedor_id: number | null; codigo_proveedor: string | null; codigo_maestro: string | null; stock_minimo: string; activo: boolean; version: number; created_at: string; updated_at: string }
export type Presentacion = { id: number; producto_id: string; nombre: string; nombre_plural: string; factor_conversion: string; codigo_barras: string | null; activa: boolean; version: number; created_at: string }
export type Lote = { id: string; producto_id: string; proveedor_id: number | null; numero_lote: string; fecha_vencimiento: string; codigo_interno: string; costo_unitario: string | null; created_at: string }
export type Usuario = { id: string; nombre: string; email: string; rol: string; activo: boolean; version: number; created_at: string; updated_at: string }

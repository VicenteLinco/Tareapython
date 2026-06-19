use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, specta::Type)]
pub struct Producto {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Supplier flat fields
    pub proveedor_id: Option<i32>,
    pub sku: Option<String>,
    pub precio_unidad: Option<Decimal>,
    pub imagen_url: Option<String>,
    // Presentation flat fields
    pub pres_nombre: Option<String>,
    pub pres_nombre_plural: Option<String>,
    pub pres_factor: Option<Decimal>,
    pub pres_codigo_barras: Option<String>,
    pub pres_gtin: Option<String>,
    pub pres_gs1_habilitado: bool,
}

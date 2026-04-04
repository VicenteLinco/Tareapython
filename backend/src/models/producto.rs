use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Producto {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub proveedor_id: Option<i32>,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Decimal,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_propio: Option<i32>,
    pub ubicacion: Option<String>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

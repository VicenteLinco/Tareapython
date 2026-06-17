use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct ProductoProveedorPresentacion {
    pub id: i32,
    pub producto_proveedor_id: i32,
    pub presentacion_id: i32,
    pub es_default: bool,
    pub precio_unidad: Option<Decimal>,
    pub activo: bool,
    pub created_at: DateTime<Utc>,
}

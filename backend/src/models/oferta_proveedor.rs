use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct OfertaProveedor {
    pub id: i32,
    pub presentacion_id: i32,
    pub proveedor_id: i32,
    pub precio_adquisicion: Option<Decimal>,
    pub sku_proveedor: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

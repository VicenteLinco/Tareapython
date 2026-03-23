use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Presentacion {
    pub id: i32,
    pub producto_id: Uuid,
    pub nombre: String,
    pub nombre_plural: String,
    pub factor_conversion: Decimal,
    pub codigo_barras: Option<String>,
    pub activa: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

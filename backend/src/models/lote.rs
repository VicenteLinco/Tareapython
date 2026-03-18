use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Lote {
    pub id: Uuid,
    pub producto_id: Uuid,
    pub proveedor_id: Option<i32>,
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub codigo_interno: String,
    pub costo_unitario: Option<Decimal>,
    pub created_at: DateTime<Utc>,
}

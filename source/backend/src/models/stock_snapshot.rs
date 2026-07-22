use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct StockSnapshot {
    pub lote_id: Uuid,
    pub producto_id: Uuid,
    pub stock_actual: Decimal,
    pub ultima_actualizacion: DateTime<Utc>,
}

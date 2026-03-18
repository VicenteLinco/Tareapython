use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Stock {
    pub id: i32,
    pub lote_id: Uuid,
    pub area_id: i32,
    pub cantidad: Decimal,
    pub updated_at: DateTime<Utc>,
}

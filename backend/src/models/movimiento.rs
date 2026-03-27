use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Movimiento {
    pub id: Uuid,
    pub numero_documento: String,
    pub grupo_movimiento: Option<Uuid>,
    pub lote_id: Uuid,
    pub area_id: i32,
    pub tipo: String,
    pub cantidad: Decimal,
    pub cantidad_resultante: Decimal,
    pub usuario_id: Uuid,
    pub origen: Option<String>,
    pub nota: Option<String>,
    pub created_at: DateTime<Utc>,
}

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Lote {
    pub id: Uuid,
    pub producto_id: Uuid,
    pub proveedor_id: Option<i32>,
    pub numero_lote: String,
    pub fecha_vencimiento: Option<NaiveDate>,
    pub costo_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub recepcion_id: Option<Uuid>,
    pub fecha_fabricacion: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

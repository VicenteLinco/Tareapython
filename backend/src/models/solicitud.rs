use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SolicitudCompra {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub usuario_id: Uuid,
    pub estado: String,
    pub nota: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct SolicitudCompraDetalle {
    pub id: i32,
    pub solicitud_id: Uuid,
    pub producto_id: Uuid,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub created_at: DateTime<Utc>,
}

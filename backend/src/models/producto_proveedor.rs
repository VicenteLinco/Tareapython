use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, sqlx::FromRow, specta::Type)]
pub struct ProductoProveedor {
    pub id: i32,
    pub producto_id: Uuid,
    pub proveedor_id: i32,
    pub es_principal: bool,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub presentacion_id: Option<i32>,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_dias: Option<i32>,
    pub unidad_minima_pedido: Option<Decimal>,
    pub imagen_url: Option<String>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

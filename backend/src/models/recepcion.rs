use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Recepcion {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_id: i32,
    pub guia_despacho: Option<String>,
    pub estado: String,
    pub fecha_recepcion: DateTime<Utc>,
    pub guia_despacho_archivo: Option<String>,
    pub usuario_id: Uuid,
    pub nota: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecepcionDetalle {
    pub id: i32,
    pub recepcion_id: Uuid,
    pub producto_id: Uuid,
    pub lote_id: Uuid,
    pub presentacion_id: i32,
    pub area_destino_id: i32,
    pub cantidad_presentaciones: Decimal,
    pub factor_conversion_usado: Decimal,
    pub cantidad_unidades_base: Decimal,
    pub created_at: DateTime<Utc>,
}

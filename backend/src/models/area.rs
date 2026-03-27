use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Area {
    pub id: i32,
    pub nombre: String,
    pub es_bodega: bool,
    pub activa: bool,
    pub created_at: DateTime<Utc>,
    pub conteo_frecuencia_dias: i32,
}

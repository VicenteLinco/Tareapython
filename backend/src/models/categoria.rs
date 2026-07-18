use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Categoria {
    pub id: i32,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub created_at: DateTime<Utc>,
    pub version: i32,
}

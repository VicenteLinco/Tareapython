use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Proveedor {
    pub id: i32,
    pub nombre: String,
    pub contacto: Option<String>,
    pub telefono: Option<String>,
    pub email: Option<String>,
    pub icono: Option<String>,
    pub dias_despacho_aereo: Option<i32>,
    pub dias_despacho_tierra: Option<i32>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

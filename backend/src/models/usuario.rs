use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Usuario {
    pub id: Uuid,
    pub nombre: String,
    pub email: String,
    pub whatsapp_phone: Option<String>,
    #[serde(skip_serializing)]
    #[specta(skip)]
    pub password_hash: String,
    pub rol: String,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

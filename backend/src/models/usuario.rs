use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Usuario {
    pub id: Uuid,
    pub nombre: String,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub rol: String,
    pub activo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

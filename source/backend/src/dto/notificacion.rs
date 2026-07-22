use chrono::{DateTime, Utc};
use serde::Serialize;
use specta::Type;
use uuid::Uuid;

#[derive(Debug, Serialize, Type, sqlx::FromRow)]
pub struct NotificacionResponse {
    pub id: Uuid,
    pub usuario_id: Uuid,
    pub titulo: String,
    pub mensaje: String,
    pub tipo: String,
    pub leido: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Type)]
pub struct UnreadCountResponse {
    pub conteo: i32,
}

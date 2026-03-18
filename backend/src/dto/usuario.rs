use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateUsuario {
    pub nombre: String,
    pub email: String,
    pub password: String,
    pub rol: String,
    pub area_ids: Vec<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUsuario {
    pub nombre: Option<String>,
    pub email: Option<String>,
    pub rol: Option<String>,
    pub area_ids: Option<Vec<i32>>,
}

#[derive(Debug, Serialize)]
pub struct UsuarioResponse {
    pub id: Uuid,
    pub nombre: String,
    pub email: String,
    pub rol: String,
    pub activo: bool,
    pub areas: Vec<AreaSimple>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AreaSimple {
    pub id: i32,
    pub nombre: String,
}

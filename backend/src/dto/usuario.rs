use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Deserialize, Validate)]
pub struct CreateUsuario {
    #[validate(length(min = 1, max = 100, message = "El nombre debe tener entre 1 y 100 caracteres"))]
    pub nombre: String,
    #[validate(email(message = "Formato de email inválido"), length(max = 254, message = "Email demasiado largo"))]
    pub email: String,
    #[validate(length(min = 8, max = 128, message = "La contraseña debe tener entre 8 y 128 caracteres"))]
    pub password: String,
    #[validate(custom(function = "validate_rol"))]
    pub rol: String,
    pub area_ids: Vec<i32>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateUsuario {
    #[validate(length(min = 1, max = 100, message = "El nombre debe tener entre 1 y 100 caracteres"))]
    pub nombre: Option<String>,
    #[validate(email(message = "Formato de email inválido"), length(max = 254, message = "Email demasiado largo"))]
    pub email: Option<String>,
    #[validate(custom(function = "validate_rol"))]
    pub rol: Option<String>,
    pub area_ids: Option<Vec<i32>>,
    pub version: i32,
}

fn validate_rol(rol: &str) -> Result<(), validator::ValidationError> {
    if matches!(rol, "admin" | "tecnologo" | "consulta") {
        Ok(())
    } else {
        let mut err = validator::ValidationError::new("rol_invalido");
        err.message = Some("El rol debe ser 'admin', 'tecnologo' o 'consulta'".into());
        Err(err)
    }
}

#[derive(Debug, Serialize)]
pub struct UsuarioResponse {
    pub id: Uuid,
    pub nombre: String,
    pub email: String,
    pub rol: String,
    pub activo: bool,
    pub areas: Vec<AreaSimple>,
    pub version: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AreaSimple {
    pub id: i32,
    pub nombre: String,
}

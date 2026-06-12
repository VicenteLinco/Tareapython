use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct Claims {
    pub sub: Uuid,
    pub rol: String,
    pub area_ids: Vec<i32>,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserResponse {
    pub id: Uuid,
    pub nombre: String,
    pub email: String,
    pub whatsapp_phone: Option<String>,
    pub rol: String,
    pub area_ids: Vec<i32>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CambiarPasswordRequest {
    pub password_actual: String,
    pub password_nueva: String,
}

#[derive(Debug, Deserialize, ToSchema, Validate)]
pub struct UpdateProfileRequest {
    #[validate(length(
        min = 1,
        max = 100,
        message = "El nombre debe tener entre 1 y 100 caracteres"
    ))]
    pub nombre: Option<String>,
    #[validate(
        email(message = "Formato de email inválido"),
        length(max = 254, message = "Email demasiado largo")
    )]
    pub email: Option<String>,
    #[validate(length(
        max = 50,
        message = "El número de WhatsApp no puede superar los 50 caracteres"
    ))]
    pub whatsapp_phone: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct RefreshClaims {
    pub sub: Uuid,
    pub jti: Uuid,
    pub token_type: String,
    pub exp: i64,
    pub iat: i64,
}

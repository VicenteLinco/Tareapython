use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No encontrado: {0}")]
    NotFound(String),

    #[error("Validación: {0}")]
    Validation(String),

    #[error("Conflicto: {0}")]
    Conflict(String),

    #[error("Regla de negocio: {0}")]
    BusinessLogic(String, String),

    #[error("Acceso denegado: {0}")]
    Forbidden(String),

    #[error("No autenticado")]
    Unauthorized,

    #[error("Demasiadas solicitudes")]
    TooManyRequests,

    #[error("Error interno: {0}")]
    Internal(String),

    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_code, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, "VALIDATION_ERROR", msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            AppError::BusinessLogic(msg, code) => {
                (StatusCode::UNPROCESSABLE_ENTITY, code.as_str(), msg.clone())
            }
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone()),
            AppError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "No autenticado".to_string())
            }
            AppError::TooManyRequests => {
                (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", "Demasiadas solicitudes. Intente más tarde.".to_string())
            }
            AppError::Internal(msg) => {
                tracing::error!("Error interno: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Error interno del servidor".to_string())
            }
            AppError::Sqlx(err) => {
                tracing::error!("Error de base de datos: {}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Error interno del servidor".to_string())
            }
        };

        let body = json!({
            "error": {
                "code": error_code,
                "message": message,
            }
        });

        (status, axum::Json(body)).into_response()
    }
}

/// Valida que un campo de texto no exceda la longitud máxima.
pub fn validate_text_length(value: &str, field: &str, max: usize) -> Result<(), AppError> {
    if value.len() > max {
        return Err(AppError::Validation(format!(
            "{} excede el límite de {} caracteres",
            field, max
        )));
    }
    Ok(())
}

/// Valida un campo de email: formato básico y longitud.
pub fn validate_email(email: &str) -> Result<(), AppError> {
    if email.len() > 255 {
        return Err(AppError::Validation("Email excede 255 caracteres".into()));
    }
    if !email.contains('@') || !email.contains('.') {
        return Err(AppError::Validation("Formato de email inválido".into()));
    }
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].len() < 3 {
        return Err(AppError::Validation("Formato de email inválido".into()));
    }
    Ok(())
}

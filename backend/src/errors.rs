use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No encontrado: {0}")]
    NotFound(String),

    #[error("Validación: {0}")]
    Validation(String),

    #[error("Conflicto: {0}")]
    Conflict(String),

    #[error("Conflicto con ID: {0}")]
    ConflictWithId(String, String, Uuid),

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

impl From<validator::ValidationErrors> for AppError {
    fn from(errors: validator::ValidationErrors) -> Self {
        let messages: Vec<String> = errors
            .field_errors()
            .iter()
            .map(|(field, errs)| {
                let msgs: Vec<String> = errs
                    .iter()
                    .filter_map(|e| e.message.as_ref().map(|m| m.to_string()))
                    .collect();
                if msgs.is_empty() {
                    format!("Campo '{}' inválido", field)
                } else {
                    format!("{}: {}", field, msgs.join(", "))
                }
            })
            .collect();
        AppError::Validation(messages.join("; "))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_code, message, id) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone(), None),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, "VALIDATION_ERROR", msg.clone(), None),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone(), None),
            AppError::ConflictWithId(msg, code, uuid) => (StatusCode::CONFLICT, code.as_str(), msg.clone(), Some(*uuid)),
            AppError::BusinessLogic(msg, code) => {
                (StatusCode::UNPROCESSABLE_ENTITY, code.as_str(), msg.clone(), None)
            }
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone(), None),
            AppError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "No autenticado".to_string(), None)
            }
            AppError::TooManyRequests => {
                (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", "Demasiadas solicitudes. Intente más tarde.".to_string(), None)
            }
            AppError::Internal(msg) => {
                tracing::error!("Error interno: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Error interno del servidor".to_string(), None)
            }
            AppError::Sqlx(err) => {
                tracing::error!("Error de base de datos: {}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Error interno del servidor".to_string(), None)
            }
        };

        let mut error_obj = json!({
            "code": error_code,
            "message": message,
        });

        if let Some(uuid) = id {
            error_obj["sesion_id"] = json!(uuid);
        }

        let body = json!({
            "error": error_obj
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

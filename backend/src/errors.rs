use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use rust_decimal::Decimal;
use serde_json::{json, Value};
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

    #[error("Conflicto: {0}")]
    ConflictWithCode(String, String),

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

    // --- Variantes de dominio tipadas ---

    /// Stock insuficiente al consumir o descartar
    #[error("Stock insuficiente: disponible {disponible}, solicitado {solicitado}")]
    StockInsuficiente {
        disponible: Decimal,
        solicitado: Decimal,
    },

    /// Lote ya agotado (cantidad == 0)
    #[allow(dead_code)]
    #[error("Lote agotado: {lote_id}")]
    LoteAgotado { lote_id: Uuid },

    /// Lote vencido
    #[allow(dead_code)]
    #[error("Lote vencido: {lote_id}")]
    LoteVencido { lote_id: Uuid },

    /// Conflicto de versión en optimistic locking
    #[error("Conflicto de versión: esperada {esperada}, actual {actual}")]
    VersionConflict { esperada: i64, actual: i64 },
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use rust_decimal_macros::dec;

    async fn response_json(error: AppError) -> (StatusCode, Value) {
        let response = error.into_response();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("leer body");
        let body = serde_json::from_slice(&bytes).expect("json valido");
        (status, body)
    }

    #[tokio::test]
    async fn stock_insuficiente_expone_codigo_y_detalles_tipados() {
        let (status, body) = response_json(AppError::StockInsuficiente {
            disponible: dec!(3.5),
            solicitado: dec!(8),
        })
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["code"], "STOCK_INSUFICIENTE");
        assert_eq!(body["details"]["disponible"], "3.5");
        assert_eq!(body["details"]["solicitado"], "8");
    }

    #[tokio::test]
    async fn version_conflict_expone_codigo_y_versiones() {
        let (status, body) = response_json(AppError::VersionConflict {
            esperada: 2,
            actual: 3,
        })
        .await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["code"], "VERSION_CONFLICT");
        assert_eq!(body["details"]["esperada"], 2);
        assert_eq!(body["details"]["actual"], 3);
    }
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
        // (status, code, message, details)
        let (status, code, message, details): (StatusCode, &str, String, Option<Value>) = match self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg, None),
            AppError::Validation(msg) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                msg,
                None,
            ),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg, None),
            AppError::ConflictWithId(msg, code, uuid) => {
                // Build response directly — code is dynamic String
                // sesion_id at root for backward compatibility
                let body = json!({
                    "code": code,
                    "message": msg,
                    "sesion_id": uuid,
                });
                return (StatusCode::CONFLICT, axum::Json(body)).into_response();
            }
            AppError::ConflictWithCode(msg, code) => {
                let body = json!({ "code": code, "message": msg });
                return (StatusCode::CONFLICT, axum::Json(body)).into_response();
            }
            AppError::BusinessLogic(msg, code) => {
                let body = json!({ "code": code, "message": msg });
                return (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(body)).into_response();
            }
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg, None),
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "No autenticado".to_string(),
                None,
            ),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Demasiadas solicitudes. Intente más tarde.".to_string(),
                None,
            ),
            AppError::Internal(msg) => {
                tracing::error!("Error interno: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Error interno del servidor".to_string(),
                    None,
                )
            }
            AppError::Sqlx(err) => {
                tracing::error!("Error de base de datos: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "Error interno del servidor".to_string(),
                    None,
                )
            }
            AppError::StockInsuficiente {
                disponible,
                solicitado,
            } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "STOCK_INSUFICIENTE",
                format!(
                    "Stock insuficiente: disponible {}, solicitado {}",
                    disponible, solicitado
                ),
                Some(json!({
                    "disponible": disponible.to_string(),
                    "solicitado": solicitado.to_string()
                })),
            ),
            AppError::LoteAgotado { lote_id } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "LOTE_AGOTADO",
                format!("El lote {} está agotado", lote_id),
                Some(json!({ "lote_id": lote_id })),
            ),
            AppError::LoteVencido { lote_id } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "LOTE_VENCIDO",
                format!("El lote {} está vencido", lote_id),
                Some(json!({ "lote_id": lote_id })),
            ),
            AppError::VersionConflict { esperada, actual } => (
                StatusCode::CONFLICT,
                "VERSION_CONFLICT",
                format!(
                    "Conflicto de versión: esperada {}, actual {}",
                    esperada, actual
                ),
                Some(json!({ "esperada": esperada, "actual": actual })),
            ),
        };

        let mut body = json!({
            "code": code,
            "message": message,
        });

        if let Some(d) = details {
            body["details"] = d;
        }

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

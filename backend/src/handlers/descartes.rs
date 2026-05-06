use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::descarte::DescarteRequest;
use crate::errors::AppError;
use crate::services::{descarte_service, idempotency};

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<DescarteRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    // Idempotencia
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /descartes", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    // Procesar descartes vía servicio
    let response =
        match descarte_service::procesar_descartes(&state.pool, req, claims.sub, &claims.rol).await
        {
            Ok(res) => res,
            Err(e) => {
                idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
                return Err(e);
            }
        };

    let res_json =
        serde_json::to_value(&response).map_err(|e| AppError::Internal(e.to_string()))?;
    idempotency::save_response(&state.pool, &idem_key, 201, &res_json).await?;

    Ok((StatusCode::CREATED, Json(res_json)))
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(crear))
}

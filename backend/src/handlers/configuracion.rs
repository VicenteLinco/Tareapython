use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::configuracion::{
    BrandingResponse, ConfiguracionResponse, UpdateConfiguracion, VerificarPinInput,
};
use crate::errors::AppError;
use crate::services::configuracion_service;

/// GET /api/v1/configuracion — Obtener configuración del sistema
async fn obtener(State(state): State<AppState>) -> Result<Json<ConfiguracionResponse>, AppError> {
    Ok(Json(configuracion_service::obtener(&state.pool).await?))
}

/// PUT /api/v1/configuracion — Actualizar configuración (solo admin)
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateConfiguracion>,
) -> Result<Json<ConfiguracionResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    Ok(Json(
        configuracion_service::actualizar(&state.pool, body, claims.sub).await?,
    ))
}

/// POST /api/v1/configuracion/verificar-pin
/// Verifica el PIN de salida de modo kiosko/QR. No requiere auth.
/// (Intranet only — rate limiting not needed for this deployment)
async fn verificar_pin(
    State(state): State<AppState>,
    Json(body): Json<VerificarPinInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let valido = configuracion_service::verificar_pin(&state.pool, &body.pin).await?;
    Ok(Json(serde_json::json!({ "valido": valido })))
}

#[derive(serde::Deserialize)]
struct ModelosQuery {
    provider: Option<String>,
    api_key: Option<String>,
    api_url: Option<String>,
}

/// GET /api/v1/configuracion/ia-modelos
async fn obtener_ia_modelos(
    State(state): State<AppState>,
    Query(query): Query<ModelosQuery>,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(
        configuracion_service::obtener_ia_modelos(
            &state.pool,
            query.provider,
            query.api_key,
            query.api_url,
        )
        .await?,
    ))
}

/// GET /api/v1/branding — Datos públicos para personalizar la pantalla de login.
/// Solo expone el nombre del laboratorio y la imagen del login; nunca secretos.
async fn obtener_branding(
    State(state): State<AppState>,
) -> Result<Json<BrandingResponse>, AppError> {
    Ok(Json(
        configuracion_service::obtener_branding(&state.pool).await?,
    ))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(obtener).put(actualizar))
        .route("/verificar-pin", axum::routing::post(verificar_pin))
        .route("/ia-modelos", get(obtener_ia_modelos))
}

/// Rutas públicas (sin auth) relacionadas a configuración.
pub fn public_routes() -> Router<AppState> {
    Router::new().route("/branding", get(obtener_branding))
}

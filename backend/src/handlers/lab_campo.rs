use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::lab_campo::{
    CreateLabCampoDefinicion, UpdateLabCampoDefinicion, UpsertLabCampoValor,
};
use crate::errors::AppError;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/valores", get(obtener_valores).put(upsert_valores))
        .route("/{id}", put(actualizar).delete(eliminar))
}

async fn listar(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let defs = crate::services::lab_campo_service::listar_definiciones(&state.pool).await?;
    Ok(Json(serde_json::to_value(defs).unwrap_or_default()))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateLabCampoDefinicion>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let def = crate::services::lab_campo_service::crear_definicion(&state.pool, req).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::to_value(def).unwrap_or_default()),
    ))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateLabCampoDefinicion>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let def =
        crate::services::lab_campo_service::actualizar_definicion(&state.pool, id, req).await?;
    Ok(Json(serde_json::to_value(def).unwrap_or_default()))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    crate::services::lab_campo_service::eliminar_definicion(&state.pool, id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn obtener_valores(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let detalles = crate::services::lab_campo_service::obtener_detalles(&state.pool).await?;
    Ok(Json(serde_json::to_value(detalles).unwrap_or_default()))
}

async fn upsert_valores(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(valores): Json<Vec<UpsertLabCampoValor>>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    crate::services::lab_campo_service::upsert_valores(&state.pool, valores).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

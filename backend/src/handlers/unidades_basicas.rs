use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica};
use crate::errors::AppError;
use crate::models::unidad_basica::UnidadBasica;
use crate::services::unidad_basica_service;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<UnidadBasica>>, AppError> {
    let unidades = unidad_basica_service::listar(&state.pool).await?;
    Ok(Json(unidades))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateUnidadBasica>,
) -> Result<(axum::http::StatusCode, Json<UnidadBasica>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let unidad = unidad_basica_service::crear(&state.pool, req, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(unidad)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateUnidadBasica>,
) -> Result<Json<UnidadBasica>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let unidad = unidad_basica_service::actualizar(&state.pool, id, req, claims.sub).await?;
    Ok(Json(unidad))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    unidad_basica_service::eliminar(&state.pool, id, claims.sub).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
}

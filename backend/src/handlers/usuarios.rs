use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::usuario::{
    CreateUsuario, ResetPasswordRequest, UpdateUsuario, UsuarioQuery, UsuarioResponse,
};
use crate::errors::AppError;
use crate::services::usuario_service;

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<UsuarioQuery>,
) -> Result<Json<Vec<UsuarioResponse>>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let usuarios = usuario_service::listar(&state.pool, params).await?;
    Ok(Json(usuarios))
}

async fn obtener(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<UsuarioResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let usuario = usuario_service::obtener(&state.pool, id).await?;
    Ok(Json(usuario))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateUsuario>,
) -> Result<(axum::http::StatusCode, Json<UsuarioResponse>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let usuario = usuario_service::crear(&state.pool, req, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(usuario)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateUsuario>,
) -> Result<Json<UsuarioResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let usuario = usuario_service::actualizar(&state.pool, id, req, claims.sub).await?;
    Ok(Json(usuario))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    usuario_service::eliminar(&state.pool, id, claims.sub).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn reset_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    usuario_service::reset_password(&state.pool, id, req.password_nueva, claims.sub).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
        .route("/{id}/reset-password", axum::routing::post(reset_password))
}

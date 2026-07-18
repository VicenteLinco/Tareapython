use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::categoria::{CreateCategoria, UpdateCategoria};
use crate::errors::AppError;
use crate::models::categoria::Categoria;
use crate::services::categoria_service;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<Categoria>>, AppError> {
    let categorias = categoria_service::listar(&state.pool).await?;
    Ok(Json(categorias))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateCategoria>,
) -> Result<(axum::http::StatusCode, Json<Categoria>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let categoria = categoria_service::crear(&state.pool, req, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(categoria)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateCategoria>,
) -> Result<Json<Categoria>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let categoria = categoria_service::actualizar(&state.pool, id, req, claims.sub).await?;
    Ok(Json(categoria))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    categoria_service::eliminar(&state.pool, id, claims.sub).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
}

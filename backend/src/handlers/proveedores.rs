use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::proveedor::{CreateProveedor, ProveedorQuery, UpdateProveedor};
use crate::errors::AppError;
use crate::models::proveedor::Proveedor;
use crate::services::proveedor_service;

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProveedorQuery>,
) -> Result<Json<Vec<Proveedor>>, AppError> {
    let proveedores = proveedor_service::listar(&state.pool, params).await?;
    Ok(Json(proveedores))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateProveedor>,
) -> Result<(axum::http::StatusCode, Json<Proveedor>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let proveedor = proveedor_service::crear(&state.pool, req, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(proveedor)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateProveedor>,
) -> Result<Json<Proveedor>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let proveedor = proveedor_service::actualizar(&state.pool, id, req, claims.sub).await?;
    Ok(Json(proveedor))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    proveedor_service::eliminar(&state.pool, id, claims.sub).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn reactivar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Proveedor>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let proveedor = proveedor_service::reactivar(&state.pool, id, claims.sub).await?;
    Ok(Json(proveedor))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
        .route("/{id}/reactivar", axum::routing::post(reactivar))
}

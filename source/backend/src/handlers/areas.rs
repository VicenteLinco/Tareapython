use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::area::{AsignarProductosRequest, CreateArea, UpdateArea};
use crate::errors::AppError;
use crate::models::area::Area;
use crate::services::area_service;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<Area>>, AppError> {
    let areas = area_service::listar(&state.pool).await?;
    Ok(Json(areas))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateArea>,
) -> Result<(axum::http::StatusCode, Json<Area>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let area = area_service::crear(&state.pool, req, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(area)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateArea>,
) -> Result<Json<Area>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let area = area_service::actualizar(&state.pool, id, req, claims.sub).await?;
    Ok(Json(area))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let resultado = area_service::eliminar(&state.pool, id, claims.sub).await?;
    let mensaje = match resultado {
        area_service::EliminarResultado::Eliminada => "Área eliminada",
        area_service::EliminarResultado::Desactivada => "Área desactivada (tiene stock activo)",
    };
    Ok(Json(serde_json::json!({ "ok": true, "mensaje": mensaje })))
}

async fn listar_productos_area(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    let productos = area_service::listar_productos(&state.pool, id).await?;
    Ok(Json(json!(productos)))
}

async fn asignar_productos_area(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<AsignarProductosRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let count = area_service::asignar_productos(&state.pool, id, req.productos, claims.sub).await?;
    Ok(Json(json!({"asignados": count})))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
        .route(
            "/{id}/productos",
            get(listar_productos_area).put(asignar_productos_area),
        )
}

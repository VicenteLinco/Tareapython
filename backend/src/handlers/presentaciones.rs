use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;
use crate::models::presentacion::Presentacion;
use crate::services::presentacion_service::{
    PresentacionService, CrearPresentacionParams, ActualizarPresentacionParams,
};

#[derive(Debug, Deserialize)]
struct CreatePresentacion {
    nombre: String,
    nombre_plural: String,
    factor_conversion: Decimal,
    codigo_barras: Option<String>,
    gtin: Option<String>,
    gs1_habilitado: Option<bool>,
    sku: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdatePresentacion {
    nombre: Option<String>,
    nombre_plural: Option<String>,
    factor_conversion: Option<Decimal>,
    codigo_barras: Option<String>,
    gtin: Option<String>,
    gs1_habilitado: Option<bool>,
    sku: Option<String>,
    version: i32,
}

async fn listar(
    State(state): State<AppState>,
    Path(producto_id): Path<Uuid>,
) -> Result<Json<Vec<Presentacion>>, AppError> {
    let presentaciones = PresentacionService::listar(&state.pool, producto_id).await?;
    Ok(Json(presentaciones))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(producto_id): Path<Uuid>,
    Json(req): Json<CreatePresentacion>,
) -> Result<(axum::http::StatusCode, Json<Presentacion>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let params = CrearPresentacionParams {
        nombre: req.nombre,
        nombre_plural: req.nombre_plural,
        factor_conversion: req.factor_conversion,
        codigo_barras: req.codigo_barras,
        gtin: req.gtin,
        gs1_habilitado: req.gs1_habilitado,
        sku: req.sku,
    };

    let presentacion = PresentacionService::crear(&state.pool, producto_id, params, claims.sub).await?;
    Ok((axum::http::StatusCode::CREATED, Json(presentacion)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdatePresentacion>,
) -> Result<Json<Presentacion>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let params = ActualizarPresentacionParams {
        nombre: req.nombre,
        nombre_plural: req.nombre_plural,
        factor_conversion: req.factor_conversion,
        codigo_barras: req.codigo_barras,
        gtin: req.gtin,
        gs1_habilitado: req.gs1_habilitado,
        sku: req.sku,
        version: req.version,
    };

    let presentacion = PresentacionService::actualizar(&state.pool, id, params, claims.sub).await?;
    Ok(Json(presentacion))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    PresentacionService::eliminar(&state.pool, id, claims.sub).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Rutas anidadas bajo /productos/:producto_id/presentaciones
pub fn nested_routes() -> Router<AppState> {
    Router::new().route("/", get(listar).post(crear))
}

/// Rutas directas bajo /presentaciones/:id
pub fn direct_routes() -> Router<AppState> {
    Router::new().route("/{id}", put(actualizar).delete(eliminar))
}

use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::presentacion::{AssignGtinRequest, AssignGtinResponse};
use crate::errors::AppError;
use crate::models::presentacion::Presentacion;
use crate::services::presentacion_service::{
    ActualizarPresentacionParams, CrearPresentacionParams, PresentacionService,
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

/// POST /api/v1/presentaciones/:id/assign-gtin
///
/// Assigns a GTIN to a presentation. Accepts either an explicit GTIN from
/// the supplier or requests auto-generation using the company prefix stored
/// in configuracion.
pub async fn assign_gtin(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<AssignGtinRequest>,
) -> Result<Json<AssignGtinResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let gtin: String;
    let generated: bool;

    if let Some(explicit_gtin) = req.gtin {
        let len = explicit_gtin.len();
        if len != 13 && len != 14 {
            return Err(AppError::Validation(
                "GTIN must be 13 or 14 digits".into(),
            ));
        }
        if !explicit_gtin.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation("GTIN must contain only digits".into()));
        }
        gtin = explicit_gtin;
        generated = false;
    } else if req.generate_internal == Some(true) {
        let row: (String,) = sqlx::query_as("SELECT public.generar_gtin_interno()")
            .fetch_one(&state.pool)
            .await?;
        gtin = row.0;
        generated = true;
    } else {
        return Err(AppError::Validation(
            "Provide either gtin or generate_internal: true".into(),
        ));
    }

    let updated = sqlx::query(
        "UPDATE presentaciones SET gtin = $1, gs1_habilitado = true \
         WHERE id = $2 AND deleted_at IS NULL",
    )
    .bind(&gtin)
    .bind(id)
    .execute(&state.pool)
    .await;

    match updated {
        Ok(r) if r.rows_affected() == 0 => {
            return Err(AppError::NotFound("Presentacion not found".into()));
        }
        Ok(_) => {}
        Err(e) => {
            // Unique constraint violation on gtin
            let msg = e.to_string();
            if msg.contains("idx_presentaciones_gtin_active")
                || (msg.contains("unique") && msg.contains("gtin"))
            {
                return Err(AppError::Conflict("GTIN already assigned to another active presentation".into()));
            }
            return Err(AppError::Sqlx(e));
        }
    }

    Ok(Json(AssignGtinResponse {
        presentacion_id: id,
        gtin,
        generated,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BulkAssignGtinRequest {
    generate_missing: bool,
}

#[derive(Debug, Serialize)]
pub struct BulkAssignGtinResponse {
    updated: usize,
}

/// POST /api/v1/presentaciones/bulk-assign-gtin
///
/// Generates and assigns internal GTINs to all active presentations that
/// currently have no GTIN assigned.
pub async fn bulk_assign_gtin(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<BulkAssignGtinRequest>,
) -> Result<Json<BulkAssignGtinResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if !req.generate_missing {
        return Ok(Json(BulkAssignGtinResponse { updated: 0 }));
    }

    // Fetch IDs of presentations without a GTIN
    let ids: Vec<(i32,)> = sqlx::query_as(
        "SELECT id FROM presentaciones WHERE gtin IS NULL AND activa = true AND deleted_at IS NULL",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut count = 0usize;
    for (pres_id,) in ids {
        let row: (String,) = sqlx::query_as("SELECT public.generar_gtin_interno()")
            .fetch_one(&state.pool)
            .await?;
        let new_gtin = row.0;

        let result = sqlx::query(
            "UPDATE presentaciones SET gtin = $1, gs1_habilitado = true \
             WHERE id = $2 AND gtin IS NULL",
        )
        .bind(&new_gtin)
        .bind(pres_id)
        .execute(&state.pool)
        .await;

        // Skip on unique conflict (race condition) — continue with remaining
        match result {
            Ok(r) if r.rows_affected() > 0 => count += 1,
            _ => {}
        }
    }

    Ok(Json(BulkAssignGtinResponse { updated: count }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PresentacionConProducto {
    pub id: i32,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub nombre: String,
    pub nombre_plural: String,
    pub gtin: Option<String>,
    pub gs1_habilitado: bool,
    pub activa: bool,
}

/// GET /api/v1/presentaciones
///
/// Returns all active presentations with their product name, for GTIN management.
pub async fn listar_todas(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<PresentacionConProducto>>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let rows: Vec<PresentacionConProducto> = sqlx::query_as(
        "SELECT p.id, p.producto_id, pr.nombre AS producto_nombre, \
                p.nombre, p.nombre_plural, p.gtin, p.gs1_habilitado, p.activa \
         FROM presentaciones p \
         JOIN productos pr ON pr.id = p.producto_id \
         WHERE p.deleted_at IS NULL AND pr.deleted_at IS NULL \
         ORDER BY pr.nombre, p.nombre",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

/// Rutas anidadas bajo /productos/:producto_id/presentaciones
pub fn nested_routes() -> Router<AppState> {
    Router::new().route("/", get(listar).post(crear))
}

/// Rutas directas bajo /presentaciones/:id
pub fn direct_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar_todas))
        .route("/{id}", put(actualizar).delete(eliminar))
        .route("/{id}/assign-gtin", post(assign_gtin))
        .route("/bulk-assign-gtin", post(bulk_assign_gtin))
}

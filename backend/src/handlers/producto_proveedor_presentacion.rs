use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, patch};
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::producto_proveedor_presentacion::{
    CreateProductoProveedorPresentacion, ProductoProveedorPresentacionRow,
};
use crate::errors::AppError;

// ─── listar ──────────────────────────────────────────────────────────────────

/// GET /api/v1/producto-proveedor/:pp_id/presentaciones
/// Returns all active presentation links for a supplier+product record.
async fn listar(
    State(state): State<AppState>,
    Path(pp_id): Path<i32>,
) -> Result<Json<Vec<ProductoProveedorPresentacionRow>>, AppError> {
    let rows = sqlx::query_as::<_, ProductoProveedorPresentacionRow>(
        r#"
        SELECT
            ppp.id,
            ppp.presentacion_id,
            pr.nombre          AS presentacion_nombre,
            pr.nombre_plural   AS presentacion_nombre_plural,
            pr.factor_conversion,
            ppp.es_default,
            ppp.precio_unidad,
            ppp.activo
        FROM producto_proveedor_presentacion ppp
        JOIN presentaciones pr ON pr.id = ppp.presentacion_id
        WHERE ppp.producto_proveedor_id = $1
          AND ppp.activo = true
          AND pr.deleted_at IS NULL
        ORDER BY ppp.es_default DESC, pr.nombre
        "#,
    )
    .bind(pp_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

// ─── agregar ─────────────────────────────────────────────────────────────────

/// POST /api/v1/producto-proveedor/:pp_id/presentaciones
/// Adds a presentation link. Validates that the presentation belongs to the
/// same product as the supplier+product record (cross-product guard).
async fn agregar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(pp_id): Path<i32>,
    Json(dto): Json<CreateProductoProveedorPresentacion>,
) -> Result<(StatusCode, Json<ProductoProveedorPresentacionRow>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Cross-product guard: verify the presentation belongs to the same product
    // as the producto_proveedor record.
    let matches: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM producto_proveedor pp
            JOIN presentaciones pr ON pr.producto_id = pp.producto_id
            WHERE pp.id = $1
              AND pr.id = $2
              AND pr.deleted_at IS NULL
        )
        "#,
    )
    .bind(pp_id)
    .bind(dto.presentacion_id)
    .fetch_one(&state.pool)
    .await?;

    if !matches {
        return Err(AppError::BusinessLogic(
            "La presentación no pertenece al mismo producto que el vínculo de proveedor."
                .to_string(),
            "PPP_CROSS_PRODUCT".to_string(),
        ));
    }

    // Insert; let UNIQUE constraint surface as 409 via AppError::Sqlx handler.
    let row: ProductoProveedorPresentacionRow = sqlx::query_as(
        r#"
        INSERT INTO producto_proveedor_presentacion
            (producto_proveedor_id, presentacion_id, es_default, precio_unidad, activo)
        VALUES ($1, $2, $3, $4, true)
        RETURNING
            id,
            presentacion_id,
            (SELECT nombre        FROM presentaciones WHERE id = $2) AS presentacion_nombre,
            (SELECT nombre_plural FROM presentaciones WHERE id = $2) AS presentacion_nombre_plural,
            (SELECT factor_conversion FROM presentaciones WHERE id = $2) AS factor_conversion,
            es_default,
            precio_unidad,
            activo
        "#,
    )
    .bind(pp_id)
    .bind(dto.presentacion_id)
    .bind(dto.es_default)
    .bind(dto.precio_unidad)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(row)))
}

// ─── set_default ─────────────────────────────────────────────────────────────

/// PATCH /api/v1/producto-proveedor/:pp_id/presentaciones/:ppp_id/set-default
/// Atomically clears the current default and sets the target as default.
/// Returns 422 if the target row is inactive or does not belong to pp_id.
async fn set_default(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((pp_id, ppp_id)): Path<(i32, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let mut tx = state.pool.begin().await?;

    // Step 1: clear the current default for this supplier+product link.
    // This must happen first to free the partial unique index before setting a
    // new default.
    sqlx::query(
        "UPDATE producto_proveedor_presentacion \
         SET es_default = false \
         WHERE producto_proveedor_id = $1 AND es_default = true",
    )
    .bind(pp_id)
    .execute(&mut *tx)
    .await?;

    // Step 2: set the target row as default (only if it belongs to pp_id and is active).
    let updated = sqlx::query(
        "UPDATE producto_proveedor_presentacion \
         SET es_default = true \
         WHERE id = $1 AND producto_proveedor_id = $2 AND activo = true",
    )
    .bind(ppp_id)
    .bind(pp_id)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(AppError::BusinessLogic(
            "La presentación no existe, no es activa, o no pertenece a este vínculo."
                .to_string(),
            "PPP_INACTIVE".to_string(),
        ));
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── quitar ──────────────────────────────────────────────────────────────────

/// DELETE /api/v1/producto-proveedor/:pp_id/presentaciones/:ppp_id
/// Soft-deletes a presentation link. Returns 422 if the link is the current
/// default (must set another default first).
async fn quitar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((pp_id, ppp_id)): Path<(i32, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Guard: reject if this is the current default.
    let is_default: bool = sqlx::query_scalar(
        "SELECT es_default FROM producto_proveedor_presentacion \
         WHERE id = $1 AND producto_proveedor_id = $2",
    )
    .bind(ppp_id)
    .bind(pp_id)
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or(false);

    if is_default {
        return Err(AppError::BusinessLogic(
            "No se puede eliminar la presentación predeterminada. Asigne otra primero."
                .to_string(),
            "PPP_IS_DEFAULT".to_string(),
        ));
    }

    // Soft delete: set activo = false, clear es_default for safety.
    let updated = sqlx::query(
        "UPDATE producto_proveedor_presentacion \
         SET activo = false, es_default = false \
         WHERE id = $1 AND producto_proveedor_id = $2",
    )
    .bind(ppp_id)
    .bind(pp_id)
    .execute(&state.pool)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Presentación de proveedor no encontrada.".to_string(),
        ));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Router ──────────────────────────────────────────────────────────────────

/// Returns the nested router for /producto-proveedor/{id}/presentaciones.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(agregar))
        .route("/{ppp_id}/set-default", patch(set_default))
        .route("/{ppp_id}", delete(quitar))
}

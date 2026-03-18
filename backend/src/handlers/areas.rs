use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::area::{CreateArea, UpdateArea};
use crate::errors::{validate_text_length, AppError};
use crate::models::area::Area;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<Area>>, AppError> {
    let areas = sqlx::query_as::<_, Area>(
        "SELECT * FROM areas WHERE activa = true ORDER BY nombre",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(areas))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateArea>,
) -> Result<(axum::http::StatusCode, Json<Area>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;

    let area = sqlx::query_as::<_, Area>(
        "INSERT INTO areas (nombre, es_bodega) VALUES ($1, $2) RETURNING *",
    )
    .bind(&nombre)
    .bind(req.es_bodega.unwrap_or(false))
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("El área '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('areas', $1, 'CREATE', $2, $3)",
    )
    .bind(area.id.to_string())
    .bind(json!({"nombre": &area.nombre, "es_bodega": area.es_bodega}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(area)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateArea>,
) -> Result<Json<Area>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let anterior = sqlx::query_as::<_, Area>("SELECT * FROM areas WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }
    let es_bodega = req.es_bodega.unwrap_or(anterior.es_bodega);

    let area = sqlx::query_as::<_, Area>(
        "UPDATE areas SET nombre = $1, es_bodega = $2 WHERE id = $3 RETURNING *",
    )
    .bind(nombre)
    .bind(es_bodega)
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("El área '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('areas', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre, "es_bodega": anterior.es_bodega}))
    .bind(json!({"nombre": &area.nombre, "es_bodega": area.es_bodega}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(area))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Verificar si tiene stock
    let stock_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM stock WHERE area_id = $1 AND cantidad > 0")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    if stock_count.0 > 0 {
        // Soft delete si tiene stock
        sqlx::query("UPDATE areas SET activa = false WHERE id = $1")
            .bind(id)
            .execute(&state.pool)
            .await?;
    } else {
        let result = sqlx::query("DELETE FROM areas WHERE id = $1")
            .bind(id)
            .execute(&state.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Área no encontrada".into()));
        }
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('areas', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /areas/:id/productos - productos asignados a un área
async fn listar_productos_area(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verificar que el área existe
    let _area = sqlx::query_as::<_, Area>("SELECT * FROM areas WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let productos = sqlx::query_as::<_, ProductoAreaRow>(
        r#"SELECT p.id, p.codigo_interno, p.nombre
           FROM producto_area pa
           JOIN productos p ON p.id = pa.producto_id
           WHERE pa.area_id = $1 AND p.activo = true
           ORDER BY p.nombre"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!(productos)))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct ProductoAreaRow {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
}

/// PUT /areas/:id/productos - reemplazar asignación de productos
async fn asignar_productos_area(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<AsignarProductosRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Verificar que el área existe
    sqlx::query_as::<_, Area>("SELECT * FROM areas WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let mut tx = state.pool.begin().await?;

    // Eliminar asignaciones actuales
    sqlx::query("DELETE FROM producto_area WHERE area_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Insertar nuevas
    for producto_id in &req.producto_ids {
        sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
            .bind(producto_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    Ok(Json(json!({"asignados": req.producto_ids.len()})))
}

#[derive(Debug, serde::Deserialize)]
struct AsignarProductosRequest {
    producto_ids: Vec<Uuid>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
        .route("/{id}/productos", get(listar_productos_area).put(asignar_productos_area))
}

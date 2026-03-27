use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica};
use crate::errors::{validate_text_length, AppError};
use crate::models::unidad_basica::UnidadBasica;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<UnidadBasica>>, AppError> {
    let unidades =
        sqlx::query_as::<_, UnidadBasica>("SELECT * FROM unidades_basicas ORDER BY nombre")
            .fetch_all(&state.pool)
            .await?;
    Ok(Json(unidades))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateUnidadBasica>,
) -> Result<(axum::http::StatusCode, Json<UnidadBasica>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    let nombre_plural = req.nombre_plural.trim().to_string();
    if nombre.is_empty() || nombre_plural.is_empty() {
        return Err(AppError::Validation(
            "Nombre singular y plural son requeridos".into(),
        ));
    }
    validate_text_length(&nombre, "nombre", 50)?;
    validate_text_length(&nombre_plural, "nombre_plural", 50)?;

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2) RETURNING *",
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict("Ya existe una unidad con ese nombre".into())
        }
        _ => e.into(),
    })?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('unidades_basicas', $1, 'CREATE', $2, $3)",
    )
    .bind(unidad.id.to_string())
    .bind(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(unidad)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateUnidadBasica>,
) -> Result<Json<UnidadBasica>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let anterior =
        sqlx::query_as::<_, UnidadBasica>("SELECT * FROM unidades_basicas WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound("Unidad básica no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let nombre_plural = req
        .nombre_plural
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre_plural);

    if nombre.is_empty() || nombre_plural.is_empty() {
        return Err(AppError::Validation(
            "Nombre singular y plural no pueden estar vacíos".into(),
        ));
    }

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "UPDATE unidades_basicas SET nombre = $1, nombre_plural = $2 WHERE id = $3 RETURNING *",
    )
    .bind(nombre)
    .bind(nombre_plural)
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict("Ya existe una unidad con ese nombre".into())
        }
        _ => e.into(),
    })?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('unidades_basicas', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre, "nombre_plural": &anterior.nombre_plural}))
    .bind(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(unidad))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM productos WHERE unidad_base_id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    if count.0 > 0 {
        return Err(AppError::BusinessLogic(
            format!(
                "No se puede eliminar: tiene {} productos asociados",
                count.0
            ),
            "TIENE_DEPENDENCIAS".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM unidades_basicas WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Unidad básica no encontrada".into()));
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('unidades_basicas', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
}

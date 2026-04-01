use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;

use validator::Validate;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica};
use crate::errors::{validate_text_length, AppError};
use crate::models::unidad_basica::UnidadBasica;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<UnidadBasica>>, AppError> {
    let unidades =
        sqlx::query_as::<_, UnidadBasica>("SELECT * FROM unidades_basicas WHERE activo = true ORDER BY nombre")
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
    req.validate()?;

    let nombre = req.nombre.trim().to_string();
    let nombre_plural = req.nombre_plural.trim().to_string();
    if nombre.is_empty() || nombre_plural.is_empty() {
        return Err(AppError::Validation(
            "Nombre singular y plural son requeridos".into(),
        ));
    }
    validate_text_length(&nombre, "nombre", 50)?;
    validate_text_length(&nombre_plural, "nombre_plural", 50)?;

    // ON CONFLICT: si existía una unidad inactiva con el mismo nombre, la reactiva
    let unidad = sqlx::query_as::<_, UnidadBasica>(
        r#"INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2)
           ON CONFLICT (nombre) DO UPDATE SET activo = true, nombre_plural = EXCLUDED.nombre_plural, version = unidades_basicas.version + 1
           RETURNING *"#,
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(&state.pool)
    .await?;

    crate::services::audit::registrar(
        &state.pool, "unidades_basicas", &unidad.id.to_string(), "CREATE",
        None,
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        claims.sub,
    ).await?;

    Ok((axum::http::StatusCode::CREATED, Json(unidad)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateUnidadBasica>,
) -> Result<Json<UnidadBasica>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    req.validate()?;

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
        "UPDATE unidades_basicas SET nombre = $1, nombre_plural = $2, version = version + 1 WHERE id = $3 AND version = $4 RETURNING *",
    )
    .bind(nombre)
    .bind(nombre_plural)
    .bind(id)
    .bind(req.version)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict("Ya existe una unidad con ese nombre".into())
        }
        _ => e.into(),
    })?
    .ok_or(AppError::Conflict("La unidad ha sido modificada por otro usuario (error de versión)".into()))?;

    crate::services::audit::registrar(
        &state.pool, "unidades_basicas", &id.to_string(), "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "nombre_plural": &anterior.nombre_plural})),
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        claims.sub,
    ).await?;

    Ok(Json(unidad))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Soft delete universal: siempre marcamos como inactivo
    let result = sqlx::query("UPDATE unidades_basicas SET activo = false WHERE id = $1 AND activo = true")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Unidad básica no encontrada o ya inactiva".into()));
    }

    crate::services::audit::registrar(
        &state.pool, "unidades_basicas", &id.to_string(), "DELETE",
        None, None, claims.sub,
    ).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
}

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::{AppError, validate_text_length};

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct PresentacionFormato {
    pub id: i32,
    pub nombre: String,
    pub nombre_plural: String,
    pub activo: bool,
    pub es_predefinido: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct CreatePresentacionFormato {
    nombre: String,
    nombre_plural: Option<String>,
}

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<PresentacionFormato>>, AppError> {
    let formatos = sqlx::query_as::<_, PresentacionFormato>(
        "SELECT id, nombre, nombre_plural, activo, es_predefinido, created_at
         FROM presentacion_formatos
         WHERE activo = true
         ORDER BY nombre",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(formatos))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreatePresentacionFormato>,
) -> Result<(axum::http::StatusCode, Json<PresentacionFormato>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 100)?;

    let nombre_plural = req
        .nombre_plural
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(&nombre)
        .to_string();
    validate_text_length(&nombre_plural, "nombre_plural", 100)?;

    let formato = sqlx::query_as::<_, PresentacionFormato>(
        r#"INSERT INTO presentacion_formatos (nombre, nombre_plural)
           VALUES ($1, $2)
           ON CONFLICT (nombre)
           DO UPDATE SET nombre_plural = EXCLUDED.nombre_plural, activo = true
           RETURNING id, nombre, nombre_plural, activo, es_predefinido, created_at"#,
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(formato)))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let result = sqlx::query("UPDATE presentacion_formatos SET activo = false WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Formato no encontrado".into()));
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", axum::routing::delete(eliminar))
}

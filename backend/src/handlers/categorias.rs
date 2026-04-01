use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;

use validator::Validate;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::categoria::{CreateCategoria, UpdateCategoria};
use crate::errors::{validate_text_length, AppError};
use crate::models::categoria::Categoria;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<Categoria>>, AppError> {
    let categorias = sqlx::query_as::<_, Categoria>("SELECT * FROM categorias WHERE activo = true ORDER BY nombre")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(categorias))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateCategoria>,
) -> Result<(axum::http::StatusCode, Json<Categoria>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    req.validate()?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    if let Some(ref desc) = req.descripcion {
        validate_text_length(desc, "descripcion", 1000)?;
    }

    // ON CONFLICT: si existía una categoría inactiva con el mismo nombre, la reactiva
    let categoria = sqlx::query_as::<_, Categoria>(
        r#"INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2)
           ON CONFLICT (nombre) DO UPDATE SET activo = true, descripcion = EXCLUDED.descripcion, version = categorias.version + 1
           RETURNING *"#,
    )
    .bind(&nombre)
    .bind(&req.descripcion)
    .fetch_one(&state.pool)
    .await?;

    crate::services::audit::registrar(
        &state.pool, "categorias", &categoria.id.to_string(), "CREATE",
        None,
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        claims.sub,
    ).await?;

    Ok((axum::http::StatusCode::CREATED, Json(categoria)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateCategoria>,
) -> Result<Json<Categoria>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    req.validate()?;

    let anterior = sqlx::query_as::<_, Categoria>("SELECT * FROM categorias WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Categoría no encontrada".into()))?;

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or(&anterior.nombre);
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }
    let descripcion = match &req.descripcion {
        Some(d) => Some(d.as_str()),
        None => anterior.descripcion.as_deref(),
    };

    let categoria = sqlx::query_as::<_, Categoria>(
        "UPDATE categorias SET nombre = $1, descripcion = $2, version = version + 1 WHERE id = $3 AND version = $4 RETURNING *",
    )
    .bind(nombre)
    .bind(descripcion)
    .bind(id)
    .bind(req.version)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("La categoría '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?
    .ok_or(AppError::Conflict("La categoría ha sido modificada por otro usuario (error de versión)".into()))?;

    crate::services::audit::registrar(
        &state.pool, "categorias", &id.to_string(), "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "descripcion": &anterior.descripcion})),
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        claims.sub,
    ).await?;

    Ok(Json(categoria))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Soft delete universal: siempre marcamos como inactivo
    let result = sqlx::query("UPDATE categorias SET activo = false WHERE id = $1 AND activo = true")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Categoría no encontrada o ya inactiva".into()));
    }

    crate::services::audit::registrar(
        &state.pool, "categorias", &id.to_string(), "DELETE",
        None, None, claims.sub,
    ).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
}

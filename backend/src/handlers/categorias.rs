use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde_json::json;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::categoria::{CreateCategoria, UpdateCategoria};
use crate::errors::{validate_text_length, AppError};
use crate::models::categoria::Categoria;

async fn listar(State(state): State<AppState>) -> Result<Json<Vec<Categoria>>, AppError> {
    let categorias = sqlx::query_as::<_, Categoria>("SELECT * FROM categorias ORDER BY nombre")
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

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    if let Some(ref desc) = req.descripcion {
        validate_text_length(desc, "descripcion", 1000)?;
    }

    let categoria = sqlx::query_as::<_, Categoria>(
        "INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2) RETURNING *",
    )
    .bind(&nombre)
    .bind(&req.descripcion)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("La categoría '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    // Audit log
    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('categorias', $1, 'CREATE', $2, $3)",
    )
    .bind(categoria.id.to_string())
    .bind(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(categoria)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateCategoria>,
) -> Result<Json<Categoria>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

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
        "UPDATE categorias SET nombre = $1, descripcion = $2 WHERE id = $3 RETURNING *",
    )
    .bind(nombre)
    .bind(descripcion)
    .bind(id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("La categoría '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    // Audit log
    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('categorias', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre, "descripcion": &anterior.descripcion}))
    .bind(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(categoria))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Verificar que no tenga productos asociados
    let count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM productos WHERE categoria_id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    if count.0 > 0 {
        return Err(AppError::BusinessLogic(
            format!("No se puede eliminar: tiene {} productos asociados", count.0),
            "TIENE_DEPENDENCIAS".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM categorias WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Categoría no encontrada".into()));
    }

    // Audit log
    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('categorias', $1, 'DELETE', $2)",
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

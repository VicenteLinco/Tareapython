use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::proveedor::{CreateProveedor, UpdateProveedor};
use crate::errors::{validate_text_length, AppError};
use crate::models::proveedor::Proveedor;

#[derive(Debug, Deserialize)]
struct ProveedorQuery {
    q: Option<String>,
    activo: Option<bool>,
}

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProveedorQuery>,
) -> Result<Json<Vec<Proveedor>>, AppError> {
    let activo = params.activo.unwrap_or(true);

    let proveedores = if let Some(q) = &params.q {
        let pattern = format!("%{}%", q);
        sqlx::query_as::<_, Proveedor>(
            "SELECT * FROM proveedores WHERE activo = $1 AND nombre ILIKE $2 ORDER BY nombre",
        )
        .bind(activo)
        .bind(&pattern)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Proveedor>(
            "SELECT * FROM proveedores WHERE activo = $1 ORDER BY nombre",
        )
        .bind(activo)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(proveedores))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateProveedor>,
) -> Result<(axum::http::StatusCode, Json<Proveedor>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    if let Some(ref c) = req.contacto { validate_text_length(c, "contacto", 255)?; }
    if let Some(ref t) = req.telefono { validate_text_length(t, "telefono", 50)?; }
    if let Some(ref e) = req.email { validate_text_length(e, "email", 255)?; }

    let proveedor = sqlx::query_as::<_, Proveedor>(
        "INSERT INTO proveedores (nombre, contacto, telefono, email, icono, dias_despacho_aereo, dias_despacho_tierra) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    )
    .bind(&nombre)
    .bind(&req.contacto)
    .bind(&req.telefono)
    .bind(&req.email)
    .bind(&req.icono)
    .bind(req.dias_despacho_aereo)
    .bind(req.dias_despacho_tierra)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('proveedores', $1, 'CREATE', $2, $3)",
    )
    .bind(proveedor.id.to_string())
    .bind(json!({"nombre": &proveedor.nombre}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(proveedor)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdateProveedor>,
) -> Result<Json<Proveedor>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let anterior = sqlx::query_as::<_, Proveedor>("SELECT * FROM proveedores WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Proveedor no encontrado".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }

    let proveedor = sqlx::query_as::<_, Proveedor>(
        r#"UPDATE proveedores
           SET nombre = $1, contacto = $2, telefono = $3, email = $4,
               icono = $5, dias_despacho_aereo = $6, dias_despacho_tierra = $7,
               version = version + 1
           WHERE id = $8 AND version = $9
           RETURNING *"#,
    )
    .bind(nombre)
    .bind(req.contacto.as_deref().or(anterior.contacto.as_deref()))
    .bind(req.telefono.as_deref().or(anterior.telefono.as_deref()))
    .bind(req.email.as_deref().or(anterior.email.as_deref()))
    .bind(req.icono.as_deref().or(anterior.icono.as_deref()))
    .bind(req.dias_despacho_aereo.or(anterior.dias_despacho_aereo))
    .bind(req.dias_despacho_tierra.or(anterior.dias_despacho_tierra))
    .bind(id)
    .bind(req.version)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Conflict(
        "El registro fue modificado por otro usuario. Recarga e intenta de nuevo.".into(),
    ))?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('proveedores', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre}))
    .bind(json!({"nombre": &proveedor.nombre}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(proveedor))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let result = sqlx::query(
        "UPDATE proveedores SET activo = false WHERE id = $1 AND activo = true",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Proveedor no encontrado".into()));
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('proveedores', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn reactivar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<Proveedor>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let proveedor = sqlx::query_as::<_, Proveedor>(
        "UPDATE proveedores SET activo = true WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Proveedor no encontrado".into()))?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('proveedores', $1, 'UPDATE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(proveedor))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", put(actualizar).delete(eliminar))
        .route("/{id}/reactivar", axum::routing::post(reactivar))
}

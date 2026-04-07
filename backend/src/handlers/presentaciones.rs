use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::{validate_text_length, AppError};
use crate::models::presentacion::Presentacion;

#[derive(Debug, Deserialize)]
struct CreatePresentacion {
    nombre: String,
    nombre_plural: String,
    factor_conversion: Decimal,
    codigo_barras: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdatePresentacion {
    nombre: Option<String>,
    nombre_plural: Option<String>,
    factor_conversion: Option<Decimal>,
    codigo_barras: Option<String>,
    version: i32,
}

async fn listar(
    State(state): State<AppState>,
    Path(producto_id): Path<Uuid>,
) -> Result<Json<Vec<Presentacion>>, AppError> {
    let presentaciones = sqlx::query_as::<_, Presentacion>(
        "SELECT * FROM presentaciones WHERE producto_id = $1 AND activa = true ORDER BY nombre",
    )
    .bind(producto_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(presentaciones))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(producto_id): Path<Uuid>,
    Json(req): Json<CreatePresentacion>,
) -> Result<(axum::http::StatusCode, Json<Presentacion>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    let nombre_plural = req.nombre_plural.trim().to_string();
    if nombre_plural.is_empty() {
        return Err(AppError::Validation("El plural es requerido".into()));
    }
    validate_text_length(&nombre_plural, "nombre_plural", 100)?;
    if let Some(ref cb) = req.codigo_barras {
        validate_text_length(cb, "codigo_barras", 100)?;
    }
    if req.factor_conversion <= Decimal::ZERO {
        return Err(AppError::Validation(
            "El factor de conversión debe ser mayor a 0".into(),
        ));
    }

    // Verificar que el producto existe
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1)")
            .bind(producto_id)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(AppError::NotFound("Producto no encontrado".into()));
    }

    let presentacion = sqlx::query_as::<_, Presentacion>(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(producto_id)
    .bind(&nombre)
    .bind(&nombre_plural)
    .bind(req.factor_conversion)
    .bind(&req.codigo_barras)
    .fetch_one(&state.pool)
    .await?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('presentaciones', $1, 'CREATE', $2, $3)",
    )
    .bind(presentacion.id.to_string())
    .bind(json!({"nombre": &presentacion.nombre, "factor_conversion": presentacion.factor_conversion.to_string()}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok((axum::http::StatusCode::CREATED, Json(presentacion)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(req): Json<UpdatePresentacion>,
) -> Result<Json<Presentacion>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let anterior =
        sqlx::query_as::<_, Presentacion>("SELECT * FROM presentaciones WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound("Presentación no encontrada".into()))?;

    if req.version != anterior.version {
        return Err(AppError::Conflict(
            "El registro fue modificado por otro usuario".into(),
        ));
    }

    // No permitir cambiar factor_conversion si hay recepciones que la usaron
    if let Some(new_factor) = req.factor_conversion {
        if new_factor != anterior.factor_conversion {
            let used: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM recepcion_detalle WHERE presentacion_id = $1)",
            )
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

            if used {
                return Err(AppError::BusinessLogic(
                    "No se puede cambiar el factor de conversión: ya fue usada en recepciones"
                        .into(),
                    "FACTOR_EN_USO".into(),
                ));
            }
        }
    }

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or(&anterior.nombre);
    let nombre_plural = req.nombre_plural.as_deref().map(str::trim).unwrap_or(&anterior.nombre_plural);
    let factor = req.factor_conversion.unwrap_or(anterior.factor_conversion);

    let presentacion = sqlx::query_as::<_, Presentacion>(
        "UPDATE presentaciones SET nombre = $1, nombre_plural = $2, factor_conversion = $3, codigo_barras = $4, version = version + 1 WHERE id = $5 AND version = $6 RETURNING *",
    )
    .bind(nombre)
    .bind(nombre_plural)
    .bind(factor)
    .bind(req.codigo_barras.as_deref().or(anterior.codigo_barras.as_deref()))
    .bind(id)
    .bind(req.version)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Conflict(
        "El registro fue modificado por otro usuario. Recarga e intenta de nuevo.".into(),
    ))?;

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('presentaciones', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre}))
    .bind(json!({"nombre": &presentacion.nombre}))
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(presentacion))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let result = sqlx::query(
        "UPDATE presentaciones SET activa = false WHERE id = $1 AND activa = true",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Presentación no encontrada".into()));
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('presentaciones', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

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

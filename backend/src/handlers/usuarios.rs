use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHasher};

use validator::Validate;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::usuario::{AreaSimple, CreateUsuario, UpdateUsuario, UsuarioResponse};
use crate::errors::{validate_email, validate_text_length, AppError};
use crate::models::usuario::Usuario;

#[derive(Debug, Deserialize)]
struct UsuarioQuery {
    rol: Option<String>,
    activo: Option<bool>,
}

async fn build_usuario_response(
    pool: &sqlx::PgPool,
    user: &Usuario,
) -> Result<UsuarioResponse, AppError> {
    let areas = sqlx::query_as::<_, AreaSimple>(
        "SELECT a.id, a.nombre FROM usuario_area ua JOIN areas a ON a.id = ua.area_id WHERE ua.usuario_id = $1 ORDER BY a.nombre",
    )
    .bind(user.id)
    .fetch_all(pool)
    .await?;

    Ok(UsuarioResponse {
        id: user.id,
        nombre: user.nombre.clone(),
        email: user.email.clone(),
        rol: user.rol.clone(),
        activo: user.activo,
        areas,
        version: user.version,
    })
}

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<UsuarioQuery>,
) -> Result<Json<Vec<UsuarioResponse>>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let activo = params.activo.unwrap_or(true);

    let usuarios = if let Some(rol) = &params.rol {
        sqlx::query_as::<_, Usuario>(
            "SELECT * FROM usuarios WHERE activo = $1 AND rol = $2 ORDER BY nombre",
        )
        .bind(activo)
        .bind(rol)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Usuario>(
            "SELECT * FROM usuarios WHERE activo = $1 ORDER BY nombre",
        )
        .bind(activo)
        .fetch_all(&state.pool)
        .await?
    };

    let mut responses = Vec::with_capacity(usuarios.len());
    for user in &usuarios {
        responses.push(build_usuario_response(&state.pool, user).await?);
    }

    Ok(Json(responses))
}

async fn obtener(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<UsuarioResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let user = sqlx::query_as::<_, Usuario>("SELECT * FROM usuarios WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Usuario no encontrado".into()))?;

    Ok(Json(build_usuario_response(&state.pool, &user).await?))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateUsuario>,
) -> Result<(axum::http::StatusCode, Json<UsuarioResponse>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    req.validate()?;

    let nombre = req.nombre.trim().to_string();
    let email = req.email.trim().to_lowercase();

    if nombre.is_empty() || email.is_empty() {
        return Err(AppError::Validation("Nombre y email son requeridos".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    validate_email(&email)?;
    if req.password.len() < 8 {
        return Err(AppError::Validation(
            "La contraseña debe tener al menos 8 caracteres".into(),
        ));
    }
    if !["admin", "tecnologo", "consulta"].contains(&req.rol.as_str()) {
        return Err(AppError::Validation(
            "Rol inválido. Debe ser: admin, tecnologo o consulta".into(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Error hasheando password: {}", e)))?
        .to_string();

    let mut tx = state.pool.begin().await?;

    let user = sqlx::query_as::<_, Usuario>(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(&nombre)
    .bind(&email)
    .bind(&password_hash)
    .bind(&req.rol)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("El email '{}' ya está registrado", email))
        }
        _ => e.into(),
    })?;

    // Asignar áreas
    for area_id in &req.area_ids {
        sqlx::query("INSERT INTO usuario_area (usuario_id, area_id) VALUES ($1, $2)")
            .bind(user.id)
            .bind(area_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| match &e {
                sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                    AppError::Validation(format!("Área con id {} no existe", area_id))
                }
                _ => e.into(),
            })?;
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('usuarios', $1, 'CREATE', $2, $3)",
    )
    .bind(user.id.to_string())
    .bind(json!({"nombre": &user.nombre, "email": &user.email, "rol": &user.rol}))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let response = build_usuario_response(&state.pool, &user).await?;
    Ok((axum::http::StatusCode::CREATED, Json(response)))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateUsuario>,
) -> Result<Json<UsuarioResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    req.validate()?;

    let anterior = sqlx::query_as::<_, Usuario>("SELECT * FROM usuarios WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Usuario no encontrado".into()))?;

    if req.version != anterior.version {
        return Err(AppError::Conflict(
            "El registro fue modificado por otro usuario".into(),
        ));
    }

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or(&anterior.nombre);
    let email = req.email.as_deref().map(|e| e.trim().to_lowercase());
    let email_ref = email.as_deref().unwrap_or(&anterior.email);

    if let Some(rol) = &req.rol
        && !["admin", "tecnologo", "consulta"].contains(&rol.as_str()) {
            return Err(AppError::Validation(
                "Rol inválido. Debe ser: admin, tecnologo o consulta".into(),
            ));
    }
    let rol = req.rol.as_deref().unwrap_or(&anterior.rol);

    let mut tx = state.pool.begin().await?;

    let user = sqlx::query_as::<_, Usuario>(
        "UPDATE usuarios SET nombre = $1, email = $2, rol = $3, version = version + 1, updated_at = NOW() WHERE id = $4 AND version = $5 RETURNING *",
    )
    .bind(nombre)
    .bind(email_ref)
    .bind(rol)
    .bind(id)
    .bind(req.version)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::Conflict("El usuario ha sido modificado por otro usuario (error de versión)".into()))?;

    // Reasignar áreas si se enviaron
    if let Some(area_ids) = &req.area_ids {
        sqlx::query("DELETE FROM usuario_area WHERE usuario_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        for area_id in area_ids {
            sqlx::query("INSERT INTO usuario_area (usuario_id, area_id) VALUES ($1, $2)")
                .bind(id)
                .bind(area_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| match &e {
                    sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                        AppError::Validation(format!("Área con id {} no existe", area_id))
                    }
                    _ => e.into(),
                })?;
        }
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('usuarios', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre, "email": &anterior.email, "rol": &anterior.rol}))
    .bind(json!({"nombre": &user.nombre, "email": &user.email, "rol": &user.rol}))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let response = build_usuario_response(&state.pool, &user).await?;
    Ok(Json(response))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if id == claims.sub {
        return Err(AppError::BusinessLogic(
            "No puedes desactivar tu propia cuenta".into(),
            "AUTO_DESACTIVACION".into(),
        ));
    }

    let result = sqlx::query(
        "UPDATE usuarios SET activo = false, updated_at = NOW() WHERE id = $1 AND activo = true",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Usuario no encontrado".into()));
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('usuarios', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct ResetPasswordRequest {
    password_nueva: String,
}

/// POST /api/v1/usuarios/:id/reset-password — Admin resetea contraseña de otro usuario
async fn reset_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if req.password_nueva.len() < 8 {
        return Err(AppError::Validation(
            "La contraseña debe tener al menos 8 caracteres".into(),
        ));
    }

    let salt = SaltString::generate(&mut OsRng);
    let new_hash = Argon2::default()
        .hash_password(req.password_nueva.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Error hasheando password: {}", e)))?
        .to_string();

    let result = sqlx::query(
        "UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(&new_hash)
    .bind(id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Usuario no encontrado".into()));
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
        .route("/{id}/reset-password", axum::routing::post(reset_password))
}

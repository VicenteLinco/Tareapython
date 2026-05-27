use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::dto::usuario::{
    AreaSimple, CreateUsuario, UpdateUsuario, UsuarioQuery, UsuarioResponse, validate_rol,
};
use crate::errors::AppError;
use crate::models::usuario::Usuario;

async fn build_usuario_response(
    pool: &PgPool,
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

pub async fn listar(pool: &PgPool, params: UsuarioQuery) -> Result<Vec<UsuarioResponse>, AppError> {
    #[derive(sqlx::FromRow)]
    struct AreaRow {
        usuario_id: Uuid,
        id: i32,
        nombre: String,
    }

    let activo = params.activo.unwrap_or(true);

    let usuarios = if let Some(rol) = &params.rol {
        sqlx::query_as::<_, Usuario>(
            "SELECT id, nombre, email, password_hash, rol, activo, version, created_at, updated_at FROM usuarios WHERE activo = $1 AND rol = $2 ORDER BY nombre",
        )
        .bind(activo)
        .bind(rol)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Usuario>(
            "SELECT id, nombre, email, password_hash, rol, activo, version, created_at, updated_at FROM usuarios WHERE activo = $1 ORDER BY nombre",
        )
        .bind(activo)
        .fetch_all(pool)
        .await?
    };

    if usuarios.is_empty() {
        return Ok(vec![]);
    }

    let ids: Vec<Uuid> = usuarios.iter().map(|u| u.id).collect();

    let area_rows = sqlx::query_as::<_, AreaRow>(
        "SELECT ua.usuario_id, a.id, a.nombre \
         FROM usuario_area ua \
         JOIN areas a ON a.id = ua.area_id \
         WHERE ua.usuario_id = ANY($1) \
         ORDER BY a.nombre",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    let mut areas_map: std::collections::HashMap<Uuid, Vec<AreaSimple>> =
        std::collections::HashMap::new();
    for row in area_rows {
        areas_map
            .entry(row.usuario_id)
            .or_default()
            .push(AreaSimple {
                id: row.id,
                nombre: row.nombre,
            });
    }

    Ok(usuarios
        .into_iter()
        .map(|u| {
            let areas = areas_map.remove(&u.id).unwrap_or_default();
            UsuarioResponse {
                id: u.id,
                nombre: u.nombre,
                email: u.email,
                rol: u.rol,
                activo: u.activo,
                areas,
                version: u.version,
            }
        })
        .collect())
}

pub async fn obtener(pool: &PgPool, id: Uuid) -> Result<UsuarioResponse, AppError> {
    let user = sqlx::query_as::<_, Usuario>(
        "SELECT id, nombre, email, password_hash, rol, activo, version, created_at, updated_at FROM usuarios WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Usuario no encontrado".into()))?;

    build_usuario_response(pool, &user).await
}

pub async fn crear(
    pool: &PgPool,
    req: CreateUsuario,
    admin_id: Uuid,
) -> Result<UsuarioResponse, AppError> {
    req.validate()?;

    let nombre = req.nombre.trim().to_string();
    let email = req.email.trim().to_lowercase();

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Error hasheando password: {}", e)))?
        .to_string();

    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, Usuario>(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) \
         RETURNING id, nombre, email, password_hash, rol, activo, version, created_at, updated_at",
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

    for area_id in &req.area_ids {
        sqlx::query("INSERT INTO usuario_area (usuario_id, area_id) VALUES ($1, $2)")
            .bind(user.id)
            .bind(area_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    crate::services::audit::registrar(
        pool,
        "usuarios",
        &user.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &user.nombre, "email": &user.email, "rol": &user.rol})),
        admin_id,
    )
    .await?;

    build_usuario_response(pool, &user).await
}

pub async fn actualizar(
    pool: &PgPool,
    id: Uuid,
    req: UpdateUsuario,
    admin_id: Uuid,
) -> Result<UsuarioResponse, AppError> {
    req.validate()?;

    // Validación manual de rol si se provee
    if let Some(rol) = &req.rol {
        validate_rol(rol)
            .map_err(|e| AppError::Validation(e.message.unwrap_or_default().into()))?;
    }

    let anterior = sqlx::query_as::<_, Usuario>(
        "SELECT id, nombre, email, password_hash, rol, activo, version, created_at, updated_at FROM usuarios WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Usuario no encontrado".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let email = req.email.as_deref().map(|e| e.trim().to_lowercase());
    let email_ref = email.as_deref().unwrap_or(&anterior.email);
    let rol = req.rol.as_deref().unwrap_or(&anterior.rol);

    let mut tx = pool.begin().await?;

    let user = sqlx::query_as::<_, Usuario>(
        "UPDATE usuarios SET nombre = $1, email = $2, rol = $3, version = version + 1, updated_at = NOW() \
         WHERE id = $4 AND version = $5 \
         RETURNING id, nombre, email, password_hash, rol, activo, version, created_at, updated_at",
    )
    .bind(nombre)
    .bind(email_ref)
    .bind(rol)
    .bind(id)
    .bind(req.version)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::VersionConflict {
        esperada: req.version as i64,
        actual: anterior.version as i64,
    })?;

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
                .await?;
        }
    }

    tx.commit().await?;

    crate::services::audit::registrar(
        pool,
        "usuarios",
        &id.to_string(),
        "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "email": &anterior.email, "rol": &anterior.rol})),
        Some(json!({"nombre": &user.nombre, "email": &user.email, "rol": &user.rol})),
        admin_id,
    )
    .await?;

    build_usuario_response(pool, &user).await
}

pub async fn eliminar(pool: &PgPool, id: Uuid, admin_id: Uuid) -> Result<(), AppError> {
    if id == admin_id {
        return Err(AppError::BusinessLogic(
            "No puedes desactivar tu propia cuenta".into(),
            "AUTO_DESACTIVACION".into(),
        ));
    }

    let result = sqlx::query(
        "UPDATE usuarios SET activo = false, updated_at = NOW() WHERE id = $1 AND activo = true",
    )
    .bind(id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Usuario no encontrado".into()));
    }

    crate::services::audit::registrar(
        pool,
        "usuarios",
        &id.to_string(),
        "DELETE",
        None,
        None,
        admin_id,
    )
    .await?;

    Ok(())
}

pub async fn reset_password(
    pool: &PgPool,
    id: Uuid,
    password_nueva: String,
    admin_id: Uuid,
) -> Result<(), AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let new_hash = Argon2::default()
        .hash_password(password_nueva.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Error hasheando password: {}", e)))?
        .to_string();

    let result =
        sqlx::query("UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2")
            .bind(&new_hash)
            .bind(id)
            .execute(pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Usuario no encontrado".into()));
    }

    crate::services::audit::registrar(
        pool,
        "usuarios",
        &id.to_string(),
        "RESET_PASSWORD",
        None,
        None,
        admin_id,
    )
    .await?;

    Ok(())
}

use crate::dto::categoria::{CreateCategoria, UpdateCategoria};
use crate::errors::AppError;
use crate::models::categoria::Categoria;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

pub async fn listar(pool: &PgPool) -> Result<Vec<Categoria>, AppError> {
    sqlx::query_as::<_, Categoria>(
        "SELECT id, nombre, descripcion, created_at, version FROM categorias WHERE activo = true ORDER BY nombre",
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn crear(
    pool: &PgPool,
    req: CreateCategoria,
    usuario_id: Uuid,
) -> Result<Categoria, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();

    let existente: Option<(i32, bool)> =
        sqlx::query_as("SELECT id, activo FROM categorias WHERE nombre = $1 LIMIT 1")
            .bind(&nombre)
            .fetch_optional(pool)
            .await?;

    if let Some((_, true)) = existente {
        return Err(AppError::Conflict(format!(
            "La categoría '{}' ya existe",
            nombre
        )));
    }

    let categoria = if let Some((id, false)) = existente {
        sqlx::query_as::<_, Categoria>(
            "UPDATE categorias SET activo = true, descripcion = $1, version = version + 1 \
             WHERE id = $2 RETURNING id, nombre, descripcion, created_at, version",
        )
        .bind(req.descripcion.as_deref())
        .bind(id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as::<_, Categoria>(
            "INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2) \
             RETURNING id, nombre, descripcion, created_at, version",
        )
        .bind(&nombre)
        .bind(req.descripcion.as_deref())
        .fetch_one(pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::Conflict(format!("La categoría '{}' ya existe", nombre))
            }
            _ => e.into(),
        })?
    };

    crate::services::audit::registrar(
        pool,
        "categorias",
        &categoria.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        usuario_id,
    )
    .await?;

    Ok(categoria)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateCategoria,
    usuario_id: Uuid,
) -> Result<Categoria, AppError> {
    req.validate()?;

    let anterior = sqlx::query_as::<_, Categoria>(
        "SELECT id, nombre, descripcion, created_at, version FROM categorias WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Categoría no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let descripcion = req
        .descripcion
        .as_deref()
        .or(anterior.descripcion.as_deref());

    let categoria = sqlx::query_as::<_, Categoria>(
        "UPDATE categorias SET nombre = $1, descripcion = $2, version = version + 1 \
         WHERE id = $3 AND version = $4 \
         RETURNING id, nombre, descripcion, created_at, version",
    )
    .bind(nombre)
    .bind(descripcion)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::Conflict(
        "La categoría ha sido modificada por otro usuario".into(),
    ))?;

    crate::services::audit::registrar(
        pool,
        "categorias",
        &id.to_string(),
        "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "descripcion": &anterior.descripcion})),
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        usuario_id,
    )
    .await?;

    Ok(categoria)
}

pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE categorias SET activo = false, deleted_at = NOW() WHERE id = $1 AND activo = true",
    )
    .bind(id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Categoría no encontrada o ya inactiva".into(),
        ));
    }

    crate::services::audit::registrar(
        pool,
        "categorias",
        &id.to_string(),
        "DELETE",
        None,
        None,
        usuario_id,
    )
    .await?;

    Ok(())
}

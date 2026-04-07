use sqlx::PgPool;
use serde_json::json;
use uuid::Uuid;
use crate::models::unidad_basica::UnidadBasica;
use crate::dto::unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica};
use crate::errors::AppError;
use validator::Validate;

pub async fn listar(pool: &PgPool) -> Result<Vec<UnidadBasica>, AppError> {
    sqlx::query_as::<_, UnidadBasica>(
        "SELECT id, nombre, nombre_plural, activo, version FROM unidades_basicas WHERE activo = true ORDER BY nombre",
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn crear(
    pool: &PgPool,
    req: CreateUnidadBasica,
    usuario_id: Uuid,
) -> Result<UnidadBasica, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();
    let nombre_plural = req.nombre_plural.trim().to_string();

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        r#"INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2)
           ON CONFLICT (nombre) DO UPDATE SET activo = true, nombre_plural = EXCLUDED.nombre_plural, version = unidades_basicas.version + 1
           RETURNING id, nombre, nombre_plural, activo, version"#,
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(pool)
    .await?;

    crate::services::audit::registrar(
        pool, "unidades_basicas", &unidad.id.to_string(), "CREATE",
        None,
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        usuario_id,
    ).await?;

    Ok(unidad)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateUnidadBasica,
    usuario_id: Uuid,
) -> Result<UnidadBasica, AppError> {
    req.validate()?;

    let anterior = sqlx::query_as::<_, UnidadBasica>("SELECT id, nombre, nombre_plural, version FROM unidades_basicas WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound("Unidad básica no encontrada".into()))?;

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or(&anterior.nombre);
    let nombre_plural = req.nombre_plural.as_deref().map(str::trim).unwrap_or(&anterior.nombre_plural);

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "UPDATE unidades_basicas SET nombre = $1, nombre_plural = $2, version = version + 1 \
         WHERE id = $3 AND version = $4 \
         RETURNING id, nombre, nombre_plural, activo, created_at, version",
    )
    .bind(nombre)
    .bind(nombre_plural)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::Conflict("La unidad ha sido modificada por otro usuario".into()))?;

    crate::services::audit::registrar(
        pool, "unidades_basicas", &id.to_string(), "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "nombre_plural": &anterior.nombre_plural})),
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        usuario_id,
    ).await?;

    Ok(unidad)
}

pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
    let result = sqlx::query("UPDATE unidades_basicas SET activo = false WHERE id = $1 AND activo = true")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Unidad básica no encontrada o ya inactiva".into()));
    }

    crate::services::audit::registrar(pool, "unidades_basicas", &id.to_string(), "DELETE", None, None, usuario_id).await?;

    Ok(())
}

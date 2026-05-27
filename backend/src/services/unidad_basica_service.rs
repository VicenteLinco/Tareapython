use crate::dto::unidad_basica::{CreateUnidadBasica, UpdateUnidadBasica};
use crate::errors::AppError;
use crate::models::unidad_basica::UnidadBasica;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
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

    // ── Verificar si ya existe un registro con ese nombre ────────────────────
    let existente: Option<(i32, bool)> =
        sqlx::query_as("SELECT id, activo FROM unidades_basicas WHERE nombre = $1 LIMIT 1")
            .bind(&nombre)
            .fetch_optional(pool)
            .await?;

    match existente {
        Some((_, true)) => {
            return Err(AppError::Conflict(format!(
                "La unidad básica '{}' ya existe",
                nombre
            )));
        }
        Some((id, false)) => {
            // Reactivar explícitamente
            let unidad = sqlx::query_as::<_, UnidadBasica>(
                "UPDATE unidades_basicas \
                 SET activo = true, nombre_plural = $1, version = version + 1 \
                 WHERE id = $2 \
                 RETURNING id, nombre, nombre_plural, activo, version",
            )
            .bind(&nombre_plural)
            .bind(id)
            .fetch_one(pool)
            .await?;

            crate::services::audit::registrar(
                pool, "unidades_basicas", &unidad.id.to_string(), "REACTIVATE",
                Some(json!({"activo": false})),
                Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural, "activo": true})),
                usuario_id,
            ).await?;

            return Ok(unidad);
        }
        None => {} // continúa con insert normal
    }

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2) \
         RETURNING id, nombre, nombre_plural, activo, version",
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict(format!("La unidad básica '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    crate::services::audit::registrar(
        pool,
        "unidades_basicas",
        &unidad.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        usuario_id,
    )
    .await?;

    Ok(unidad)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateUnidadBasica,
    usuario_id: Uuid,
) -> Result<UnidadBasica, AppError> {
    req.validate()?;

    let anterior = sqlx::query_as::<_, UnidadBasica>(
        "SELECT id, nombre, nombre_plural, version FROM unidades_basicas WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
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

    if nombre != anterior.nombre {
        let existente = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM unidades_basicas WHERE nombre = $1 AND id <> $2 AND activo = true)",
        )
        .bind(nombre)
        .bind(id)
        .fetch_one(pool)
        .await?;

        if existente {
            return Err(AppError::Conflict(format!(
                "La unidad básica '{}' ya existe",
                nombre
            )));
        }
    }

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "UPDATE unidades_basicas SET nombre = $1, nombre_plural = $2, version = version + 1 \
         WHERE id = $3 AND version = $4 \
         RETURNING id, nombre, nombre_plural, version",
    )
    .bind(nombre)
    .bind(nombre_plural)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::Conflict(
        "La unidad ha sido modificada por otro usuario".into(),
    ))?;

    crate::services::audit::registrar(
        pool,
        "unidades_basicas",
        &id.to_string(),
        "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "nombre_plural": &anterior.nombre_plural})),
        Some(json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        usuario_id,
    )
    .await?;

    Ok(unidad)
}

pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM productos WHERE unidad_base_id = $1 AND activo = true",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    if count > 0 {
        return Err(AppError::BusinessLogic(
            format!(
                "No se puede eliminar: {} producto(s) usan esta unidad",
                count
            ),
            "EN_USO".into(),
        ));
    }

    let result =
        sqlx::query("UPDATE unidades_basicas SET activo = false, deleted_at = NOW() WHERE id = $1 AND activo = true")
            .bind(id)
            .execute(pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Unidad básica no encontrada o ya inactiva".into(),
        ));
    }

    crate::services::audit::registrar(
        pool,
        "unidades_basicas",
        &id.to_string(),
        "DELETE",
        None,
        None,
        usuario_id,
    )
    .await?;

    Ok(())
}

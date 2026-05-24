use crate::dto::proveedor::{CreateProveedor, ProveedorQuery, UpdateProveedor};
use crate::errors::AppError;
use crate::models::proveedor::Proveedor;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

pub async fn listar(pool: &PgPool, params: ProveedorQuery) -> Result<Vec<Proveedor>, AppError> {
    let activo = params.activo.unwrap_or(true);

    if let Some(q) = params.q {
        let pattern = format!("%{}%", q);
        sqlx::query_as::<_, Proveedor>(
            "SELECT p.id, p.nombre, p.contacto, p.telefono, p.email, p.icono, p.activa, \
             p.dias_despacho_aereo, p.dias_despacho_tierra, p.version, p.created_at, \
             COUNT(pr.id)::int AS total_productos \
             FROM proveedores p \
             LEFT JOIN productos pr ON pr.proveedor_id = p.id AND pr.activo = true \
             WHERE p.activa = $1 AND p.nombre ILIKE $2 \
             GROUP BY p.id ORDER BY p.nombre",
        )
        .bind(activo)
        .bind(pattern)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    } else {
        sqlx::query_as::<_, Proveedor>(
            "SELECT p.id, p.nombre, p.contacto, p.telefono, p.email, p.icono, p.activa, \
             p.dias_despacho_aereo, p.dias_despacho_tierra, p.version, p.created_at, \
             COUNT(pr.id)::int AS total_productos \
             FROM proveedores p \
             LEFT JOIN productos pr ON pr.proveedor_id = p.id AND pr.activo = true \
             WHERE p.activa = $1 \
             GROUP BY p.id ORDER BY p.nombre",
        )
        .bind(activo)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }
}

pub async fn crear(
    pool: &PgPool,
    req: CreateProveedor,
    usuario_id: Uuid,
) -> Result<Proveedor, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();

    let proveedor = sqlx::query_as::<_, Proveedor>(
        "INSERT INTO proveedores (nombre, contacto, telefono, email, icono, dias_despacho_aereo, dias_despacho_tierra) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, nombre, contacto, telefono, email, icono, activa, dias_despacho_aereo, dias_despacho_tierra, version, created_at, 0::int AS total_productos",
    )
    .bind(&nombre)
    .bind(&req.contacto)
    .bind(&req.telefono)
    .bind(&req.email)
    .bind(&req.icono)
    .bind(req.dias_despacho_aereo)
    .bind(req.dias_despacho_tierra)
    .fetch_one(pool)
    .await?;

    crate::services::audit::registrar(
        pool,
        "proveedores",
        &proveedor.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &proveedor.nombre})),
        usuario_id,
    )
    .await?;

    Ok(proveedor)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateProveedor,
    usuario_id: Uuid,
) -> Result<Proveedor, AppError> {
    req.validate()?;

    let anterior = sqlx::query_as::<_, Proveedor>("SELECT id, nombre, contacto, telefono, email, icono, activa, dias_despacho_aereo, dias_despacho_tierra, version, created_at, 0::int AS total_productos FROM proveedores WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound("Proveedor no encontrado".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);

    let proveedor = sqlx::query_as::<_, Proveedor>(
        r#"UPDATE proveedores
           SET nombre = $1, contacto = $2, telefono = $3, email = $4,
               icono = $5, dias_despacho_aereo = $6, dias_despacho_tierra = $7,
               version = version + 1
           WHERE id = $8 AND version = $9
           RETURNING id, nombre, contacto, telefono, email, icono, activa, dias_despacho_aereo, dias_despacho_tierra, version, created_at, 0::int AS total_productos"#,
    )
    .bind(nombre)
    .bind(req.contacto.as_deref().or(anterior.contacto.as_deref()))
    .bind(req.telefono.as_deref().or(anterior.telefono.as_deref()))
    .bind(req.email.as_deref().or(anterior.email.as_deref()))
    .bind(req.icono.as_deref().or(anterior.icono.as_deref()))
    .bind(req.dias_despacho_aereo)
    .bind(req.dias_despacho_tierra)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::VersionConflict {
        esperada: req.version as i64,
        actual: anterior.version as i64,
    })?;

    crate::services::audit::registrar(
        pool,
        "proveedores",
        &id.to_string(),
        "UPDATE",
        Some(json!({"nombre": &anterior.nombre})),
        Some(json!({"nombre": &proveedor.nombre})),
        usuario_id,
    )
    .await?;

    Ok(proveedor)
}

pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
    let result =
        sqlx::query("UPDATE proveedores SET activa = false, deleted_at = NOW() WHERE id = $1 AND activa = true")
            .bind(id)
            .execute(pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Proveedor no encontrado".into()));
    }

    crate::services::audit::registrar(
        pool,
        "proveedores",
        &id.to_string(),
        "DELETE",
        None,
        None,
        usuario_id,
    )
    .await?;

    Ok(())
}

pub async fn reactivar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<Proveedor, AppError> {
    let proveedor = sqlx::query_as::<_, Proveedor>(
        "UPDATE proveedores SET activa = true WHERE id = $1 \
         RETURNING id, nombre, contacto, telefono, email, icono, activa, dias_despacho_aereo, dias_despacho_tierra, version, created_at, 0::int AS total_productos",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Proveedor no encontrado".into()))?;

    crate::services::audit::registrar(
        pool,
        "proveedores",
        &id.to_string(),
        "REACTIVATE",
        None,
        Some(json!({"activa": true})),
        usuario_id,
    )
    .await?;

    Ok(proveedor)
}

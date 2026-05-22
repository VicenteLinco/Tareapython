use crate::dto::area::{CreateArea, ProductoAreaRow, UpdateArea};
use crate::errors::AppError;
use crate::models::area::Area;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug)]
pub enum EliminarResultado {
    /// El área fue eliminada definitivamente (no tenía stock)
    Eliminada,
    /// El área fue desactivada (tenía stock activo, soft-delete)
    Desactivada,
}

pub async fn listar(pool: &PgPool) -> Result<Vec<Area>, AppError> {
    sqlx::query_as::<_, Area>(
        r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                  (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock
           FROM areas a WHERE a.activa = true ORDER BY a.nombre"#,
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn crear(pool: &PgPool, req: CreateArea, usuario_id: Uuid) -> Result<Area, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();

    let area = sqlx::query_as::<_, Area>(
        "INSERT INTO areas (nombre, es_bodega) VALUES ($1, $2) \
         RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock",
    )
    .bind(&nombre)
    .bind(req.es_bodega.unwrap_or(false))
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("El área '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    crate::services::audit::registrar(
        pool,
        "areas",
        &area.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &area.nombre, "es_bodega": area.es_bodega})),
        usuario_id,
    )
    .await?;

    Ok(area)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateArea,
    usuario_id: Uuid,
) -> Result<Area, AppError> {
    req.validate()?;

    let anterior = sqlx::query_as::<_, Area>(
        r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                  (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock
           FROM areas a WHERE a.id = $1"#
    )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let es_bodega = req.es_bodega.unwrap_or(anterior.es_bodega);
    let frecuencia = req
        .conteo_frecuencia_dias
        .unwrap_or(anterior.conteo_frecuencia_dias);

    let area = sqlx::query_as::<_, Area>(
        "UPDATE areas SET nombre = $1, es_bodega = $2, conteo_frecuencia_dias = $3, version = version + 1 \
         WHERE id = $4 AND version = $5 \
         RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock",
    )
    .bind(nombre)
    .bind(es_bodega)
    .bind(frecuencia)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
            AppError::Conflict(format!("El área '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?
    .ok_or(AppError::Conflict("El área ha sido modificada por otro usuario (error de versión)".into()))?;

    crate::services::audit::registrar(
        pool, "areas", &id.to_string(), "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "es_bodega": anterior.es_bodega, "frecuencia": anterior.conteo_frecuencia_dias})),
        Some(json!({"nombre": &area.nombre, "es_bodega": area.es_bodega, "frecuencia": area.conteo_frecuencia_dias})),
        usuario_id,
    ).await?;

    Ok(area)
}

pub async fn eliminar(
    pool: &PgPool,
    id: i32,
    usuario_id: Uuid,
) -> Result<EliminarResultado, AppError> {
    let stock_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM stock WHERE area_id = $1 AND cantidad > 0")
            .bind(id)
            .fetch_one(pool)
            .await?;

    let resultado = if stock_count.0 > 0 {
        sqlx::query("UPDATE areas SET activa = false, deleted_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        EliminarResultado::Desactivada
    } else {
        let result = sqlx::query("DELETE FROM areas WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Área no encontrada".into()));
        }
        EliminarResultado::Eliminada
    };

    let accion = match resultado {
        EliminarResultado::Eliminada => "DELETE",
        EliminarResultado::Desactivada => "DEACTIVATE",
    };

    crate::services::audit::registrar(
        pool,
        "areas",
        &id.to_string(),
        accion,
        None,
        None,
        usuario_id,
    )
    .await?;

    Ok(resultado)
}

pub async fn listar_productos(
    pool: &PgPool,
    area_id: i32,
) -> Result<Vec<ProductoAreaRow>, AppError> {
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = $1)")
        .bind(area_id)
        .fetch_one(pool)
        .await?;

    if !exists {
        return Err(AppError::NotFound("Área no encontrada".into()));
    }

    sqlx::query_as::<_, ProductoAreaRow>(
        r#"SELECT p.id, p.codigo_interno, p.nombre
           FROM producto_area pa
           JOIN productos p ON p.id = pa.producto_id
           WHERE pa.area_id = $1 AND p.activo = true
           ORDER BY p.nombre"#,
    )
    .bind(area_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn asignar_productos(
    pool: &PgPool,
    area_id: i32,
    producto_ids: Vec<Uuid>,
    usuario_id: Uuid,
) -> Result<usize, AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query("SELECT id FROM areas WHERE id = $1")
        .bind(area_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    sqlx::query("DELETE FROM producto_area WHERE area_id = $1")
        .bind(area_id)
        .execute(&mut *tx)
        .await?;

    for producto_id in &producto_ids {
        sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
            .bind(producto_id)
            .bind(area_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    crate::services::audit::registrar(
        pool,
        "areas",
        &area_id.to_string(),
        "ASSIGN_PRODUCTS",
        None,
        Some(json!({"count": producto_ids.len()})),
        usuario_id,
    )
    .await?;

    Ok(producto_ids.len())
}

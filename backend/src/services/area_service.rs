use crate::dto::area::{CreateArea, ProductoAreaConfigInput, ProductoAreaRow, UpdateArea};
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

async fn buscar_por_id(pool: &PgPool, id: i32) -> Result<Option<Area>, AppError> {
    sqlx::query_as::<_, Area>(
        r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                  (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock,
                  a.es_virtual
           FROM areas a WHERE a.id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

pub async fn listar(pool: &PgPool) -> Result<Vec<Area>, AppError> {
    sqlx::query_as::<_, Area>(
        r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                  (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock,
                  a.es_virtual
           FROM areas a WHERE a.activa = true AND a.es_virtual = false ORDER BY a.nombre"#,
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn crear(pool: &PgPool, req: CreateArea, usuario_id: Uuid) -> Result<Area, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();
    let es_bodega = req.es_bodega.unwrap_or(false);

    let area = sqlx::query_as::<_, Area>(
        "INSERT INTO areas (nombre, es_bodega) VALUES ($1, $2) \
         RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock, es_virtual",
    )
    .bind(&nombre)
    .bind(es_bodega)
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

    let anterior = buscar_por_id(pool, id)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let es_bodega = req.es_bodega.unwrap_or(anterior.es_bodega);

    let area = sqlx::query_as::<_, Area>(
        "UPDATE areas SET nombre = $1, es_bodega = $2, version = version + 1 \
         WHERE id = $3 AND version = $4 \
         RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock, es_virtual",
    )
    .bind(nombre)
    .bind(es_bodega)
    .bind(id)
    .bind(req.version)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::Conflict(
        "El área ha sido modificada por otro usuario".into(),
    ))?;

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
    let tiene_stock: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM stock WHERE area_id = $1 AND cantidad > 0")
            .bind(id)
            .fetch_one(pool)
            .await?;

    let resultado = if tiene_stock.0 > 0 {
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
    if buscar_por_id(pool, area_id).await?.is_none() {
        return Err(AppError::NotFound("Área no encontrada".into()));
    }

    sqlx::query_as::<_, ProductoAreaRow>(
        r#"SELECT p.id, p.codigo_interno, p.nombre,
                  pa.stock_maximo, pa.punto_reorden
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
    productos: Vec<ProductoAreaConfigInput>,
    usuario_id: Uuid,
) -> Result<usize, AppError> {
    if buscar_por_id(pool, area_id).await?.is_none() {
        return Err(AppError::NotFound("Área no encontrada".into()));
    }

    sqlx::query("DELETE FROM producto_area WHERE area_id = $1")
        .bind(area_id)
        .execute(pool)
        .await?;

    for producto in &productos {
        sqlx::query(
            r#"INSERT INTO producto_area
               (producto_id, area_id, stock_maximo, punto_reorden)
               VALUES ($1, $2, $3, $4)"#,
        )
        .bind(producto.producto_id)
        .bind(area_id)
        .bind(producto.stock_maximo)
        .bind(producto.punto_reorden)
        .execute(pool)
        .await?;
    }

    crate::services::audit::registrar(
        pool,
        "areas",
        &area_id.to_string(),
        "ASSIGN_PRODUCTS",
        None,
        Some(json!({"count": productos.len()})),
        usuario_id,
    )
    .await?;

    Ok(productos.len())
}

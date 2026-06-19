use crate::dto::area::{CreateArea, ProductoAreaConfigInput, ProductoAreaRow, UpdateArea};
use crate::errors::AppError;
use crate::models::area::Area;
use crate::domain::AreaRepository;
use crate::persistence::SqlxAreaRepository;
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
    let repo = SqlxAreaRepository::new(pool.clone());
    repo.listar().await
}

pub async fn crear(pool: &PgPool, req: CreateArea, usuario_id: Uuid) -> Result<Area, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();

    let repo = SqlxAreaRepository::new(pool.clone());
    let area = repo.crear(&nombre, req.es_bodega.unwrap_or(false)).await?;

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

    let repo = SqlxAreaRepository::new(pool.clone());
    let anterior = repo
        .buscar_por_id(id)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let es_bodega = req.es_bodega.unwrap_or(anterior.es_bodega);

    let area = repo.actualizar(id, nombre, es_bodega, req.version).await?;

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
    let repo = SqlxAreaRepository::new(pool.clone());
    let tiene_stock = repo.tiene_stock(id).await?;

    let resultado = if tiene_stock {
        repo.soft_delete(id).await?;
        EliminarResultado::Desactivada
    } else {
        repo.hard_delete(id).await?;
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
    let repo = SqlxAreaRepository::new(pool.clone());
    let exists = repo.buscar_por_id(area_id).await?.is_some();

    if !exists {
        return Err(AppError::NotFound("Área no encontrada".into()));
    }

    repo.obtener_config_producto_area(area_id).await
}

pub async fn asignar_productos(
    pool: &PgPool,
    area_id: i32,
    productos: Vec<ProductoAreaConfigInput>,
    usuario_id: Uuid,
) -> Result<usize, AppError> {
    let repo = SqlxAreaRepository::new(pool.clone());
    let exists = repo.buscar_por_id(area_id).await?.is_some();
    if !exists {
        return Err(AppError::NotFound("Área no encontrada".into()));
    }

    repo.eliminar_configuraciones(area_id).await?;

    for producto in &productos {
        repo.configurar_producto_area(area_id, ProductoAreaConfigInput {
            producto_id: producto.producto_id,
            stock_maximo: producto.stock_maximo,
            punto_reorden: producto.punto_reorden,
        }).await?;
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

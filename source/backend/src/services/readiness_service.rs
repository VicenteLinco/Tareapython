use crate::errors::AppError;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProductReadiness {
    pub producto_id: Uuid,
    pub estado_catalogo: String,
    pub inventory_ready: bool,
    pub missing_fields: Vec<String>,
}

#[allow(dead_code)]
pub async fn evaluate(pool: &PgPool, id: Uuid) -> Result<ProductReadiness, AppError> {
    sqlx::query_as("SELECT producto_id, estado_catalogo, inventory_ready, missing_fields FROM product_readiness WHERE producto_id=$1")
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| AppError::NotFound("Producto no encontrado".into()))
}

#[allow(dead_code)]
pub async fn require_inventory(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    if !evaluate(pool, id).await?.inventory_ready {
        return Err(AppError::ProductInQuarantine { producto_id: id });
    }
    Ok(())
}

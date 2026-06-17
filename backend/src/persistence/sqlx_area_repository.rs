use async_trait::async_trait;
use sqlx::PgPool;
use crate::domain::repository::AreaRepository;
use crate::models::area::Area;
use crate::dto::area::{ProductoAreaConfigInput, ProductoAreaRow};
use crate::errors::AppError;

pub struct SqlxAreaRepository {
    pool: PgPool,
}

impl SqlxAreaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn eliminar_configuraciones(&self, area_id: i32) -> Result<(), AppError> {
        sqlx::query("DELETE FROM producto_area WHERE area_id = $1")
            .bind(area_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[async_trait]
impl AreaRepository for SqlxAreaRepository {
    async fn listar(&self) -> Result<Vec<Area>, AppError> {
        sqlx::query_as::<_, Area>(
            r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                      (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock
               FROM areas a WHERE a.activa = true ORDER BY a.nombre"#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn crear(&self, nombre: &str, es_bodega: bool) -> Result<Area, AppError> {
        sqlx::query_as::<_, Area>(
            "INSERT INTO areas (nombre, es_bodega) VALUES ($1, $2) \
             RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock",
        )
        .bind(nombre)
        .bind(es_bodega)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
                AppError::Conflict(format!("El área '{}' ya existe", nombre))
            }
            _ => e.into(),
        })
    }

    async fn buscar_por_id(&self, id: i32) -> Result<Option<Area>, AppError> {
        sqlx::query_as::<_, Area>(
            r#"SELECT a.id, a.nombre, a.es_bodega, a.activa, a.created_at, a.version, a.conteo_frecuencia_dias,
                      (SELECT COUNT(DISTINCT s.id)::integer FROM stock s WHERE s.area_id = a.id AND s.cantidad > 0) AS total_items_stock
               FROM areas a WHERE a.id = $1"#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn actualizar(&self, id: i32, nombre: &str, es_bodega: bool, version: i32) -> Result<Area, AppError> {
        sqlx::query_as::<_, Area>(
            "UPDATE areas SET nombre = $1, es_bodega = $2, version = version + 1 \
             WHERE id = $3 AND version = $4 \
             RETURNING id, nombre, es_bodega, activa, created_at, version, conteo_frecuencia_dias, 0::int AS total_items_stock",
        )
        .bind(nombre)
        .bind(es_bodega)
        .bind(id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::Conflict(
            "El área ha sido modificada por otro usuario".into(),
        ))
    }

    async fn tiene_stock(&self, id: i32) -> Result<bool, AppError> {
        let stock_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM stock WHERE area_id = $1 AND cantidad > 0")
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
        Ok(stock_count.0 > 0)
    }

    async fn hard_delete(&self, id: i32) -> Result<(), AppError> {
        let result = sqlx::query("DELETE FROM areas WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Área no encontrada".into()));
        }
        Ok(())
    }

    async fn soft_delete(&self, id: i32) -> Result<(), AppError> {
        sqlx::query("UPDATE areas SET activa = false, deleted_at = NOW() WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn configurar_producto_area(&self, area_id: i32, config: ProductoAreaConfigInput) -> Result<(), AppError> {
        sqlx::query(
            r#"INSERT INTO producto_area
               (producto_id, area_id, stock_minimo, stock_maximo, punto_reorden)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(config.producto_id)
        .bind(area_id)
        .bind(config.stock_minimo)
        .bind(config.stock_maximo)
        .bind(config.punto_reorden)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn obtener_config_producto_area(&self, id: i32) -> Result<Vec<ProductoAreaRow>, AppError> {
        sqlx::query_as::<_, ProductoAreaRow>(
            r#"SELECT p.id, p.codigo_interno, p.nombre,
                      pa.stock_minimo, pa.stock_maximo, pa.punto_reorden
               FROM producto_area pa
               JOIN productos p ON p.id = pa.producto_id
               WHERE pa.area_id = $1 AND p.activo = true
               ORDER BY p.nombre"#,
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }
}

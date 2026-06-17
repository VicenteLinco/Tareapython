use async_trait::async_trait;
use sqlx::PgPool;
use crate::domain::repository::CategoriaRepository;
use crate::models::categoria::Categoria;
use crate::errors::AppError;

pub struct SqlxCategoriaRepository {
    pool: PgPool,
}

impl SqlxCategoriaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CategoriaRepository for SqlxCategoriaRepository {
    async fn listar(&self) -> Result<Vec<Categoria>, AppError> {
        sqlx::query_as::<_, Categoria>(
            "SELECT id, nombre, descripcion, created_at, version FROM categorias WHERE activo = true ORDER BY nombre",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn buscar_por_id(&self, id: i32) -> Result<Option<Categoria>, AppError> {
        sqlx::query_as::<_, Categoria>(
            "SELECT id, nombre, descripcion, created_at, version FROM categorias WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn buscar_por_nombre(&self, nombre: &str) -> Result<Option<(i32, bool)>, AppError> {
        let existente: Option<(i32, bool)> = sqlx::query_as(
            "SELECT id, activo FROM categorias WHERE nombre = $1 LIMIT 1",
        )
        .bind(nombre)
        .fetch_optional(&self.pool)
        .await?;

        Ok(existente)
    }

    async fn reactivar_y_describir(&self, id: i32, descripcion: Option<&str>) -> Result<Categoria, AppError> {
        sqlx::query_as::<_, Categoria>(
            "UPDATE categorias SET activo = true, descripcion = $1, version = version + 1 \
             WHERE id = $2 RETURNING id, nombre, descripcion, created_at, version",
        )
        .bind(descripcion)
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn insertar(&self, nombre: &str, descripcion: Option<&str>) -> Result<Categoria, AppError> {
        sqlx::query_as::<_, Categoria>(
            "INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2) \
             RETURNING id, nombre, descripcion, created_at, version",
        )
        .bind(nombre)
        .bind(descripcion)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                AppError::Conflict(format!("La categoría '{}' ya existe", nombre))
            }
            _ => e.into(),
        })
    }

    async fn actualizar(&self, id: i32, nombre: &str, descripcion: Option<&str>, version: i32) -> Result<Categoria, AppError> {
        sqlx::query_as::<_, Categoria>(
            "UPDATE categorias SET nombre = $1, descripcion = $2, version = version + 1 \
             WHERE id = $3 AND version = $4 \
             RETURNING id, nombre, descripcion, created_at, version",
        )
        .bind(nombre)
        .bind(descripcion)
        .bind(id)
        .bind(version)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::Conflict(
            "La categoría ha sido modificada por otro usuario".into(),
        ))
    }

    async fn eliminar(&self, id: i32) -> Result<bool, AppError> {
        let result = sqlx::query(
            "UPDATE categorias SET activo = false, deleted_at = NOW() WHERE id = $1 AND activo = true",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}

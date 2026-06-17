use async_trait::async_trait;
use crate::models::categoria::Categoria;
use crate::errors::AppError;
use crate::models::area::Area;
use crate::dto::area::{ProductoAreaConfigInput, ProductoAreaRow};

#[async_trait]
pub trait CategoriaRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<Categoria>, AppError>;
    async fn buscar_por_id(&self, id: i32) -> Result<Option<Categoria>, AppError>;
    async fn buscar_por_nombre(&self, nombre: &str) -> Result<Option<(i32, bool)>, AppError>;
    async fn reactivar_y_describir(&self, id: i32, descripcion: Option<&str>) -> Result<Categoria, AppError>;
    async fn insertar(&self, nombre: &str, descripcion: Option<&str>) -> Result<Categoria, AppError>;
    async fn actualizar(&self, id: i32, nombre: &str, descripcion: Option<&str>, version: i32) -> Result<Categoria, AppError>;
    async fn eliminar(&self, id: i32) -> Result<bool, AppError>;
}

#[async_trait]
pub trait AreaRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<Area>, AppError>;
    async fn crear(&self, nombre: &str, es_bodega: bool) -> Result<Area, AppError>;
    async fn buscar_por_id(&self, id: i32) -> Result<Option<Area>, AppError>;
    async fn actualizar(&self, id: i32, nombre: &str, es_bodega: bool, version: i32) -> Result<Area, AppError>;
    async fn tiene_stock(&self, id: i32) -> Result<bool, AppError>;
    async fn hard_delete(&self, id: i32) -> Result<(), AppError>;
    async fn soft_delete(&self, id: i32) -> Result<(), AppError>;
    async fn configurar_producto_area(&self, area_id: i32, config: ProductoAreaConfigInput) -> Result<(), AppError>;
    async fn obtener_config_producto_area(&self, id: i32) -> Result<Vec<ProductoAreaRow>, AppError>;
}


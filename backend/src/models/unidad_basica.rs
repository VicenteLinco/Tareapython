use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct UnidadBasica {
    pub id: i32,
    pub nombre: String,
    pub nombre_plural: String,
    pub version: i32,
    pub categoria: String,
}

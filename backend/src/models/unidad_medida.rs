use serde::Serialize;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UnidadBasica {
    pub id: i32,
    pub nombre: String,
    pub nombre_plural: String,
}

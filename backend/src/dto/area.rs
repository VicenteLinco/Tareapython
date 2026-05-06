use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct CreateArea {
    #[validate(length(
        min = 1,
        max = 255,
        message = "El nombre debe tener entre 1 y 255 caracteres"
    ))]
    pub nombre: String,
    pub es_bodega: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct UpdateArea {
    #[validate(length(
        min = 1,
        max = 255,
        message = "El nombre debe tener entre 1 y 255 caracteres"
    ))]
    pub nombre: Option<String>,
    pub es_bodega: Option<bool>,
    #[validate(range(
        min = 0,
        max = 365,
        message = "La frecuencia debe estar entre 0 y 365 días"
    ))]
    pub conteo_frecuencia_dias: Option<i32>,
    pub version: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct ProductoAreaRow {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
}

#[derive(Debug, Deserialize, Type)]
pub struct AsignarProductosRequest {
    pub producto_ids: Vec<Uuid>,
}

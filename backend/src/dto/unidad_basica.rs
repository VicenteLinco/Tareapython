use serde::{Deserialize, Serialize};
use validator::Validate;
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct CreateUnidadBasica {
    #[validate(length(min = 1, max = 100, message = "El nombre debe tener entre 1 y 100 caracteres"))]
    pub nombre: String,
    #[validate(length(min = 1, max = 100, message = "El nombre plural debe tener entre 1 y 100 caracteres"))]
    pub nombre_plural: String,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct UpdateUnidadBasica {
    #[validate(length(min = 1, max = 100, message = "El nombre debe tener entre 1 y 100 caracteres"))]
    pub nombre: Option<String>,
    #[validate(length(min = 1, max = 100, message = "El nombre plural debe tener entre 1 y 100 caracteres"))]
    pub nombre_plural: Option<String>,
    pub version: i32,
}

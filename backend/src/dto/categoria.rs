use serde::Deserialize;
use validator::Validate;

#[derive(Debug, Deserialize, Validate)]
pub struct CreateCategoria {
    #[validate(length(min = 1, max = 255, message = "El nombre debe tener entre 1 y 255 caracteres"))]
    pub nombre: String,
    #[validate(length(max = 1000, message = "La descripción no puede exceder 1000 caracteres"))]
    pub descripcion: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateCategoria {
    #[validate(length(min = 1, max = 255, message = "El nombre debe tener entre 1 y 255 caracteres"))]
    pub nombre: Option<String>,
    #[validate(length(max = 1000, message = "La descripción no puede exceder 1000 caracteres"))]
    pub descripcion: Option<String>,
    pub version: i32,
}

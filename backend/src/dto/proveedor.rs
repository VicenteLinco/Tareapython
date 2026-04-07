use serde::{Deserialize, Serialize};
use validator::Validate;
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct CreateProveedor {
    #[validate(length(min = 1, max = 200, message = "El nombre debe tener entre 1 y 200 caracteres"))]
    pub nombre: String,
    #[validate(length(max = 200, message = "El contacto no puede exceder 200 caracteres"))]
    pub contacto: Option<String>,
    #[validate(length(max = 30, message = "El teléfono no puede exceder 30 caracteres"))]
    pub telefono: Option<String>,
    #[validate(email(message = "Formato de email inválido"), length(max = 254, message = "Email demasiado largo"))]
    pub email: Option<String>,
    pub icono: Option<String>,
    #[validate(range(min = 0, message = "Los días de despacho no pueden ser negativos"))]
    pub dias_despacho_aereo: Option<i32>,
    #[validate(range(min = 0, message = "Los días de despacho no pueden ser negativos"))]
    pub dias_despacho_tierra: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct UpdateProveedor {
    #[validate(length(min = 1, max = 200, message = "El nombre debe tener entre 1 y 200 caracteres"))]
    pub nombre: Option<String>,
    #[validate(length(max = 200, message = "El contacto no puede exceder 200 caracteres"))]
    pub contacto: Option<String>,
    #[validate(length(max = 30, message = "El teléfono no puede exceder 30 caracteres"))]
    pub telefono: Option<String>,
    #[validate(email(message = "Formato de email inválido"), length(max = 254, message = "Email demasiado largo"))]
    pub email: Option<String>,
    pub icono: Option<String>,
    #[validate(range(min = 0, message = "Los días de despacho no pueden ser negativos"))]
    pub dias_despacho_aereo: Option<i32>,
    #[validate(range(min = 0, message = "Los días de despacho no pueden ser negativos"))]
    pub dias_despacho_tierra: Option<i32>,
    pub version: i32,
}

#[derive(Debug, Deserialize, Type)]
pub struct ProveedorQuery {
    pub q: Option<String>,
    pub activo: Option<bool>,
}

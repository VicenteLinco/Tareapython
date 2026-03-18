use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateUnidadBasica {
    pub nombre: String,
    pub nombre_plural: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUnidadBasica {
    pub nombre: Option<String>,
    pub nombre_plural: Option<String>,
}

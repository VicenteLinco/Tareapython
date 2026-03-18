use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateCategoria {
    pub nombre: String,
    pub descripcion: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoria {
    pub nombre: Option<String>,
    pub descripcion: Option<String>,
}

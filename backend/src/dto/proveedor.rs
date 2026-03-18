use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateProveedor {
    pub nombre: String,
    pub contacto: Option<String>,
    pub telefono: Option<String>,
    pub email: Option<String>,
    pub icono: Option<String>,
    pub dias_despacho_aereo: Option<i32>,
    pub dias_despacho_tierra: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProveedor {
    pub nombre: Option<String>,
    pub contacto: Option<String>,
    pub telefono: Option<String>,
    pub email: Option<String>,
    pub icono: Option<String>,
    pub dias_despacho_aereo: Option<i32>,
    pub dias_despacho_tierra: Option<i32>,
    pub version: i32,
}

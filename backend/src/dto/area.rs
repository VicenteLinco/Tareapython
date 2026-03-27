use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateArea {
    pub nombre: String,
    pub es_bodega: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateArea {
    pub nombre: Option<String>,
    pub es_bodega: Option<bool>,
    pub conteo_frecuencia_dias: Option<i32>,
}

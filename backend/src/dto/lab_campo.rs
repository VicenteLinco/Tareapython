use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateLabCampoDefinicion {
    pub nombre: String,
    pub tipo_dato: String,
    pub opciones_lista: Option<Vec<String>>,
    pub requerido: Option<bool>,
    pub considerar_filtro: Option<bool>,
    pub orden: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLabCampoDefinicion {
    pub nombre: Option<String>,
    pub tipo_dato: Option<String>,
    pub opciones_lista: Option<Vec<String>>,
    pub requerido: Option<bool>,
    pub considerar_filtro: Option<bool>,
    pub orden: Option<i32>,
    pub activo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertLabCampoValor {
    pub definicion_id: uuid::Uuid,
    pub valor_entero: Option<i32>,
    pub valor_booleano: Option<bool>,
    pub valor_fecha: Option<String>,
    pub valor_texto: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LabCampoDetalle {
    pub id: uuid::Uuid,
    pub nombre: String,
    pub tipo_dato: String,
    pub opciones_lista: Option<serde_json::Value>,
    pub requerido: bool,
    pub considerar_filtro: bool,
    pub orden: i32,
    pub activo: bool,
    pub valor_entero: Option<i32>,
    pub valor_booleano: Option<bool>,
    pub valor_fecha: Option<chrono::NaiveDate>,
    pub valor_texto: Option<String>,
}

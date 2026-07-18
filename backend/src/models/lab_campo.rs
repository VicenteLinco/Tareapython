use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LabCampoDefinicion {
    pub id: uuid::Uuid,
    pub nombre: String,
    pub tipo_dato: String,
    pub opciones_lista: Option<serde_json::Value>,
    pub requerido: bool,
    pub considerar_filtro: bool,
    pub orden: i32,
    pub activo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct LabCampoValor {
    pub id: uuid::Uuid,
    pub definicion_id: uuid::Uuid,
    pub valor_entero: Option<i32>,
    pub valor_booleano: Option<bool>,
    pub valor_fecha: Option<chrono::NaiveDate>,
    pub valor_texto: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

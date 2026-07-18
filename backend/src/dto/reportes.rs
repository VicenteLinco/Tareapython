use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ReporteParams {
    pub desde: Option<String>,
    pub hasta: Option<String>,
    pub limit: Option<i64>,
    pub area_id: Option<i32>,
    pub producto_id: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConsumoAreaRow {
    pub area_id: i32,
    pub area_nombre: String,
    pub mes: String,
    pub total_consumido: f64,
    pub unidades_distintas: i64,
    pub movimientos_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TopDescartadoRow {
    pub producto_id: String,
    pub producto_nombre: String,
    pub total_descartado: f64,
    pub unidad: String,
    pub unidad_plural: String,
    pub movimientos_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConsumoCalendarioRow {
    pub fecha: String,
    pub area_id: i32,
    pub area_nombre: String,
    pub producto_id: String,
    pub producto_nombre: String,
    pub total_consumido: f64,
    pub unidad: String,
    pub unidad_plural: String,
    pub movimientos_count: i64,
    pub ultimo_consumo: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ConsumoProductoRow {
    pub producto_id: String,
    pub producto_nombre: String,
    pub total_consumido: f64,
    pub unidad: String,
    pub unidad_plural: String,
    pub dias_uso: i64,
    pub areas_distintas: i64,
    pub movimientos_count: i64,
    pub ultimo_consumo: String,
}

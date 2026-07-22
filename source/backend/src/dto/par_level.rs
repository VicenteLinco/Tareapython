use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Debug, Serialize, Type)]
pub struct ParLevelResponse {
    pub producto_id: Uuid,
    pub area_id: Option<i32>,
    pub stock_minimo: Decimal,
    pub stock_maximo: Option<Decimal>,
    pub safety_stock: Decimal,
    pub metodo: String,
    pub horizonte_calculo_dias: Option<i32>,
    pub lead_time_dias: Option<i32>,
}

#[derive(Debug, Deserialize, Type)]
pub struct UpsertParLevelRequest {
    pub area_id: Option<i32>,
    pub stock_minimo: Decimal,
    pub stock_maximo: Option<Decimal>,
    pub safety_stock: Option<Decimal>,
    /// 'manual' or 'auto_consumo'
    pub metodo: Option<String>,
    pub horizonte_calculo_dias: Option<i32>,
    pub lead_time_dias: Option<i32>,
}

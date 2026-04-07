use serde::{Deserialize, Serialize};
use rust_decimal::Decimal;
use uuid::Uuid;
use specta::Type;
use validator::Validate;

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct DescarteRequest {
    pub items: Vec<DescarteItem>,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct DescarteItem {
    pub lote_id: Uuid,
    pub area_id: i32,
    pub cantidad: Decimal,
    #[validate(custom(function = "validate_tipo_descarte"))]
    pub tipo: String, // "DESCARTE_VENCIDO" o "DESCARTE_DAÑADO"
    #[validate(length(max = 1000))]
    pub nota: Option<String>,
}

fn validate_tipo_descarte(tipo: &str) -> Result<(), validator::ValidationError> {
    if tipo == "DESCARTE_VENCIDO" || tipo == "DESCARTE_DAÑADO" {
        Ok(())
    } else {
        let mut err = validator::ValidationError::new("tipo_invalido");
        err.message = Some("El tipo debe ser DESCARTE_VENCIDO o DESCARTE_DAÑADO".into());
        Err(err)
    }
}

#[derive(Debug, Serialize, Type)]
pub struct DescarteResponse {
    pub grupo_movimiento: Uuid,
    pub movimientos: Vec<crate::services::stock_ops::MovimientoGenerado>,
}

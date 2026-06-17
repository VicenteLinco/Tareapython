use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Input for adding a presentation to a supplier+product link.
#[derive(Debug, Deserialize, specta::Type)]
pub struct CreateProductoProveedorPresentacion {
    pub presentacion_id: i32,
    pub precio_unidad: Option<Decimal>,
    #[serde(default)]
    pub es_default: bool,
}

/// Row returned when listing presentations for a supplier+product link.
#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct ProductoProveedorPresentacionRow {
    pub id: i32,
    pub presentacion_id: i32,
    pub presentacion_nombre: String,
    pub presentacion_nombre_plural: String,
    pub factor_conversion: Decimal,
    pub es_default: bool,
    pub precio_unidad: Option<Decimal>,
    pub activo: bool,
}

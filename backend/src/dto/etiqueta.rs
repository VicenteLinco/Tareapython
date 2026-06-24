use serde::Serialize;
use uuid::Uuid;
use chrono::NaiveDate;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EtiquetaPresentacion {
    pub presentacion_id: i32,
    pub gtin: Option<String>,
    pub nombre: String,
    pub nombre_plural: String,
    pub sku: Option<String>,
    pub producto_nombre: String,
    pub codigo_barras: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EtiquetaLote {
    pub lote_id: Uuid,
    pub gtin: Option<String>,
    pub numero_lote: String,
    pub fecha_vencimiento: Option<NaiveDate>,
    pub fecha_fabricacion: Option<NaiveDate>,
    pub producto_nombre: String,
    pub presentacion_nombre: Option<String>,
    pub proveedor_nombre: Option<String>,
}

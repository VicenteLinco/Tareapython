use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;
use validator::Validate;

use crate::domain::EstadoRecepcion;

#[derive(Debug, Deserialize, Type)]
pub struct RecepcionQuery {
    pub proveedor_id: Option<i32>,
    pub estado: Option<String>,
    pub desde: Option<NaiveDate>,
    pub hasta: Option<NaiveDate>,
    #[serde(alias = "q")]
    pub busqueda: Option<String>,
    pub area_id: Option<i32>,
    pub page: Option<i32>,
    pub per_page: Option<i32>,
}

#[derive(Debug, Serialize, Type)]
pub struct PaginatedRecepciones {
    pub data: Vec<RecepcionListItem>,
    pub total: i32,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct RecepcionListItem {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_nombre: String,
    pub proveedor_icono: Option<String>,
    pub guia_despacho: Option<String>,
    pub estado: EstadoRecepcion,
    pub fecha_recepcion: DateTime<Utc>,
    pub usuario_nombre: String,
    pub created_at: DateTime<Utc>,
    pub areas_destino: Option<String>,
    pub tiene_foto: bool,
    pub solicitud_id: Option<Uuid>,
    pub items_count: i32,
    pub lotes_count: i32,
}

#[derive(Debug, Deserialize, Type)]
pub struct SubirFotoInput {
    pub data_url: String,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct CreateRecepcion {
    pub proveedor_id: i32,
    #[validate(length(max = 100))]
    pub guia_despacho: Option<String>,
    /// "completa" | "parcial" | "rechazada" — default "completa"
    pub estado: Option<String>,
    pub fecha_recepcion: DateTime<Utc>,
    #[validate(length(max = 1000))]
    pub nota: Option<String>,
    #[validate(length(max = 2000))]
    pub motivo_rechazo: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub detalle: Vec<DetalleRecepcionInput>,
}

/// Información del lote creado durante la recepción, para generar etiquetas QR
#[derive(Debug, Serialize, Type)]
pub struct LoteCreado {
    pub lote_id: Uuid,
    pub codigo_interno: String,
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub presentacion_nombre: Option<String>,
    pub area_nombre: String,
    pub cantidad: rust_decimal::Decimal,
}

#[derive(Debug, Deserialize, Serialize, Validate, Type)]
pub struct DetalleRecepcionInput {
    pub producto_id: Uuid,
    #[validate(length(min = 1, max = 100))]
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Decimal,
    pub area_destino_id: i32,
    pub costo_unitario: Option<Decimal>,
    pub precio_unitario: Option<Decimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct DetalleRecepcionRow {
    pub id: i32,
    pub producto_nombre: String,
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub presentacion_nombre: Option<String>,
    pub cantidad_presentaciones: Decimal,
    pub factor_conversion_usado: Decimal,
    pub cantidad_unidades_base: Decimal,
    pub unidad_base_nombre: String,
    pub unidad_base_nombre_plural: String,
    pub area_destino: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct RecepcionReconciliacionRow {
    pub id: Uuid,
    pub recepcion_id: Uuid,
    pub solicitud_id: Uuid,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub estado: String,
    pub cantidad_solicitada: Decimal,
    pub cantidad_recibida: Decimal,
    pub diferencia: Decimal,
    pub unidad: Option<String>,
    pub nota: Option<String>,
    pub created_at: DateTime<Utc>,
}

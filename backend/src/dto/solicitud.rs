use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use specta::Type;

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct ItemRecomendado {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub lead_time: i32,
    pub autonomia_dias: Option<f64>,
    pub nivel_urgencia: String,
    pub stock_actual: Decimal,
    pub stock_minimo: Decimal,
    pub consumo_diario_30d: Decimal,
    pub cantidad_sugerida_base: Decimal,
    pub presentacion_id: Option<i32>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub cantidad_sugerida_presentacion: Option<Decimal>,
    pub precio_ultima_recepcion: Option<Decimal>,
    pub unidad_base: String,
    pub unidad_base_plural: Option<String>,
    pub solicitudes_pendientes: i32, // Cambiado de i64 a i32 para compatibilidad con Specta TS
    pub imagen_url: Option<String>,
}

#[derive(Debug, Deserialize, Type)]
pub struct UpdateSolicitudRequest {
    pub nota: Option<String>,
    pub items: Vec<CreateSolicitudItem>,
}

#[derive(Debug, Deserialize, Type)]
pub struct CreateSolicitudItem {
    pub producto_id: Uuid,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub precio_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Option<Decimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudResumen {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub items_count: i32, // Cambiado de i64 a i32
    pub nota_revision: Option<String>,
}

#[derive(Debug, Serialize, Type)]
pub struct SolicitudDetalle {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub nota_revision: Option<String>,
    pub fecha_revision: Option<DateTime<Utc>>,
    pub revisado_por_nombre: Option<String>,
    pub items: Vec<SolicitudDetalleItem>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudDetalleItem {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_nombre: Option<String>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub precio_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Option<Decimal>,
    pub imagen_url: Option<String>,
}

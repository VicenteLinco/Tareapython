use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
#[allow(dead_code)]
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
    pub stock_seguridad: Decimal, // == producto.stock_minimo (alerta manual)
    pub consumo_diario: Decimal,  // μ (EWMA winsorizada)
    pub consumo_sigma: Decimal,   // σ diaria
    pub dias_historia: i32,       // longitud de la serie usada
    pub dias_con_consumo: i32,    // días no-cero en la serie
    pub confianza: String,        // "alta" | "media" | "baja"
    pub razon: String,            // explicación humana del cálculo
    pub safety_stock: Decimal,    // Z·σ·√(L+T)
    pub target_stock: Decimal,    // S
    pub reorder_point: Decimal,   // ROP
    pub cantidad_sugerida_base: Decimal,
    pub presentacion_id: Option<i32>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub cantidad_sugerida_presentacion: Option<Decimal>,
    pub precio_ultima_recepcion: Option<Decimal>,
    pub unidad_base: String,
    pub unidad_base_plural: Option<String>,
    pub imagen_url: Option<String>,
    pub ya_pedido_unidades: Decimal,
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
    pub horizonte_dias: Option<i32>,
    pub horizonte_sugerido: Option<i32>,
    pub horizonte_razon: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudResumen {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub items_count: i32, // Cambiado de i64 a i32
    pub fecha_envio: Option<DateTime<Utc>>,
    pub fecha_cierre: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Type)]
pub struct SolicitudDetalle {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub fecha_envio: Option<DateTime<Utc>>,
    pub fecha_cierre: Option<DateTime<Utc>>,
    pub motivo_cierre: Option<String>,
    pub metodo_envio: Option<String>,
    pub items: Vec<SolicitudDetalleItem>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudDetalleItem {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub unidad_plural: Option<String>,
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
    pub horizonte_dias: Option<i32>,
    pub horizonte_sugerido: Option<i32>,
    pub horizonte_razon: Option<String>,
}

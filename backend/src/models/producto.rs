use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{ControlLote, EstadoCatalogo, OrigenRegistro};

#[derive(Debug, Clone, Serialize, sqlx::FromRow, specta::Type)]
pub struct Producto {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub fabricante: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub activo: bool,
    pub control_lote: ControlLote,
    pub estado_catalogo: EstadoCatalogo,
    pub origen_registro: OrigenRegistro,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub imagen_url: Option<String>,
    // Nuevos Atributos: Identidad Clínica y Trazabilidad (Fase 1)
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: bool,
    pub stock_minimo_global: Decimal,
    pub codigo_loinc_cpt: Option<String>,
    pub es_cenabas: bool,
    pub promedio_uso_mensual: Decimal,
    pub promedio_uso_mensual_inicial: Decimal,
}

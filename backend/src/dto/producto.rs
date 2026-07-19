use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::domain::{ControlLote, EstadoCatalogo, OrigenRegistro};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ProductFieldType {
    Text,
    Integer,
    Decimal,
    Boolean,
    Catalog,
    MultiCatalog,
    Enum,
    Barcode,
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ProductFieldSchema {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: ProductFieldType,
    pub section: String,
    pub order: u16,
    pub domain_required: bool,
    pub import_supported: bool,
    pub aliases: Vec<String>,
    pub catalog_endpoint: Option<String>,
    pub allowed_values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ProductImportLimits {
    pub max_file_bytes: usize,
    pub max_rows: usize,
    pub max_columns: usize,
    pub max_cell_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ProductSchemaResponse {
    pub version: String,
    pub limits: ProductImportLimits,
    pub fields: Vec<ProductFieldSchema>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct CreatePresentacionInline {
    pub nombre: String,
    pub nombre_plural: String,
    pub factor_conversion: Decimal,
    pub codigo_barras: Option<String>,
    pub gtin: Option<String>,
    pub gs1_habilitado: Option<bool>,
    pub sku: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct CreateProducto {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: Option<i32>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub fabricante: Option<String>,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: Option<bool>,
    #[serde(alias = "stock_minimo")]
    pub stock_minimo_global: Option<Decimal>,
    pub codigo_loinc_cpt: Option<String>,
    pub control_lote: Option<ControlLote>,
    pub presentaciones: Option<Vec<CreatePresentacionInline>>,
    pub area_ids: Option<Vec<i32>>,
    pub estado_catalogo: Option<EstadoCatalogo>,
    pub origen_registro: Option<OrigenRegistro>,
    pub promedio_uso_mensual_inicial: Option<Decimal>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct UpdateProducto {
    pub nombre: Option<String>,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub fabricante: Option<String>,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: Option<bool>,
    #[serde(alias = "stock_minimo")]
    pub stock_minimo_global: Option<Decimal>,
    pub codigo_loinc_cpt: Option<String>,
    pub control_lote: Option<ControlLote>,
    pub area_ids: Option<Vec<i32>>,
    pub version: i32,
    pub promedio_uso_mensual_inicial: Option<Decimal>,
}

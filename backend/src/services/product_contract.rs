use std::collections::HashSet;

use crate::dto::producto::{
    ProductFieldSchema, ProductFieldType, ProductImportLimits, ProductSchemaResponse,
};

pub const PRODUCT_SCHEMA_VERSION: &str = "1";

const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
const MAX_ROWS: usize = 5_000;
const MAX_COLUMNS: usize = 64;
const MAX_CELL_BYTES: usize = 4 * 1024;

pub fn normalize_header(value: &str) -> String {
    value.trim().to_lowercase().replace(['_', '-'], " ")
}

pub fn importable_fields() -> Vec<&'static ProductFieldDefinition> {
    PRODUCT_FIELD_REGISTRY
        .iter()
        .filter(|field| field.import_supported)
        .collect()
}

#[derive(Debug, Clone, Copy)]
pub struct ProductFieldDefinition {
    pub key: &'static str,
    pub label: &'static str,
    pub field_type: ProductFieldType,
    pub section: &'static str,
    pub order: u16,
    pub domain_required: bool,
    pub import_supported: bool,
    pub aliases: &'static [&'static str],
    pub catalog_endpoint: Option<&'static str>,
    pub allowed_values: &'static [&'static str],
}

macro_rules! field {
    ($key:literal, $label:literal, $type:ident, $section:literal, $order:literal,
     $required:literal, $importable:literal, [$($alias:literal),* $(,)?]) => {
        ProductFieldDefinition {
            key: $key,
            label: $label,
            field_type: ProductFieldType::$type,
            section: $section,
            order: $order,
            domain_required: $required,
            import_supported: $importable,
            aliases: &[$($alias),*],
            catalog_endpoint: None,
            allowed_values: &[],
        }
    };
}

pub static PRODUCT_FIELD_REGISTRY: &[ProductFieldDefinition] = &[
    field!(
        "nombre",
        "Nombre",
        Text,
        "identity",
        10,
        true,
        true,
        ["producto", "nombre producto", "nombre completo"]
    ),
    field!(
        "descripcion",
        "Descripción",
        Text,
        "identity",
        20,
        false,
        true,
        ["descripcion", "detalle"]
    ),
    ProductFieldDefinition {
        catalog_endpoint: Some("/categorias"),
        ..field!(
            "categoria_id",
            "Categoría",
            Catalog,
            "classification",
            30,
            false,
            true,
            ["categoria", "tipo producto"]
        )
    },
    ProductFieldDefinition {
        catalog_endpoint: Some("/unidades-basicas"),
        ..field!(
            "unidad_base_id",
            "Unidad base",
            Catalog,
            "classification",
            40,
            false,
            true,
            ["unidad", "unidad base", "unidad medida"]
        )
    },
    ProductFieldDefinition {
        catalog_endpoint: Some("/areas"),
        ..field!(
            "area_ids",
            "Áreas",
            MultiCatalog,
            "classification",
            50,
            false,
            true,
            ["area", "areas", "seccion"]
        )
    },
    field!(
        "ubicacion",
        "Ubicación",
        Text,
        "identity",
        60,
        false,
        true,
        ["ubicacion", "ubicación"]
    ),
    field!(
        "fabricante",
        "Fabricante",
        Text,
        "identity",
        70,
        false,
        true,
        ["fabricante", "marca"]
    ),
    field!(
        "mpn",
        "MPN",
        Text,
        "identity",
        80,
        false,
        true,
        ["mpn", "referencia fabricante"]
    ),
    field!(
        "alias_unidad_clinica",
        "Alias de unidad clínica",
        Text,
        "clinical",
        90,
        false,
        true,
        ["alias unidad clinica", "alias clínico"]
    ),
    field!(
        "codigo_loinc_cpt",
        "Código LOINC/CPT",
        Text,
        "clinical",
        100,
        false,
        true,
        ["loinc", "cpt", "codigo loinc cpt"]
    ),
    ProductFieldDefinition {
        allowed_values: &["trazable", "con_vto", "simple"],
        ..field!(
            "control_lote",
            "Control de lote",
            Enum,
            "traceability",
            110,
            false,
            true,
            ["control lote", "trazabilidad"]
        )
    },
    field!(
        "requiere_cadena_frio",
        "Requiere cadena de frío",
        Boolean,
        "storage",
        120,
        false,
        true,
        ["cadena frio", "cadena de frio", "refrigerado"]
    ),
    field!(
        "temperatura_almacenamiento",
        "Temperatura de almacenamiento",
        Text,
        "storage",
        130,
        false,
        true,
        ["temperatura", "temperatura almacenamiento"]
    ),
    field!(
        "dias_estabilidad_abierto",
        "Días de estabilidad abierto",
        Integer,
        "storage",
        140,
        false,
        true,
        ["dias estabilidad", "estabilidad abierto"]
    ),
    field!(
        "clase_riesgo",
        "Clase de riesgo",
        Text,
        "clinical",
        150,
        false,
        true,
        ["clase riesgo", "riesgo"]
    ),
    field!(
        "es_kit",
        "Es kit",
        Boolean,
        "classification",
        160,
        false,
        true,
        ["kit", "es kit"]
    ),
    field!(
        "stock_minimo_global",
        "Stock mínimo global",
        Decimal,
        "planning",
        180,
        false,
        true,
        ["stock minimo", "minimo global"]
    ),
    field!(
        "promedio_uso_mensual_inicial",
        "Uso mensual inicial",
        Decimal,
        "planning",
        190,
        false,
        true,
        ["uso mensual", "consumo mensual"]
    ),
    field!(
        "codigo_barras",
        "Código de barras",
        Barcode,
        "traceability",
        200,
        false,
        true,
        ["codigo barras", "ean", "gtin", "barcode"]
    ),
    field!(
        "imagen",
        "Imagen",
        Image,
        "media",
        210,
        false,
        false,
        ["imagen", "foto"]
    ),
];

pub fn product_schema() -> ProductSchemaResponse {
    debug_assert!(registry_is_valid());

    let mut fields: Vec<ProductFieldSchema> = PRODUCT_FIELD_REGISTRY
        .iter()
        .map(|field| ProductFieldSchema {
            key: field.key.to_owned(),
            label: field.label.to_owned(),
            field_type: field.field_type,
            section: field.section.to_owned(),
            order: field.order,
            domain_required: field.domain_required,
            import_supported: field.import_supported,
            aliases: field
                .aliases
                .iter()
                .map(|alias| (*alias).to_owned())
                .collect(),
            catalog_endpoint: field.catalog_endpoint.map(str::to_owned),
            allowed_values: field
                .allowed_values
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
        })
        .collect();
    fields.sort_by_key(|field| field.order);

    ProductSchemaResponse {
        version: PRODUCT_SCHEMA_VERSION.to_owned(),
        limits: ProductImportLimits {
            max_file_bytes: MAX_FILE_BYTES,
            max_rows: MAX_ROWS,
            max_columns: MAX_COLUMNS,
            max_cell_bytes: MAX_CELL_BYTES,
        },
        fields,
    }
}

fn registry_is_valid() -> bool {
    let mut keys = HashSet::new();
    let mut orders = HashSet::new();

    PRODUCT_FIELD_REGISTRY.iter().all(|field| {
        keys.insert(field.key)
            && orders.insert(field.order)
            && (!field.domain_required || field.import_supported)
            && !field.key.starts_with("lab_")
    })
}

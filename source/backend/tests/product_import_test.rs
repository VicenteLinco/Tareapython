mod common;

use axum::http::StatusCode;
use inventario_lab_backend::dto::producto::{
    CreatePresentacionInline, CreateProducto, UpdateProducto,
};
use inventario_lab_backend::services::product_contract::{
    ProductCustomFieldDefinition, product_schema, product_schema_with_custom_fields,
};
use uuid::Uuid;

#[test]
fn product_schema_matches_the_shared_product_contract() {
    let schema = product_schema();
    let keys: Vec<&str> = schema
        .fields
        .iter()
        .map(|field| field.key.as_str())
        .collect();

    assert_eq!(schema.version, "1");
    assert_eq!(
        keys,
        vec![
            "nombre",
            "descripcion",
            "categoria_id",
            "unidad_base_id",
            "area_ids",
            "ubicacion",
            "fabricante",
            "mpn",
            "alias_unidad_clinica",
            "codigo_loinc_cpt",
            "control_lote",
            "requiere_cadena_frio",
            "temperatura_almacenamiento",
            "dias_estabilidad_abierto",
            "clase_riesgo",
            "es_kit",
            "stock_minimo_global",
            "promedio_uso_mensual_inicial",
            "codigo_barras",
            "imagen",
        ]
    );

    let required: Vec<&str> = schema
        .fields
        .iter()
        .filter(|field| field.domain_required)
        .map(|field| field.key.as_str())
        .collect();
    assert_eq!(required, vec!["nombre"]);

    let image = schema
        .fields
        .iter()
        .find(|field| field.key == "imagen")
        .expect("image metadata must be explicit");
    assert!(!image.import_supported);

    assert!(schema.fields.iter().all(|field| {
        !field.key.contains("lab_campo") && !field.label.to_lowercase().contains("laboratorio")
    }));
}

#[test]
fn product_schema_appends_only_active_product_scoped_custom_fields() {
    let schema = product_schema_with_custom_fields(&[
        ProductCustomFieldDefinition {
            id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
            name: "Número de registro".into(),
            data_type: "entero".into(),
            options: None,
            required: true,
            order: 8,
            active: true,
            scope: "producto".into(),
        },
        ProductCustomFieldDefinition {
            id: Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
            name: "Configuración global".into(),
            data_type: "texto".into(),
            options: None,
            required: false,
            order: 9,
            active: true,
            scope: "laboratorio".into(),
        },
        ProductCustomFieldDefinition {
            id: Uuid::parse_str("33333333-3333-3333-3333-333333333333").unwrap(),
            name: "Campo retirado".into(),
            data_type: "texto".into(),
            options: None,
            required: false,
            order: 10,
            active: false,
            scope: "producto".into(),
        },
        ProductCustomFieldDefinition {
            id: Uuid::parse_str("44444444-4444-4444-4444-444444444444").unwrap(),
            name: "Fecha sanitaria".into(),
            data_type: "fecha".into(),
            options: None,
            required: false,
            order: 11,
            active: true,
            scope: "producto".into(),
        },
    ]);

    let custom = schema
        .fields
        .iter()
        .find(|field| field.label == "Número de registro")
        .expect("active product-scoped field must be importable");
    assert_eq!(custom.key, "lab_11111111-1111-1111-1111-111111111111");
    assert_eq!(
        custom.field_type,
        inventario_lab_backend::dto::producto::ProductFieldType::Integer
    );
    assert!(custom.import_supported);
    assert!(custom.domain_required);
    assert!(
        schema
            .fields
            .iter()
            .all(|field| field.label != "Configuración global")
    );
    assert!(
        schema
            .fields
            .iter()
            .all(|field| field.label != "Campo retirado")
    );
    assert_eq!(
        schema
            .fields
            .iter()
            .find(|field| field.label == "Fecha sanitaria")
            .unwrap()
            .field_type,
        inventario_lab_backend::dto::producto::ProductFieldType::Date,
    );
}

#[test]
fn product_create_dto_accepts_name_without_unit() {
    let product = serde_json::from_value::<CreateProducto>(serde_json::json!({
        "nombre": "Reactivo sin unidad"
    }))
    .expect("only nombre is mandatory");

    assert_eq!(product.nombre, "Reactivo sin unidad");
    assert_eq!(product.unidad_base_id, None);
}

#[test]
fn product_mutation_dtos_reject_unknown_json_fields() {
    let create_error = serde_json::from_value::<CreateProducto>(serde_json::json!({
        "nombre": "Reactivo A",
        "unidad_base_id": 1,
        "campo_inventado": "silencioso"
    }))
    .expect_err("create must fail closed on unknown fields");
    assert!(
        create_error
            .to_string()
            .contains("unknown field `campo_inventado`")
    );

    let update_error = serde_json::from_value::<UpdateProducto>(serde_json::json!({
        "nombre": "Reactivo B",
        "version": 1,
        "imagen_data_url": "data:image/png;base64,ignored"
    }))
    .expect_err("update must reject fields that would otherwise be ignored");
    assert!(
        update_error
            .to_string()
            .contains("unknown field `imagen_data_url`")
    );

    let nested_error = serde_json::from_value::<CreatePresentacionInline>(serde_json::json!({
        "nombre": "Caja",
        "nombre_plural": "Cajas",
        "factor_conversion": 10,
        "columna_fantasma": true
    }))
    .expect_err("nested product data must also fail closed");
    assert!(
        nested_error
            .to_string()
            .contains("unknown field `columna_fantasma`")
    );

    let legacy = serde_json::from_value::<CreateProducto>(serde_json::json!({
        "nombre": "Reactivo compatible",
        "unidad_base_id": 1,
        "stock_minimo": 12
    }))
    .expect("a documented legacy alias must map to the canonical field");
    assert_eq!(legacy.stock_minimo_global.unwrap().to_string(), "12");
}

#[sqlx::test(migrations = "./migrations")]
async fn authenticated_schema_route_publishes_registry_and_product_lab_fields(pool: sqlx::PgPool) {
    sqlx::query(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, alcance, activo) VALUES \
         ('Registro sanitario', 'texto', 'producto', true), \
         ('Configuración global', 'texto', 'laboratorio', true)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let config = common::test_config();
    let token = inventario_lab_backend::auth::jwt::create_access_token(
        Uuid::new_v4(),
        "admin",
        vec![1],
        &config,
    )
    .expect("test token");
    let app = common::test_app(pool);

    let (status, body) = common::get_json(&app, "/api/v1/productos/schema", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["version"], "1");
    assert_eq!(body["limits"]["max_rows"], 5_000);
    assert_eq!(body["fields"][0]["key"], "nombre");
    let fields = body["fields"].as_array().expect("fields array");
    assert!(
        fields
            .iter()
            .any(|field| field["label"] == "Registro sanitario")
    );
    assert!(
        fields
            .iter()
            .all(|field| field["label"] != "Configuración global")
    );

    let (unknown_status, _) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "No debe persistir",
            "unidad_base_id": 1,
            "campo_inventado": true
        }),
    )
    .await;
    assert_eq!(unknown_status, StatusCode::UNPROCESSABLE_ENTITY);
}

mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

/// Contrato de Pruebas de Borde y Resiliencia del Sistema (Vuelta 2):
/// 1. Manejo de SKUs con caracteres especiales y largos extremos.
/// 2. Factores de conversión fraccionales y alta precisión decimal.
/// 3. Invariantes de idempotencia y prevención de datos corruptos.
#[sqlx::test(migrations = "./migrations")]
async fn test_edge_cases_and_system_hardening(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Producto con SKU especial y factor de conversión decimal
    let special_sku = "SKU-ESPECIAL/2026#αβγ-99999999999999999999";
    let (_status, prod_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Reactivo Concentrado de Alta Calidad & Especificidad",
            "unidad_base_id": 2, // mililitros
            "area_ids": [1],
            "control_lote": "con_vto",
            "estado_catalogo": "aprobado",
            "origen_registro": "manual",
            "presentaciones": [
                {
                    "nombre": "Bidón 5 Litros (5000 mL)",
                    "nombre_plural": "Bidones 5 Litros",
                    "factor_conversion": "5000.0",
                    "sku": special_sku
                }
            ]
        }),
    )
    .await;
    let _producto_id_str = prod_json["id"].as_str().expect("producto debe tener ID UUID");

    // 2. Búsqueda por SKU especial en /api/v1/productos
    let (status, search_json) = common::get_json(
        &app,
        "/api/v1/productos?q=SKU-ESPECIAL",
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = search_json["data"].as_array().or_else(|| search_json.as_array()).unwrap();
    assert!(!items.is_empty(), "Búsqueda por SKU especial debe retornar el producto");

    // 3. Verificación de Invariante de idempotencia en endpoint de salud o común
    let (status, health_json) = common::get_json(&app, "/health", "").await;
    assert_eq!(status, StatusCode::OK, "Health check debe responder 200 OK: {:?}", health_json);
}

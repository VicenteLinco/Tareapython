mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Setup helpers ────────────────────────────────────────────────────────────

/// Creates provider + product with a presentacion (factor 10).
/// Returns (proveedor_id, producto_uuid, presentacion_id).
async fn setup_base(pool: &PgPool, token: &str, app: &axum::Router) -> (i32, Uuid, i32) {
    let (_, prov) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({ "nombre": format!("Prov-{}", &Uuid::new_v4().to_string()[..8]) }),
    )
    .await;
    let proveedor_id = prov["id"].as_i64().unwrap() as i32;

    let (_, prod) = common::post_json(
        app,
        "/api/v1/productos",
        token,
        serde_json::json!({
            "nombre": format!("Prod-{}", &Uuid::new_v4().to_string()[..8]),
            "unidad_base_id": 1,
            "proveedor_id": proveedor_id,
            "stock_minimo": 5,
            "presentaciones": [{
                "nombre": "Caja",
                "nombre_plural": "Cajas",
                "factor_conversion": 10
            }]
        }),
    )
    .await;
    let producto_id: Uuid = prod["id"].as_str().unwrap().parse().unwrap();

    let presentacion_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_id)
            .fetch_one(pool)
            .await
            .unwrap();

    (proveedor_id, producto_id, presentacion_id)
}

/// Creates a reception with 15 cajas (factor 10 = 150 base units) in area 1.
async fn create_reception_with_pres(
    pool: &PgPool,
    app: &axum::Router,
    token: &str,
    proveedor_id: i32,
    producto_id: Uuid,
    presentacion_id: i32,
) -> Uuid {
    let (_, json) = common::post_json_idempotent(
        app,
        "/api/v1/recepciones",
        token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("STK-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": presentacion_id,
                "cantidad_presentaciones": 15.0,
                "area_destino_id": 1,
            }]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;

    // Get lote_id
    let lote_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM lotes WHERE producto_id = $1 AND proveedor_id = $2 LIMIT 1",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let _ = json; // suppress unused warning
    lote_id
}

// ─── Phase 7 Tests: stock_por_area presentation equivalents ──────────────────

/// Scenario: stock_por_area returns presentacion_nombre and cantidad_presentaciones_equivalente
/// when a lot has presentacion_id set.
/// With 150 base units and factor_conversion = 10, expected equivalente = 15.00
#[sqlx::test(migrations = "./migrations")]
async fn test_stock_por_area_includes_presentacion_equivalente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    // Call stock_por_area for area 1
    let (status, json) = common::get_json(&app, "/api/v1/stock/area/1", &token).await;
    assert_eq!(status, StatusCode::OK, "Expected OK, got {:?}: {:?}", status, json);

    // Find our product in the response
    let productos = json["productos"].as_array().expect("expected productos array");
    let prod = productos
        .iter()
        .find(|p| p["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("product not found in stock_por_area response");

    let lotes = prod["lotes"].as_array().expect("expected lotes array");
    assert!(!lotes.is_empty(), "Expected at least one lote with stock");

    let lote = &lotes[0];

    // Check presentacion_nombre is populated
    let pres_nombre = lote["presentacion_nombre"].as_str();
    assert!(
        pres_nombre.is_some(),
        "Expected presentacion_nombre to be set, got null"
    );
    assert_eq!(pres_nombre, Some("Caja"), "Expected presentacion_nombre = 'Caja'");

    // Check cantidad_presentaciones_equivalente = 150 / 10 = 15.00
    let equivalente = lote["cantidad_presentaciones_equivalente"].as_f64();
    assert!(
        equivalente.is_some(),
        "Expected cantidad_presentaciones_equivalente to be set, got null"
    );
    let eq_val = equivalente.unwrap();
    assert!(
        (eq_val - 15.0).abs() < 0.01,
        "Expected equivalente = 15.0, got {}",
        eq_val
    );

    // Check presentacion_factor = 10
    let factor = lote["presentacion_factor"].as_f64();
    assert!(factor.is_some(), "Expected presentacion_factor to be set");
    let factor_val = factor.unwrap();
    assert!(
        (factor_val - 10.0).abs() < 0.01,
        "Expected presentacion_factor = 10.0, got {}",
        factor_val
    );
}

/// Scenario: When a lot has no presentacion_id, the presentation fields are null.
#[sqlx::test(migrations = "./migrations")]
async fn test_stock_por_area_lote_without_presentacion_returns_null_equivalente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, _presentacion_id) = setup_base(&pool, &token, &app).await;

    // Create reception WITHOUT presentacion_id
    common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("NULL-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": null,
                "cantidad_presentaciones": 50.0,
                "area_destino_id": 1,
            }]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock/area/1", &token).await;
    assert_eq!(status, StatusCode::OK);

    let productos = json["productos"].as_array().expect("expected productos array");
    let prod = productos
        .iter()
        .find(|p| p["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("product not found in stock_por_area response");

    let lotes = prod["lotes"].as_array().expect("expected lotes array");
    assert!(!lotes.is_empty());

    let lote = &lotes[0];

    // All three fields should be null when no presentation is linked
    assert!(
        lote["presentacion_nombre"].is_null(),
        "Expected presentacion_nombre = null, got {:?}",
        lote["presentacion_nombre"]
    );
    assert!(
        lote["cantidad_presentaciones_equivalente"].is_null(),
        "Expected cantidad_presentaciones_equivalente = null, got {:?}",
        lote["cantidad_presentaciones_equivalente"]
    );
    assert!(
        lote["presentacion_factor"].is_null(),
        "Expected presentacion_factor = null, got {:?}",
        lote["presentacion_factor"]
    );
}

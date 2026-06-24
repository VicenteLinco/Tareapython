mod common;

use std::time::Duration;
use axum::{Router, routing::get, extract::{Query, Path}};
use std::collections::HashMap;
use tokio::time::sleep;
use sqlx::PgPool;
use uuid::Uuid;
use rust_decimal_macros::dec;

use inventario_lab_backend::services::api_regulatoria_service;
use inventario_lab_backend::services::consumo_service::{ConsumoService, ConsumoParams};
use inventario_lab_backend::services::stock_service;
use inventario_lab_backend::errors::AppError;

async fn mock_fda(Query(params): Query<HashMap<String, String>>) -> impl axum::response::IntoResponse {
    let di = params.get("di").cloned().unwrap_or_default();
    if di == "timeout" {
        sleep(Duration::from_millis(4000)).await;
    }
    if di == "fda_success" || di == "timeout" {
        return axum::response::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(r#"{
                "gudid": {
                    "device": {
                        "brandName": "FDA Brand Name",
                        "companyName": "FDA Manufacturer",
                        "versionModelNumber": "FDA-REF-123",
                        "deviceDescription": "FDA Device Description"
                    }
                }
            }"#))
            .unwrap();
    }
    axum::response::Response::builder().status(404).body(axum::body::Body::empty()).unwrap()
}

async fn mock_eudamed(Path(code): Path<String>) -> impl axum::response::IntoResponse {
    if code == "eudamed_success" || code == "timeout" {
        return axum::response::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(r#"{
                "name": "Eudamed Device Name",
                "manufacturer": "Eudamed Manufacturer",
                "sku_ref": "Eudamed-REF-456",
                "clase_riesgo": "Class IIa"
            }"#))
            .unwrap();
    }
    axum::response::Response::builder().status(404).body(axum::body::Body::empty()).unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn test_api_regulatoria_cascada_y_timeout(pool: PgPool) {
    common::seed_base_data(&pool).await;
    // Start background mock server
    let app = Router::new()
        .route("/fda", get(mock_fda))
        .route("/eudamed/{code}", get(mock_eudamed));
    
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Configure env vars
    unsafe {
        std::env::set_var("FDA_API_URL", format!("http://{}/fda?di={{code}}", addr));
        std::env::set_var("EUDAMED_API_URL", format!("http://{}/eudamed/{{code}}", addr));
    }

    // Test case 1: FDA Success
    let res = api_regulatoria_service::lookup_dispositivo(&pool, "fda_success").await.unwrap();
    assert_eq!(res.nombre, "FDA Brand Name - FDA Device Description");
    assert_eq!(res.fabricante, "FDA Manufacturer");
    assert_eq!(res.sku_ref.unwrap(), "FDA-REF-123");

    // Test case 2: FDA Timeout, EUDAMED Success
    // FDA will sleep for 4 seconds, reqwest timeout is 3 seconds, so it will abort and hit EUDAMED
    let start = std::time::Instant::now();
    let res2 = api_regulatoria_service::lookup_dispositivo(&pool, "timeout").await.unwrap();
    let elapsed = start.elapsed();
    assert!(elapsed >= Duration::from_secs(3), "Should take at least 3 seconds (FDA timeout)");
    assert!(elapsed < Duration::from_secs(4), "Should take less than 4 seconds");
    assert_eq!(res2.nombre, "Eudamed Device Name");
    assert_eq!(res2.fabricante, "Eudamed Manufacturer");

    // Test case 3: Local Historical Fallback
    // Insert a product with pres_gtin = "local_gtin"
    let prod_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, pres_gtin, sku, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-LOCAL-HIST', 'Local Product', 1, 'local_gtin', 'SKU-LOCAL', 'aprobado', 'manual', 'con_vto')"
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    let res3 = api_regulatoria_service::lookup_dispositivo(&pool, "local_gtin").await.unwrap();
    assert_eq!(res3.nombre, "Local Product");
    assert_eq!(res3.fabricante, "Histórico Local");
    assert_eq!(res3.sku_ref.unwrap(), "SKU-LOCAL");
}

#[sqlx::test(migrations = "./migrations")]
async fn test_cuarentena_excluye_stock_usable(pool: PgPool) {
    common::seed_base_data(&pool).await;

    // Create a quarantined product
    let prod_pendiente_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-PEND', 'Producto Pendiente', 1, 'pendiente_aprobacion', 'api_regulatoria', 'con_vto')"
    )
    .bind(prod_pendiente_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create an approved product
    let prod_aprobado_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-APROB', 'Producto Aprobado', 1, 'aprobado', 'manual', 'con_vto')"
    )
    .bind(prod_aprobado_id)
    .execute(&pool)
    .await
    .unwrap();

    // Add stock to both products
    // We need to create a lot first
    let lote_pend_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) VALUES ($1, $2, 'LOTE-PEND', NULL)"
    )
    .bind(lote_pend_id)
    .bind(prod_pendiente_id)
    .execute(&pool)
    .await
    .unwrap();

    let lote_aprob_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) VALUES ($1, $2, 'LOTE-APROB', NULL)"
    )
    .bind(lote_aprob_id)
    .bind(prod_aprobado_id)
    .execute(&pool)
    .await
    .unwrap();

    // Add stock records in area 1 (Microbiología, from seed)
    sqlx::query(
        "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0), ($2, 1, 15.0)"
    )
    .bind(lote_pend_id)
    .bind(lote_aprob_id)
    .execute(&pool)
    .await
    .unwrap();

    // Query stock stats via stock_service
    let params = stock_service::ListarParams {
        area_id: Some(1),
        area_ids: vec![1],
        q: None,
        categoria_id: None,
        proveedor_id: None,
        stock_bajo: None,
        con_alertas: None,
        filter: None,
        estado: None,
        limit: 10,
        offset: 0,
    };
    
    // Test the filtered stock listing
    let list = stock_service::listar(&pool, params).await.unwrap();
    
    // Quarantined product must NOT be in the list (since we filtered it out from the main select!)
    let pend_in_list = list.rows.iter().any(|item| item.codigo_interno == "TEST-PEND");
    assert!(!pend_in_list, "Quarantined product must be hidden from clinical stock list");

    // Approved product must be in the list
    let aprob_in_list = list.rows.iter().any(|item| item.codigo_interno == "TEST-APROB");
    assert!(aprob_in_list, "Approved product must be visible in clinical stock list");
}

#[sqlx::test(migrations = "./migrations")]
async fn test_bloqueo_consumo_cuarentena(pool: PgPool) {
    let admin_id = common::ensure_test_admin(&pool).await;

    // Create a quarantined product
    let prod_pendiente_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-PEND-CONS', 'Producto Pendiente Consumo', 1, 'pendiente_aprobacion', 'api_regulatoria', 'con_vto')"
    )
    .bind(prod_pendiente_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create a lote
    let lote_pend_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) VALUES ($1, $2, 'LOTE-PEND-CONS', NULL)"
    )
    .bind(lote_pend_id)
    .bind(prod_pendiente_id)
    .execute(&pool)
    .await
    .unwrap();

    // Add stock in area 1 (Microbiología, from seed)
    sqlx::query(
        "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0)"
    )
    .bind(lote_pend_id)
    .execute(&pool)
    .await
    .unwrap();

    // Attempt to register consumption
    let consume_params = ConsumoParams {
        producto_id: prod_pendiente_id,
        area_id: 1,
        cantidad: dec!(2.0),
        unidad: "unidad".to_string(),
        lote_id: Some(lote_pend_id),
        presentacion_id: None,
        nota: None,
    };

    let res = ConsumoService::registrar_consumo(&pool, consume_params, admin_id).await;
    
    // Assert it fails with ProductInQuarantine error
    assert!(res.is_err());
    let err = res.err().unwrap();
    match err {
        AppError::ProductInQuarantine { producto_id } => {
            assert_eq!(producto_id, prod_pendiente_id);
        }
        _ => panic!("Expected ProductInQuarantine error, got: {:?}", err),
    }

    // Verify database stock has NOT changed
    let qty: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = 1")
        .bind(lote_pend_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(qty, dec!(10.0), "Stock should not be decremented for blocked quarantine consumption");
}

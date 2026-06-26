mod common;

use axum::{
    Router,
    extract::{Path, Query},
    routing::get,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sqlx::PgPool;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::sleep;
use uuid::Uuid;

use inventario_lab_backend::errors::AppError;
use inventario_lab_backend::services::api_regulatoria_service;
use inventario_lab_backend::services::consumo_service::{ConsumoParams, ConsumoService};
use inventario_lab_backend::services::stock_service;

async fn mock_fda(
    Query(params): Query<HashMap<String, String>>,
) -> impl axum::response::IntoResponse {
    let di = params.get("di").cloned().unwrap_or_default();
    if di == "timeout" {
        sleep(Duration::from_millis(4000)).await;
    }
    if di == "fda_success" || di == "timeout" {
        return axum::response::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(
                r#"{
                "gudid": {
                    "device": {
                        "brandName": "FDA Brand Name",
                        "companyName": "FDA Manufacturer",
                        "catalogNumber": "FDA-CAT-123",
                        "versionModelNumber": "FDA-REF-123",
                        "deviceDescription": "FDA Device Description"
                    }
                }
            }"#,
            ))
            .unwrap();
    }
    axum::response::Response::builder()
        .status(404)
        .body(axum::body::Body::empty())
        .unwrap()
}

async fn mock_eudamed(Path(code): Path<String>) -> impl axum::response::IntoResponse {
    if code == "eudamed_success" || code == "timeout" {
        return axum::response::Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(axum::body::Body::from(
                r#"{
                "name": "Eudamed Device Name",
                "manufacturer": "Eudamed Manufacturer",
                "sku_ref": "Eudamed-REF-456",
                "clase_riesgo": "Class IIa"
            }"#,
            ))
            .unwrap();
    }
    axum::response::Response::builder()
        .status(404)
        .body(axum::body::Body::empty())
        .unwrap()
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
        std::env::set_var(
            "EUDAMED_API_URL",
            format!("http://{}/eudamed/{{code}}", addr),
        );
    }

    // Test case 1: FDA Success
    let res = api_regulatoria_service::lookup_dispositivo(&pool, "fda_success")
        .await
        .unwrap();
    assert_eq!(res.nombre, "FDA Brand Name - FDA Device Description");
    assert_eq!(res.fabricante.as_deref(), Some("FDA Manufacturer"));
    assert_eq!(res.sku_ref.unwrap(), "FDA-CAT-123");
    assert_eq!(res.descripcion.unwrap(), "FDA Device Description");

    // Test case 2: FDA Timeout, EUDAMED Success
    // FDA will sleep for 4 seconds, reqwest timeout is 3 seconds, so it will abort and hit EUDAMED
    let start = std::time::Instant::now();
    let res2 = api_regulatoria_service::lookup_dispositivo(&pool, "timeout")
        .await
        .unwrap();
    let elapsed = start.elapsed();
    assert!(
        elapsed >= Duration::from_secs(3),
        "Should take at least 3 seconds (FDA timeout)"
    );
    assert!(
        elapsed < Duration::from_secs(4),
        "Should take less than 4 seconds"
    );
    assert_eq!(res2.nombre, "Eudamed Device Name");
    assert_eq!(res2.fabricante.as_deref(), Some("Eudamed Manufacturer"));

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

    let res3 = api_regulatoria_service::lookup_dispositivo(&pool, "local_gtin")
        .await
        .unwrap();
    assert_eq!(res3.nombre, "Local Product");
    assert_eq!(res3.fabricante.as_deref(), Some("Histórico Local"));
    assert_eq!(res3.sku_ref.unwrap(), "SKU-LOCAL");

    // Test case 4: Scan barcode endpoint auto-creation (quarantine)
    use axum::http::StatusCode;
    let app_client = common::test_app(pool.clone());
    let token = common::admin_access_token(&pool).await;

    // Call GET /api/v1/productos/scan?codigo=fda_success
    let (status, scan_res) = common::get_json(
        &app_client,
        "/api/v1/productos/scan?codigo=fda_success",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        scan_res.get("encontrado").and_then(|e| e.as_bool()),
        Some(true)
    );
    assert_eq!(
        scan_res.get("producto_nombre").and_then(|n| n.as_str()),
        Some("FDA Brand Name - FDA Device Description")
    );
    assert_eq!(
        scan_res.get("tipo").and_then(|t| t.as_str()),
        Some("presentacion")
    );

    let prod_id_str = scan_res
        .get("producto_id")
        .and_then(|id| id.as_str())
        .unwrap();
    let prod_id = uuid::Uuid::parse_str(prod_id_str).unwrap();

    // Verify in DB that the product was created in quarantine
    let row: (String, String) = sqlx::query_as(
        "SELECT estado_catalogo::text, origen_registro::text FROM productos WHERE id = $1",
    )
    .bind(prod_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, "pendiente_aprobacion");
    assert_eq!(row.1, "api_regulatoria");
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
        "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0), ($2, 1, 15.0)",
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
    let pend_in_list = list
        .rows
        .iter()
        .any(|item| item.codigo_interno == "TEST-PEND");
    assert!(
        !pend_in_list,
        "Quarantined product must be hidden from clinical stock list"
    );

    // Approved product must be in the list
    let aprob_in_list = list
        .rows
        .iter()
        .any(|item| item.codigo_interno == "TEST-APROB");
    assert!(
        aprob_in_list,
        "Approved product must be visible in clinical stock list"
    );
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
    sqlx::query("INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0)")
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
    let qty: rust_decimal::Decimal =
        sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = 1")
            .bind(lote_pend_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        qty,
        dec!(10.0),
        "Stock should not be decremented for blocked quarantine consumption"
    );
}

async fn mock_ollama_chat(
    axum::Json(req): axum::Json<serde_json::Value>,
) -> impl axum::response::IntoResponse {
    let _prompt = req
        .get("messages")
        .and_then(|m| m.as_array())
        .and_then(|a| a.last())
        .and_then(|o| o.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or_default();

    axum::response::Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(r#"{
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "{\"proveedor\": \"Roche Diagnostics\", \"items\": [{\"nombre_producto\": \"PCR Roche\", \"sku_ref\": \"R-5678\", \"lote\": \"L9999\", \"fecha_vencimiento\": \"2028-06-30\", \"cantidad\": 5.0, \"precio_unitario\": 50000.0}]}"
                    }
                }
            ]
        }"#))
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn test_parse_guia_regex_y_llm_fallback(pool: PgPool) {
    use inventario_lab_backend::handlers::recepciones::{GuiaParseada, parse_guia_regex};
    use inventario_lab_backend::services::llm::parse_guia_con_llm;

    // Test Regex Parsing
    let valtek_text = "VALTEK SA\nGuia Despacho N 123456\nItem Detalle:\nV-1234  Reactivo PCR Valtek  10  L88291  2027-12-31  25000\nOTR-456  Reactivo Covid  5.5  L7771  31/12/2026";
    let parsed_regex = parse_guia_regex(valtek_text).unwrap();
    assert_eq!(parsed_regex.proveedor, "Valtek SA");
    assert_eq!(parsed_regex.items.len(), 2);
    assert_eq!(parsed_regex.items[0].sku_ref, "V-1234");
    assert_eq!(parsed_regex.items[0].nombre_producto, "Reactivo PCR Valtek");
    assert_eq!(parsed_regex.items[0].cantidad, 10.0);
    assert_eq!(parsed_regex.items[0].lote.as_deref(), Some("L88291"));
    assert_eq!(
        parsed_regex.items[0].fecha_vencimiento.as_deref(),
        Some("2027-12-31")
    );
    assert_eq!(parsed_regex.items[0].precio_unitario, Some(25000.0));

    assert_eq!(parsed_regex.items[1].sku_ref, "OTR-456");
    assert_eq!(parsed_regex.items[1].nombre_producto, "Reactivo Covid");
    assert_eq!(parsed_regex.items[1].cantidad, 5.5);
    assert_eq!(parsed_regex.items[1].lote.as_deref(), Some("L7771"));
    assert_eq!(
        parsed_regex.items[1].fecha_vencimiento.as_deref(),
        Some("2026-12-31")
    );

    // Test LLM Fallback (Ollama Mock)
    let app = Router::new().route(
        "/v1/chat/completions",
        axum::routing::post(mock_ollama_chat),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    unsafe {
        std::env::set_var("IA_PROVEEDOR", "ollama");
        std::env::set_var("IA_MODELO", "mock-llama");
        std::env::set_var("IA_API_URL", format!("http://{}", addr));
    }

    let unstructured_text = "Proveedor: Roche Diagnostics\nFactura 9876\nTenemos PCR Roche con SKU R-5678 recibidos 5 unidades, lote L9999 y expira en 2028-06-30 con precio 50000";
    let parsed_llm = parse_guia_con_llm(&pool, unstructured_text).await.unwrap();

    let guia: GuiaParseada = serde_json::from_value(parsed_llm).unwrap();
    assert_eq!(guia.proveedor, "Roche Diagnostics");
    assert_eq!(guia.items.len(), 1);
    assert_eq!(guia.items[0].sku_ref, "R-5678");
    assert_eq!(guia.items[0].nombre_producto, "PCR Roche");
    assert_eq!(guia.items[0].cantidad, 5.0);
    assert_eq!(guia.items[0].lote.as_deref(), Some("L9999"));
    assert_eq!(
        guia.items[0].fecha_vencimiento.as_deref(),
        Some("2028-06-30")
    );
    assert_eq!(guia.items[0].precio_unitario, Some(50000.0));
}

#[sqlx::test(migrations = "./migrations")]
async fn test_supervisor_catalogacion_inbox_endpoints(pool: PgPool) {
    use axum::http::StatusCode;

    let app = common::test_app(pool.clone());
    let token = common::admin_access_token(&pool).await;

    // 1. Create a quarantined product to test list_quarantine
    let prod_pendiente_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-QUAR-INBOX', 'Producto Cuarentena Inbox', 1, 'pendiente_aprobacion', 'api_regulatoria', 'con_vto')"
    )
    .bind(prod_pendiente_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Call GET /api/v1/productos/quarantine
    let (status, list_val) = common::get_json(&app, "/api/v1/productos/quarantine", &token).await;
    assert_eq!(status, StatusCode::OK);
    let items = list_val.as_array().unwrap();
    let has_item = items
        .iter()
        .any(|item| item.get("codigo_interno").and_then(|c| c.as_str()) == Some("TEST-QUAR-INBOX"));
    assert!(has_item, "List should include the quarantined product");

    // 3. Call POST /api/v1/productos/{id}/approve
    let approve_body = serde_json::json!({
        "nombre": "Producto Cuarentena Inbox Aprobado",
        "categoria_id": 1,
        "unidad_base_id": 1,
        "control_lote": "simple"
    });
    let (status_approve, resp_approve) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/approve", prod_pendiente_id),
        &token,
        approve_body,
    )
    .await;
    assert_eq!(status_approve, StatusCode::OK);
    assert_eq!(
        resp_approve.get("success").and_then(|b| b.as_bool()),
        Some(true)
    );

    // Verify it is approved in DB
    let estado: String =
        sqlx::query_scalar("SELECT estado_catalogo::text FROM productos WHERE id = $1")
            .bind(prod_pendiente_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(estado, "aprobado");

    // 4. Create another quarantined product to test reject_product
    let prod_pendiente_id2 = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO productos (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote) \
         VALUES ($1, 'TEST-QUAR-INBOX2', 'Producto Cuarentena Inbox 2', 1, 'pendiente_aprobacion', 'api_regulatoria', 'con_vto')"
    )
    .bind(prod_pendiente_id2)
    .execute(&pool)
    .await
    .unwrap();

    // Call POST /api/v1/productos/{id}/reject
    let (status_reject, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/reject", prod_pendiente_id2),
        &token,
        serde_json::Value::Null,
    )
    .await;
    // reject_product returns NO_CONTENT (204)
    assert_eq!(status_reject, StatusCode::NO_CONTENT);

    // Verify it is inactive in DB
    let activo: bool = sqlx::query_scalar("SELECT activo FROM productos WHERE id = $1")
        .bind(prod_pendiente_id2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!activo, "Rejected product should be soft-deleted");

    // 5. Test parse-guia endpoint via HTTP POST /api/v1/recepciones/parse-guia
    let valtek_text = "VALTEK SA\nGuia Despacho N 123456\nItem Detalle:\nV-1234  Reactivo PCR Valtek  10  L88291  2027-12-31  25000";
    let parse_body = serde_json::json!({
        "raw_text": valtek_text
    });
    let (status_parse, resp_parse) =
        common::post_json(&app, "/api/v1/recepciones/parse-guia", &token, parse_body).await;
    assert_eq!(status_parse, StatusCode::OK);
    assert_eq!(
        resp_parse.get("proveedor").and_then(|p| p.as_str()),
        Some("Valtek SA")
    );
    let items_parse = resp_parse.get("items").unwrap().as_array().unwrap();
    assert_eq!(items_parse.len(), 1);
    assert_eq!(
        items_parse[0].get("sku_ref").and_then(|s| s.as_str()),
        Some("V-1234")
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn test_stock_scaling_on_approval_and_lookup(pool: PgPool) {
    use axum::http::StatusCode;

    common::seed_base_data(&pool).await;
    let app = common::test_app(pool.clone());
    let token = common::admin_access_token(&pool).await;

    // 1. Create a quarantined product with pres_factor = 1.0
    let prod_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO productos 
           (id, codigo_interno, nombre, unidad_base_id, estado_catalogo, origen_registro, control_lote, pres_factor, pres_nombre, sku) 
           VALUES ($1, 'TEST-SCALE-VAL', 'Producto Escalar', 1, 'pendiente_aprobacion', 'api_regulatoria', 'con_vto', 1.00, 'Unidad', 'TEST-SCALE-VAL')"#
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create a presentation
    sqlx::query(
        r#"INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, activa) VALUES ($1, 'Unidad', 'Unidades', 1.00, true)"#
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create a lot
    let lote_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) VALUES ($1, $2, 'LOTE-SCALE', NULL)"#
    )
    .bind(lote_id)
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    // Add stock and movement directly (simulating history via trigger)

    sqlx::query(
        r#"INSERT INTO movimientos (id, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id) 
           VALUES ($1, $2, 1, 'INGRESO', 5.00, 5.00, (SELECT id FROM usuarios LIMIT 1))"#
    )
    .bind(Uuid::new_v4())
    .bind(lote_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Call lookup endpoint
    let (status_look, res_look) = common::get_json(
        &app,
        &format!("/api/v1/productos/scan/lookup?codigo=TEST-SCALE-VAL"),
        &token,
    )
    .await;
    assert_eq!(status_look, StatusCode::OK);
    assert_eq!(res_look.get("found").and_then(|b| b.as_bool()), Some(true));
    assert_eq!(
        res_look.get("source").and_then(|s| s.as_str()),
        Some("local")
    );
    assert_eq!(
        res_look
            .get("existing_product")
            .and_then(|p| p.get("estado_catalogo"))
            .and_then(|e| e.as_str()),
        Some("pendiente_aprobacion")
    );

    // 3. Call approve with pres_factor = 10.00
    let approve_payload = serde_json::json!({
        "nombre": "Producto Escalar Cambiado",
        "categoria_id": 1,
        "unidad_base_id": 1,
        "control_lote": "con_vto",
        "fabricante": "Escala Inc.",
        "ubicacion": "Caja 4",
        "pres_nombre": "Caja",
        "pres_nombre_plural": "Cajas",
        "pres_factor": 10.00
    });

    let (status_app, res_app) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/approve", prod_id),
        &token,
        approve_payload,
    )
    .await;
    assert_eq!(status_app, StatusCode::OK);
    assert_eq!(res_app.get("success").and_then(|b| b.as_bool()), Some(true));

    // 4. Verify DB changes: stock scaled, product approved, fabricante stored, presentation updated
    let prod_db: (String, Option<String>, Option<String>, Decimal) = sqlx::query_as(
        "SELECT estado_catalogo::text, fabricante, ubicacion, pres_factor FROM productos WHERE id = $1"
    )
    .bind(prod_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(prod_db.0, "aprobado");
    assert_eq!(prod_db.1.as_deref(), Some("Escala Inc."));
    assert_eq!(prod_db.2.as_deref(), Some("Caja 4"));
    assert_eq!(prod_db.3, dec!(10.00));

    let pres_factor: Decimal =
        sqlx::query_scalar("SELECT factor_conversion FROM presentaciones WHERE producto_id = $1")
            .bind(prod_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(pres_factor, dec!(10.00));

    let stock_qty: Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1")
        .bind(lote_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    // 5 * 10 = 50
    assert_eq!(stock_qty, dec!(50.00));

    let mov: (Decimal, Decimal) =
        sqlx::query_as("SELECT cantidad, cantidad_resultante FROM movimientos WHERE lote_id = $1")
            .bind(lote_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(mov.0, dec!(50.00));
    assert_eq!(mov.1, dec!(50.00));
}

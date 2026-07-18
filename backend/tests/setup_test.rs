mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

#[sqlx::test(migrations = "./migrations")]
async fn setup_estado_inicial(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/setup/estado", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["carga_inicial_completada"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_productos_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let csv_content = "\
nombre,desc,unidad,minimo
Glucosa Oxidasa,Reactivo para glucosa,unidad,500
Hemoglobina A1c,Kit HbA1c,unidad,100
Buffer pH 7.0,Buffer de calibración,unidad,1000
";

    let config = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "descripcion": "desc",
            "unidad": "unidad",
            "stock_minimo": "minimo"
        },
        "dry_run": false
    });

    let boundary = "----TestBoundary";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        config_json = config,
        csv_content = csv_content,
        boundary = boundary
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));

    assert_eq!(
        status,
        StatusCode::OK,
        "Status should be 200, got body: {:?}",
        json
    );
    assert_eq!(json["importados"].as_u64().unwrap(), 3);
    assert_eq!(json["errores"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_finalizar_y_bloquear(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Finalizar
    let (status, json) = common::post_json(
        &app,
        "/api/v1/setup/finalizar",
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["mensaje"], "Configuración finalizada");

    // Verificar que ya no se puede importar
    let config = serde_json::json!({
        "mapping": { "nombre": "nombre" },
        "dry_run": false
    });
    let boundary = "----Bound";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"test.csv\"\r\n\r\n\
         nombre\nTest\r\n\
         --{boundary}--\r\n",
        config_json = config,
        boundary = boundary
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_stock_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Importar productos primero
    let csv_productos = "\
nombre,desc,unidad,minimo
Glucosa Oxidasa,Reactivo para glucosa,unidad,500
";
    let config_productos = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "descripcion": "desc",
            "unidad": "unidad",
            "stock_minimo": "minimo"
        },
        "dry_run": false
    });
    let boundary = "----TestBoundary";
    let body_productos = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        config_json = config_productos,
        csv_content = csv_productos,
        boundary = boundary
    );
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_productos))
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 2. Importar stock para ese producto
    let csv_stock = "\
producto,lote,vencimiento,area,cantidad,costo
Glucosa Oxidasa,LOT-1234,2026-12-31,Laboratorio Central,50,1500
";
    let body_stock = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"stock.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        csv_content = csv_stock,
        boundary = boundary
    );
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-stock")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_stock))
        .unwrap();
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // 3. Verificar que se cargó el stock en la tabla stock
    let stock_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock WHERE cantidad > 0")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stock_count, 1);

    // 4. Verificar que stock_snapshot tiene la misma cantidad (CQRS / global)
    let snapshot_stock: Option<rust_decimal::Decimal> =
        sqlx::query_scalar("SELECT stock_actual FROM stock_snapshot")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(snapshot_stock, Some(rust_decimal_macros::dec!(50)));

    // 5. Verificar que se registraron movimientos y que el balance es sano
    let (bc_status, bc_json) = common::get_json(&app, "/api/v1/stock/balance-check", &token).await;
    assert_eq!(bc_status, StatusCode::OK);
    assert_eq!(bc_json["sano"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_es_cenabas_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // CSV con columna cenabas_flag
    let csv_content = "\
nombre,desc,unidad,minimo,cenabas_flag
Glucosa Cenabas,Reactivo cenabas,unidad,500,sí
Hemoglobina Regular,Kit normal,unidad,100,no
Buffer Cenabas,Calibrador cenabas,unidad,1000,true
";

    let config = serde_json::json!({
        "mapping": {
            "nombre": "nombre",
            "descripcion": "desc",
            "unidad": "unidad",
            "stock_minimo": "minimo",
            "es_cenabas": "cenabas_flag"
        },
        "dry_run": false
    });

    let boundary = "----TestBoundaryCenabas";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"config\"\r\n\r\n\
         {config_json}\r\n\
         --{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\n\
         Content-Type: text/csv\r\n\r\n\
         {csv_content}\r\n\
         --{boundary}--\r\n",
        config_json = config,
        csv_content = csv_content,
        boundary = boundary
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));

    assert_eq!(
        status,
        StatusCode::OK,
        "Status should be 200, got: {:?}",
        json
    );
    assert_eq!(json["importados"].as_u64().unwrap(), 3);

    // 1. Probar filtro positivo: es_cenabas=true
    let (status_pos, json_pos) =
        common::get_json(&app, "/api/v1/stock?es_cenabas=true", &token).await;
    assert_eq!(status_pos, StatusCode::OK);
    let data_pos = json_pos["data"].as_array().unwrap();
    // Deberían haber 2 productos de Cenabas (Glucosa Cenabas y Buffer Cenabas)
    assert_eq!(data_pos.len(), 2);
    assert!(
        data_pos
            .iter()
            .any(|p| p["producto_nombre"] == "Glucosa Cenabas")
    );
    assert!(
        data_pos
            .iter()
            .any(|p| p["producto_nombre"] == "Buffer Cenabas")
    );

    // 2. Probar filtro negativo: es_cenabas=false
    let (status_neg, json_neg) =
        common::get_json(&app, "/api/v1/stock?es_cenabas=false", &token).await;
    assert_eq!(status_neg, StatusCode::OK);
    let data_neg = json_neg["data"].as_array().unwrap();
    // Debería haber 1 producto regular (Hemoglobina Regular)
    assert_eq!(data_neg.len(), 1);
    assert_eq!(data_neg[0]["producto_nombre"], "Hemoglobina Regular");
}

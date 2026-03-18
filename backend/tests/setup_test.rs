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
nombre,descripcion,categoria,unidad_base,stock_minimo,presentacion_nombre,factor_conversion,codigo_barras
Glucosa Oxidasa,Reactivo para glucosa,Reactivos Química Clínica,ml,500,Frasco 500ml,500,7801234567890
Hemoglobina A1c,Kit HbA1c,Reactivos Hematología,test,100,Kit 100 pruebas,100,
Buffer pH 7.0,Buffer de calibración,Reactivos Química Clínica,ml,1000,Botella 1L,1000,
";

    let boundary = "----TestBoundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"productos.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv_content}\r\n--{boundary}--\r\n",
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
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["importados"].as_u64().unwrap(), 3);
    assert_eq!(json["errores"].as_u64().unwrap(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_importar_stock_csv(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Primero crear un producto
    common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Producto Stock Test",
            "unidad_base_id": 1,
        }),
    )
    .await;

    let csv_content = "\
producto_nombre_o_codigo,numero_lote,fecha_vencimiento,area,cantidad,costo_unitario
Producto Stock Test,LOT-A001,2027-06-15,Microbiología,500,1.25
Producto Stock Test,LOT-A002,2027-12-01,Bodega Reactivos,300,1.30
";

    let boundary = "----TestBoundary2";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"stock.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv_content}\r\n--{boundary}--\r\n",
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-stock")
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
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["importados"].as_u64().unwrap(), 2);

    // Verificar movimientos CARGA_INICIAL
    let mov_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM movimientos WHERE tipo = 'CARGA_INICIAL'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(mov_count.0, 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_resumen(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/setup/resumen", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(json["productos"].is_number());
    assert!(json["categorias_creadas"].is_number());
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
    assert_eq!(json["mensaje"], "Carga inicial completada");

    // Verificar que ya no se puede importar
    let boundary = "----Bound";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.csv\"\r\nContent-Type: text/csv\r\n\r\nnombre,descripcion,categoria,unidad_base,stock_minimo,presentacion_nombre,factor_conversion,codigo_barras\nTest,,,u,0,,,\r\n--{boundary}--\r\n",
    );

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/setup/importar-productos")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn setup_reiniciar(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Crear un producto
    common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Será borrado",
            "unidad_base_id": 1,
        }),
    )
    .await;

    // Reiniciar sin confirmar → error
    let (status, _) = common::delete_req(&app, "/api/v1/setup/reiniciar", &token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Reiniciar con confirmación
    let (status, json) =
        common::delete_req(&app, "/api/v1/setup/reiniciar?confirmar=true", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["mensaje"].as_str().unwrap().contains("reiniciado"));

    // Verificar que no hay productos
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count.0, 0);
}

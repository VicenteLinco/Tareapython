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
        config_json = config.to_string(),
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
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));

    assert_eq!(status, StatusCode::OK, "Status should be 200, got body: {:?}", json);
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
        config_json = config.to_string(),
        boundary = boundary
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

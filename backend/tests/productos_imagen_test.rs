mod common;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const BOUNDARY: &str = "TESTBOUNDARY";

async fn seed_producto(pool: &PgPool, codigo_interno: &str, imagen_url: Option<&str>) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id, imagen_url) VALUES ($1, $2, 1, $3) RETURNING id",
    )
    .bind(codigo_interno)
    .bind("Producto imagen")
    .bind(imagen_url)
    .fetch_one(pool)
    .await
    .expect("Should insert producto")
}

/// Sends a multipart/form-data POST with a raw body and returns (status, json).
async fn post_multipart(
    app: &axum::Router,
    path: &str,
    token: &str,
    body: String,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::PUT)
        .uri(path)
        .header("Authorization", format!("Bearer {token}"))
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null));
    (status, json)
}

/// A multipart body carrying a single non-file field (no "file" part).
fn body_sin_archivo() -> String {
    format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"other\"\r\n\r\nx\r\n--{BOUNDARY}--\r\n"
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn quitar_imagen_con_imagen_la_pone_en_null(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-I0001", Some("productos/falsa.png")).await;
    let app = common::test_app(pool);

    let (status, json) =
        common::delete_req(&app, &format!("/api/v1/productos/{id}/imagen"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["ok"], true);

    let (status, detalle) =
        common::get_json(&app, &format!("/api/v1/productos/{id}"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(detalle["imagen_url"].is_null());
}

#[sqlx::test(migrations = "./migrations")]
async fn quitar_imagen_sin_imagen_devuelve_ok(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-I0002", None).await;
    let app = common::test_app(pool);

    let (status, json) =
        common::delete_req(&app, &format!("/api/v1/productos/{id}/imagen"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["ok"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn quitar_imagen_producto_inexistente_devuelve_ok(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);
    let fantasma = Uuid::new_v4();

    let (status, json) = common::delete_req(
        &app,
        &format!("/api/v1/productos/{fantasma}/imagen"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["ok"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn subir_imagen_producto_inexistente_devuelve_404(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);
    let fantasma = Uuid::new_v4();

    let (status, _) = post_multipart(
        &app,
        &format!("/api/v1/productos/{fantasma}/imagen"),
        &token,
        body_sin_archivo(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn subir_imagen_sin_archivo_devuelve_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-I0003", None).await;
    let app = common::test_app(pool);

    let (status, _) = post_multipart(
        &app,
        &format!("/api/v1/productos/{id}/imagen"),
        &token,
        body_sin_archivo(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

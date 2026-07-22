mod common;

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn json_request(
    app: &Router,
    token: &str,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("Authorization", format!("Bearer {token}"));
    let request = if let Some(value) = body {
        builder = builder.header("Content-Type", "application/json");
        builder.body(Body::from(value.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    };
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(json!({})))
}

async fn create_batch(app: &Router, token: &str, csv: &str, key: &str) -> Value {
    let boundary = "----DurableBatchBoundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"idempotency_key\"\r\n\r\n{key}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"products.csv\"\r\nContent-Type: text/csv\r\n\r\n{csv}\r\n--{boundary}--\r\n"
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/setup/import-batches/")
                .header("Authorization", format!("Bearer {token}"))
                .header(
                    "Content-Type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    println!(
        "CREATE status={status} body={:?}",
        String::from_utf8_lossy(&bytes)
    );
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status, StatusCode::OK, "{value:?}");
    value
}

#[sqlx::test(migrations = "./migrations")]
async fn durable_batch_bulk_fill_atomic_commit_gate_and_rollback(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let created = create_batch(
        &app,
        &token,
        "nombre,descripcion\nReactivo en cuarentena,\n",
        "batch-flow-1",
    )
    .await;
    let id = Uuid::parse_str(created["batch"]["id"].as_str().unwrap()).unwrap();
    let revision = created["batch"]["revision"].as_i64().unwrap();
    let (status, validated) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/validate"),
        Some(json!({"revision":revision,"duplicate_strategy":"review"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{validated:?}");
    assert_eq!(validated["counts"]["incomplete"], 1);
    let revision = validated["revision"].as_i64().unwrap();
    let (_,preview)=json_request(&app,&token,Method::POST,&format!("/api/v1/setup/import-batches/{id}/transforms/preview"),Some(json!({"field":"descripcion","value":"Carga inicial","mode":"blank_only","revision":revision}))).await;
    assert_eq!(preview["affected"], 1);
    let token_preview = preview["preview_token"].clone();
    let (status,applied)=json_request(&app,&token,Method::POST,&format!("/api/v1/setup/import-batches/{id}/transforms/apply"),Some(json!({"field":"descripcion","value":"Carga inicial","mode":"blank_only","revision":revision,"preview_token":token_preview}))).await;
    assert_eq!(status, StatusCode::OK, "{applied:?}");
    let revision = applied["revision"].as_i64().unwrap();
    let (_, validated) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/validate"),
        Some(json!({"revision":revision,"duplicate_strategy":"review"})),
    )
    .await;
    let revision = validated["revision"].as_i64().unwrap();
    let (status, committed) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/commit"),
        Some(json!({"revision":revision})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{committed:?}");
    assert_eq!(committed["committed"], true);
    let product_id: Uuid =
        sqlx::query_scalar("SELECT id FROM productos WHERE nombre='Reactivo en cuarentena'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let state: String = sqlx::query_scalar("SELECT estado_catalogo FROM productos WHERE id=$1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "incompleto");
    let gate = sqlx::query("INSERT INTO lotes(producto_id,numero_lote) VALUES($1,'BLOCKED')")
        .bind(product_id)
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(gate.to_string().contains("PRODUCT_NOT_READY"), "{gate:?}");
    let (_, enriched) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/enrichment/{product_id}"),
        Some(json!({"unidad_base_id":1,"action":"approve"})),
    )
    .await;
    assert_eq!(enriched["updated"], true);
    sqlx::query("INSERT INTO lotes(producto_id,numero_lote) VALUES($1,'ALLOWED')")
        .bind(product_id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, blocked) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/rollback"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{blocked:?}");
}

#[sqlx::test(migrations = "./migrations")]
async fn batch_replay_is_idempotent_and_safe_rollback_keeps_audit(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let first = create_batch(&app, &token, "nombre\nProducto reversible\n", "same-key").await;
    let second = create_batch(&app, &token, "nombre\nProducto reversible\n", "same-key").await;
    assert_eq!(first["batch"]["id"], second["batch"]["id"]);
    let id = first["batch"]["id"].as_str().unwrap();
    let (_, validated) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/validate"),
        Some(json!({"revision":1,"duplicate_strategy":"skip"})),
    )
    .await;
    let (_, committed) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/commit"),
        Some(json!({"revision":validated["revision"]})),
    )
    .await;
    assert_eq!(committed["committed"], true);
    let (status, rolled) = json_request(
        &app,
        &token,
        Method::POST,
        &format!("/api/v1/setup/import-batches/{id}/rollback"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rolled:?}");
    assert_eq!(rolled["products_deleted"], 1);
    let audit: String = sqlx::query_scalar("SELECT status FROM import_batches WHERE id=$1")
        .bind(Uuid::parse_str(id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit, "rolled_back");
}

#[sqlx::test(migrations = "./migrations")]
async fn import_batches_parent_accepts_both_slash_variants(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);
    for uri in [
        "/api/v1/setup/import-batches",
        "/api/v1/setup/import-batches/",
    ] {
        let req = Request::builder()
            .method(Method::GET)
            .uri(uri)
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_ne!(status, StatusCode::NOT_FOUND, "{uri}: {json:?}");
        assert!(json.is_array(), "{uri}: {json:?}");
    }
}

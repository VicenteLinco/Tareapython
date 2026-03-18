use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

use inventario_lab_backend::auth::jwt::create_access_token;
use inventario_lab_backend::config::AppConfig;
use inventario_lab_backend::db::AppState;
use inventario_lab_backend::routes::create_routes;

/// Crea una config de prueba
pub fn test_config() -> AppConfig {
    AppConfig {
        database_url: String::new(), // no se usa, el pool viene de sqlx::test
        jwt_secret: "test-secret-key-for-testing-only".to_string(),
        jwt_access_expiration: 900,
        jwt_refresh_expiration: 86400,
        port: 0,
    }
}

/// Crea el router de prueba con el pool de test
pub fn test_app(pool: PgPool) -> Router {
    let config = test_config();
    let state = AppState {
        pool: pool.clone(),
        config: config.clone(),
    };

    let routes = create_routes(state.clone());

    Router::new()
        .merge(routes)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

/// Obtiene el ID del usuario admin del seed
pub async fn get_admin_id(pool: &PgPool) -> uuid::Uuid {
    sqlx::query_scalar("SELECT id FROM usuarios WHERE email = 'admin@laboratorio.cl'")
        .fetch_one(pool)
        .await
        .expect("Admin user should exist from seed")
}

/// Genera un access token para el admin del seed
pub async fn admin_access_token(pool: &PgPool) -> String {
    let admin_id = get_admin_id(pool).await;
    let config = test_config();

    let area_ids: Vec<i32> =
        sqlx::query_scalar("SELECT area_id FROM usuario_area WHERE usuario_id = $1")
            .bind(admin_id)
            .fetch_all(pool)
            .await
            .expect("Should fetch admin areas");

    create_access_token(admin_id, "admin", area_ids, &config).expect("Should create token")
}

/// Crea un usuario tecnólogo de prueba y retorna su access token
pub async fn create_tecnologo_token(pool: &PgPool, area_ids: &[i32]) -> String {
    let config = test_config();

    let user_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Test Tecnologo', 'tecnologo@test.cl', '$argon2id$v=19$m=19456,t=2,p=1$ohcOafUCERxCN4F0deHevg$hJNh8rweQwOhkhcc6E6KzmAPXdNZOtB34618gb16d40', 'tecnologo') RETURNING id"
    )
    .fetch_one(pool)
    .await
    .expect("Should create tecnologo");

    for area_id in area_ids {
        sqlx::query("INSERT INTO usuario_area (usuario_id, area_id) VALUES ($1, $2)")
            .bind(user_id)
            .bind(area_id)
            .execute(pool)
            .await
            .expect("Should assign area");
    }

    create_access_token(user_id, "tecnologo", area_ids.to_vec(), &config)
        .expect("Should create token")
}

/// Helper: envía un request GET y retorna (status, body_json)
pub async fn get_json(app: &Router, path: &str, token: &str) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(path)
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::json!(null));
    (status, json)
}

/// Helper: envía un request POST con JSON body
pub async fn post_json(
    app: &Router,
    path: &str,
    token: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::json!(null));
    (status, json)
}

/// Helper: envía un request PUT con JSON body
pub async fn put_json(
    app: &Router,
    path: &str,
    token: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::PUT)
        .uri(path)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::json!(null));
    (status, json)
}

/// Helper: envía un request DELETE
pub async fn delete_req(
    app: &Router,
    path: &str,
    token: &str,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::DELETE)
        .uri(path)
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!(null));
    (status, json)
}

/// Helper: POST con idempotency key
pub async fn post_json_idempotent(
    app: &Router,
    path: &str,
    token: &str,
    body: serde_json::Value,
    idem_key: &str,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("X-Idempotency-Key", idem_key)
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();

    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::json!(null));
    (status, json)
}

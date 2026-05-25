#![allow(dead_code)]
use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use sqlx::PgPool;
use tower::ServiceExt;

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use inventario_lab_backend::auth::jwt::create_access_token;
use inventario_lab_backend::config::AppConfig;
use inventario_lab_backend::db::AppState;
use inventario_lab_backend::middleware::rate_limit::RateLimiter;
use inventario_lab_backend::routes::create_routes;

pub const TEST_ADMIN_EMAIL: &str = "admin.fixture@laboratorio.test";
pub const TEST_ADMIN_PASSWORD: &str = "TestAdminFixture123!";

pub fn hash_test_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Should hash test password")
        .to_string()
}

/// Crea una config de prueba
pub fn test_config() -> AppConfig {
    AppConfig {
        database_url: String::new(), // no se usa, el pool viene de sqlx::test
        jwt_secret: "test-secret-key-for-testing-only-32-chars-long".to_string(),
        jwt_access_expiration: 900,
        jwt_refresh_expiration: 86400,
        port: 0,
        cors_origin: "*".to_string(),
        enable_swagger: false,
        login_rate_limit_per_minute: 100,
        mutation_rate_limit_per_minute: 500,
        read_rate_limit_per_minute: 1000,
        allow_bootstrap_admin: false,
        setup_admin_email: None,
        setup_admin_password: None,
    }
}

/// Crea el router de prueba con el pool de test
pub fn test_app(pool: PgPool) -> Router {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("error")
        .with_test_writer()
        .try_init();
    let config = test_config();
    let state = AppState {
        pool: pool.clone(),
        config: config.clone(),
        login_limiter: RateLimiter::new(100, 60),
        mutation_limiter: RateLimiter::new(500, 60),
        read_limiter: RateLimiter::new(1000, 60),
    };

    let routes = create_routes(state.clone());

    Router::new()
        .merge(routes)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

/// Crea el admin de prueba y lo asigna a todas las areas.
pub async fn ensure_test_admin(pool: &PgPool) -> uuid::Uuid {
    let password_hash = hash_test_password(TEST_ADMIN_PASSWORD);
    let admin_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO usuarios (nombre, email, password_hash, rol, activo) \
         VALUES ('Admin Fixture', $1, $2, 'admin', true) \
         ON CONFLICT (email) DO UPDATE \
         SET password_hash = EXCLUDED.password_hash, rol = 'admin', activo = true, updated_at = NOW() \
         RETURNING id",
    )
    .bind(TEST_ADMIN_EMAIL)
    .bind(password_hash)
    .fetch_one(pool)
    .await
    .expect("Should create test admin");

    sqlx::query(
        "INSERT INTO usuario_area (usuario_id, area_id) \
         SELECT $1, id FROM areas \
         ON CONFLICT DO NOTHING",
    )
    .bind(admin_id)
    .execute(pool)
    .await
    .expect("Should assign all areas to test admin");

    admin_id
}

/// Obtiene el ID del usuario admin de prueba
pub async fn get_admin_id(pool: &PgPool) -> uuid::Uuid {
    ensure_test_admin(pool).await
}

/// Genera un access token para el admin de prueba
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
    let password_hash = hash_test_password("TestTecnologoFixture123!");

    let user_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Test Tecnologo', 'tecnologo@test.cl', $1, 'tecnologo') RETURNING id"
    )
    .bind(password_hash)
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
pub async fn delete_req(app: &Router, path: &str, token: &str) -> (StatusCode, serde_json::Value) {
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

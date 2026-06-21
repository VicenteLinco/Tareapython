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
        jwt_refresh_secret: "test-refresh-secret-for-testing-only-32-chars-long".to_string(),
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
        twilio_auth_token: String::new(),
        whatsapp_webhook_secret: String::new(),
        whatsapp_api_url: String::new(),
        whatsapp_api_key: String::new(),
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

/// Siembra el catálogo base que las migraciones no crean pero los tests asumen
/// existente: 6 unidades básicas, 12 áreas y 10 categorías. `#[sqlx::test]` solo
/// aplica migraciones sobre una DB efímera; el seed de catálogos vivía en un
/// `002_seed_data.sql` que el squash a `001_initial_schema.sql` eliminó. Sin esto,
/// `unidad_base_id: 1` / `area_id: 1` no existen (422 / FK violation) y los tests
/// que cuentan "del seed" (12 áreas, ≥8 categorías, ≥6 unidades) fallan.
///
/// Réplica del seed histórico, adaptada al schema actual (`unidades_basicas` con
/// `nombre_plural` + `categoria`). `id` explícito para que los tests puedan
/// referenciar `id = 1`. Idempotente vía `ON CONFLICT (id) DO NOTHING`.
///
/// Tras insertar con `id` explícito hay que avanzar cada secuencia con `setval`:
/// si no, `nextval` sigue devolviendo 1 y la primera fila creada vía API colisiona
/// en PK con la sembrada.
pub async fn seed_base_data(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO unidades_basicas (id, nombre, nombre_plural, categoria) VALUES \
            (1, 'unidad', 'unidades', 'count'), \
            (2, 'mililitro', 'mililitros', 'volume'), \
            (3, 'gramo', 'gramos', 'weight'), \
            (4, 'prueba', 'pruebas', 'count'), \
            (5, 'litro', 'litros', 'volume'), \
            (6, 'kilogramo', 'kilogramos', 'weight') \
         ON CONFLICT (id) DO NOTHING",
    )
    .execute(pool)
    .await
    .expect("Should seed base unidades_basicas");

    sqlx::query(
        "INSERT INTO areas (id, nombre, es_bodega) VALUES \
            (1, 'Microbiología', false), \
            (2, 'PCR', false), \
            (3, 'Orinas', false), \
            (4, 'Recepción', false), \
            (5, 'Laboratorio Central', false), \
            (6, 'Bodega Insumos', true), \
            (7, 'Bodega Reactivos', true), \
            (8, 'Serología', false), \
            (9, 'Unidad de Medicina Transfusional', false), \
            (10, 'Donantes', false), \
            (11, 'Sala Entrevista Donantes', false), \
            (12, 'Sala de Toma de Muestras', false) \
         ON CONFLICT (id) DO NOTHING",
    )
    .execute(pool)
    .await
    .expect("Should seed base areas");

    sqlx::query(
        "INSERT INTO categorias (id, nombre, descripcion) VALUES \
            (1, 'Reactivo', 'Compuestos químicos para reacciones diagnósticas'), \
            (2, 'Consumible', 'Material de uso único: tubos, puntas, placas, lancetas'), \
            (3, 'Calibrador', 'Materiales de calibración de equipos analíticos'), \
            (4, 'Control', 'Sueros y materiales de control de calidad interno'), \
            (5, 'Kit diagnóstico', 'Kits completos para pruebas específicas'), \
            (6, 'Medio de cultivo', 'Medios sólidos y líquidos para microbiología'), \
            (7, 'Material de extracción', 'Tubos vacutainer, agujas, torniquetes'), \
            (8, 'Solución / Buffer', 'Diluyentes, soluciones de lavado y fijadores'), \
            (9, 'EPP', 'Equipos de protección personal: guantes, mascarillas, lentes'), \
            (10, 'Papelería', 'Etiquetas, formularios y material administrativo') \
         ON CONFLICT (id) DO NOTHING",
    )
    .execute(pool)
    .await
    .expect("Should seed base categorias");

    // Avanza las secuencias para que el próximo nextval sea MAX(id)+1.
    for tabla in ["unidades_basicas", "areas", "categorias"] {
        sqlx::query(&format!(
            "SELECT setval(pg_get_serial_sequence('{tabla}', 'id'), \
                           GREATEST((SELECT MAX(id) FROM {tabla}), 1))"
        ))
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("Should bump {tabla} sequence: {e}"));
    }
}

/// Crea el admin de prueba y lo asigna a todas las areas.
pub async fn ensure_test_admin(pool: &PgPool) -> uuid::Uuid {
    seed_base_data(pool).await;
    let password_hash = hash_test_password(TEST_ADMIN_PASSWORD);
    // Upsert en dos pasos: el unique de `email` es parcial (WHERE deleted_at IS NULL por el
    // soft-delete de migration 025), así que ON CONFLICT (email) no matchea ningún índice.
    let existing: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT id FROM usuarios WHERE email = $1")
            .bind(TEST_ADMIN_EMAIL)
            .fetch_optional(pool)
            .await
            .expect("Should query test admin");

    let admin_id: uuid::Uuid = if let Some(id) = existing {
        sqlx::query(
            "UPDATE usuarios SET password_hash = $2, rol = 'admin', activo = true, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(id)
        .bind(&password_hash)
        .execute(pool)
        .await
        .expect("Should update test admin");
        id
    } else {
        sqlx::query_scalar(
            "INSERT INTO usuarios (nombre, email, password_hash, rol, activo) \
             VALUES ('Admin Fixture', $1, $2, 'admin', true) \
             RETURNING id",
        )
        .bind(TEST_ADMIN_EMAIL)
        .bind(&password_hash)
        .fetch_one(pool)
        .await
        .expect("Should create test admin")
    };

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
    seed_base_data(pool).await;
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

/// Helper: envía un request PATCH con JSON body
pub async fn patch_json(
    app: &Router,
    path: &str,
    token: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let req = Request::builder()
        .method(Method::PATCH)
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

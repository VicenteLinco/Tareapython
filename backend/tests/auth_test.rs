mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn login_exitoso(pool: PgPool) {
    common::ensure_test_admin(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": common::TEST_ADMIN_EMAIL,
            "password": common::TEST_ADMIN_PASSWORD
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(json["access_token"].is_string());
    assert!(json["refresh_token"].is_string());
    assert_eq!(json["token_type"], "Bearer");
}

#[sqlx::test(migrations = "./migrations")]
async fn login_password_incorrecto(pool: PgPool) {
    common::ensure_test_admin(&pool).await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": common::TEST_ADMIN_EMAIL,
            "password": "WrongPassword"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn login_email_inexistente(pool: PgPool) {
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": "noexiste@lab.cl",
            "password": common::TEST_ADMIN_PASSWORD
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn me_retorna_usuario_autenticado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/auth/me", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["email"], common::TEST_ADMIN_EMAIL);
    assert_eq!(json["rol"], "admin");
}

#[sqlx::test(migrations = "./migrations")]
async fn me_sin_token_retorna_401(pool: PgPool) {
    let app = common::test_app(pool);

    let (status, _) = common::get_json(&app, "/api/v1/auth/me", "invalid-token").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn refresh_token_funciona(pool: PgPool) {
    common::ensure_test_admin(&pool).await;
    let app = common::test_app(pool.clone());

    // Login para obtener refresh token
    let (_, login_json) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": common::TEST_ADMIN_EMAIL,
            "password": common::TEST_ADMIN_PASSWORD
        }),
    )
    .await;

    let refresh_token = login_json["refresh_token"].as_str().unwrap();

    // Usar refresh token
    let app2 = common::test_app(pool);
    let (status, json) = common::post_json(
        &app2,
        "/api/v1/auth/refresh",
        "",
        serde_json::json!({ "refresh_token": refresh_token }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(json["access_token"].is_string());
    assert!(json["refresh_token"].is_string());
    assert_ne!(json["refresh_token"], refresh_token);
}

#[sqlx::test(migrations = "./migrations")]
async fn refresh_token_no_se_puede_reutilizar(pool: PgPool) {
    common::ensure_test_admin(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, login_json) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": common::TEST_ADMIN_EMAIL,
            "password": common::TEST_ADMIN_PASSWORD
        }),
    )
    .await;

    let refresh_token = login_json["refresh_token"].as_str().unwrap();
    let body = serde_json::json!({ "refresh_token": refresh_token });

    let (first_status, first_json) =
        common::post_json(&app, "/api/v1/auth/refresh", "", body.clone()).await;
    let (second_status, _) = common::post_json(&app, "/api/v1/auth/refresh", "", body).await;
    let replacement_token = first_json["refresh_token"].as_str().unwrap();
    let (replacement_status, _) = common::post_json(
        &app,
        "/api/v1/auth/refresh",
        "",
        serde_json::json!({ "refresh_token": replacement_token }),
    )
    .await;

    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::UNAUTHORIZED);
    assert_eq!(replacement_status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_revoca_refresh_token(pool: PgPool) {
    common::ensure_test_admin(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, login_json) = common::post_json(
        &app,
        "/api/v1/auth/login",
        "",
        serde_json::json!({
            "email": common::TEST_ADMIN_EMAIL,
            "password": common::TEST_ADMIN_PASSWORD
        }),
    )
    .await;

    let refresh_token = login_json["refresh_token"].as_str().unwrap();
    let body = serde_json::json!({ "refresh_token": refresh_token });

    let (logout_status, _) = common::post_json(&app, "/api/v1/auth/logout", "", body.clone()).await;
    let (refresh_status, _) = common::post_json(&app, "/api/v1/auth/refresh", "", body).await;

    assert_eq!(logout_status, StatusCode::OK);
    assert_eq!(refresh_status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn cambiar_password(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/auth/cambiar-password",
        &token,
        serde_json::json!({
            "password_actual": common::TEST_ADMIN_PASSWORD,
            "password_nueva": "NuevaPassword123!"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
}

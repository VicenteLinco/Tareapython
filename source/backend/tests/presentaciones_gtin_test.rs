mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// Inserts a minimal producto + presentacion and returns the presentacion id.
async fn seed_presentacion(pool: &PgPool, codigo_interno: &str) -> i32 {
    let producto_id: Uuid = sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ($1, $2, 1) RETURNING id",
    )
    .bind(codigo_interno)
    .bind("Reactivo GTIN")
    .fetch_one(pool)
    .await
    .expect("insert producto");

    sqlx::query_scalar(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion) \
         VALUES ($1, 'Caja', 'Cajas', 1) RETURNING id",
    )
    .bind(producto_id)
    .fetch_one(pool)
    .await
    .expect("insert presentacion")
}

/// Reads a presentation row from GET /presentaciones by id.
async fn fetch_pres(app: &axum::Router, token: &str, id: i32) -> serde_json::Value {
    let (status, json) = common::get_json(app, "/api/v1/presentaciones", token).await;
    assert_eq!(status, StatusCode::OK);
    json.as_array()
        .expect("array")
        .iter()
        .find(|p| p["id"].as_i64() == Some(id as i64))
        .cloned()
        .expect("presentacion in list")
}

#[sqlx::test(migrations = "./migrations")]
async fn asignar_gtin_manual_marca_no_interno(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_presentacion(&pool, "PRD-G0001").await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/presentaciones/{id}/assign-gtin"),
        &token,
        serde_json::json!({ "gtin": "4006381333931" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["gtin"], "4006381333931");
    assert_eq!(json["generated"], false);

    let pres = fetch_pres(&app, &token, id).await;
    assert_eq!(pres["gtin"], "4006381333931");
    assert_eq!(pres["gtin_interno"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn generar_gtin_interno_marca_interno(pool: PgPool) {
    // The internal generator reads these config rows; they are not seeded by migrations.
    sqlx::query(
        "INSERT INTO configuracion (clave, valor_texto) VALUES \
         ('gtin_company_prefix', '779000'), ('gtin_next_sequence', '1')",
    )
    .execute(&pool)
    .await
    .expect("seed gtin config");

    let token = common::admin_access_token(&pool).await;
    let id = seed_presentacion(&pool, "PRD-G0002").await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/presentaciones/{id}/assign-gtin"),
        &token,
        serde_json::json!({ "generate_internal": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["generated"], true);

    let pres = fetch_pres(&app, &token, id).await;
    assert!(pres["gtin"].is_string());
    assert_eq!(pres["gtin_interno"], true);
}

#[sqlx::test(migrations = "./migrations")]
async fn quitar_gtin_lo_limpia(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_presentacion(&pool, "PRD-G0003").await;
    let app = common::test_app(pool);

    common::post_json(
        &app,
        &format!("/api/v1/presentaciones/{id}/assign-gtin"),
        &token,
        serde_json::json!({ "gtin": "4006381333931" }),
    )
    .await;

    let (status, _) =
        common::delete_req(&app, &format!("/api/v1/presentaciones/{id}/gtin"), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let pres = fetch_pres(&app, &token, id).await;
    assert!(pres["gtin"].is_null());
    assert_eq!(pres["gs1_habilitado"], false);
    assert_eq!(pres["gtin_interno"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn asignar_gtin_longitud_invalida_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_presentacion(&pool, "PRD-G0004").await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/presentaciones/{id}/assign-gtin"),
        &token,
        serde_json::json!({ "gtin": "12345" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

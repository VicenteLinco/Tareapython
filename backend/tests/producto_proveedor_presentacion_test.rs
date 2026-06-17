mod common;

use axum::http::StatusCode;
use axum::Router;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Test fixture helpers ─────────────────────────────────────────────────────

/// Creates a proveedor and a producto (with one presentacion) via the API.
/// Returns (producto_proveedor_id, presentacion_id, producto_id).
async fn setup_pp(pool: &PgPool, token: &str, app: &Router) -> (i32, i32, Uuid) {
    // Create proveedor
    let (_, prov) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({ "nombre": format!("TestProv-{}", &Uuid::new_v4().to_string()[..8]) }),
    )
    .await;
    let proveedor_id = prov["id"].as_i64().unwrap() as i32;

    // Create producto with one presentacion
    let (_, prod) = common::post_json(
        app,
        "/api/v1/productos",
        token,
        serde_json::json!({
            "nombre": format!("TestProd-{}", &Uuid::new_v4().to_string()[..8]),
            "unidad_base_id": 1,
            "proveedor_id": proveedor_id,
            "stock_minimo": 0,
            "presentaciones": [{ "nombre": "Caja", "nombre_plural": "Cajas", "factor_conversion": 10 }]
        }),
    )
    .await;
    let producto_id: Uuid = prod["id"].as_str().unwrap().parse().unwrap();

    // Resolve the presentacion id
    let presentacion_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_id)
            .fetch_one(pool)
            .await
            .unwrap();

    // Resolve the producto_proveedor id
    let pp_id: i32 = sqlx::query_scalar(
        "SELECT id FROM producto_proveedor WHERE producto_id = $1 AND proveedor_id = $2 LIMIT 1",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .fetch_one(pool)
    .await
    .unwrap();

    (pp_id, presentacion_id, producto_id)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// Listing presentations for a supplier+product link with no entries returns an empty array.
#[sqlx::test(migrations = "./migrations")]
async fn test_listar_presentaciones_proveedor_empty(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, _, _) = setup_pp(&pool, &token, &app).await;

    let (status, body) = common::get_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert!(body.as_array().unwrap().is_empty(), "Expected empty array, got: {body}");
}

/// Adding a presentation to a supplier+product link returns 201 with full row data.
#[sqlx::test(migrations = "./migrations")]
async fn test_agregar_presentacion_ok(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    let (status, body) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert_eq!(body["presentacion_id"], pres_id);
    assert!(body["id"].is_number(), "Expected id in response");
    assert_eq!(body["activo"], true);
    assert_eq!(body["es_default"], false);
}

/// The new presentation should appear in the listing after being added.
#[sqlx::test(migrations = "./migrations")]
async fn test_listar_presentaciones_proveedor_after_add(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    // Add a presentation
    common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;

    let (status, body) = common::get_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    let items = body.as_array().unwrap();
    assert_eq!(items.len(), 1, "Expected 1 item, got: {}", items.len());
    assert_eq!(items[0]["presentacion_id"], pres_id);
    assert!(items[0]["presentacion_nombre"].is_string());
    assert!(items[0]["factor_conversion"].is_number());
}

/// Adding the same presentacion_id twice returns 409 Conflict.
#[sqlx::test(migrations = "./migrations")]
async fn test_agregar_presentacion_duplicate(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    // Add once — should succeed
    common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;

    // Add again — should conflict
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT, "Expected 409 on duplicate");
}

/// Adding a presentation from a different product returns 422 (cross-product guard).
#[sqlx::test(migrations = "./migrations")]
async fn test_agregar_presentacion_cross_product_guard(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, _, _) = setup_pp(&pool, &token, &app).await;

    // Create a second, different product
    let (_, prod2) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": format!("OtherProd-{}", &Uuid::new_v4().to_string()[..8]),
            "unidad_base_id": 1,
            "stock_minimo": 0,
            "presentaciones": [{ "nombre": "Bolsa", "nombre_plural": "Bolsas", "factor_conversion": 5 }]
        }),
    )
    .await;
    let other_producto_id: Uuid = prod2["id"].as_str().unwrap().parse().unwrap();
    let other_pres_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(other_producto_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // Try to add the other product's presentation to pp_id — must be rejected
    let (status, body) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": other_pres_id }),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 422 for cross-product guard, body: {body}"
    );
}

/// set-default switches the default flag: old default loses it, new one gains it.
#[sqlx::test(migrations = "./migrations")]
async fn test_set_default_switches_correctly(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id_a, producto_id) = setup_pp(&pool, &token, &app).await;

    // Create a second presentation for the same product
    let (_, pres_b) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/presentaciones", producto_id),
        &token,
        serde_json::json!({ "nombre": "Bolsa", "nombre_plural": "Bolsas", "factor_conversion": 5 }),
    )
    .await;
    let pres_id_b = pres_b["id"].as_i64().unwrap() as i32;

    // Add both presentations to the pp link
    let (_, row_a) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id_a }),
    )
    .await;
    let ppp_id_a = row_a["id"].as_i64().unwrap() as i32;

    let (_, row_b) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id_b }),
    )
    .await;
    let ppp_id_b = row_b["id"].as_i64().unwrap() as i32;

    // Set A as default first
    let (status_a, _) = common::patch_json(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}/set-default",
            pp_id, ppp_id_a
        ),
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status_a, StatusCode::OK, "Expected 200 when setting A as default");

    // Now set B as default — A must lose it
    let (status_b, _) = common::patch_json(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}/set-default",
            pp_id, ppp_id_b
        ),
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status_b, StatusCode::OK, "Expected 200 when setting B as default");

    // Verify DB state
    let a_default: bool =
        sqlx::query_scalar("SELECT es_default FROM producto_proveedor_presentacion WHERE id = $1")
            .bind(ppp_id_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    let b_default: bool =
        sqlx::query_scalar("SELECT es_default FROM producto_proveedor_presentacion WHERE id = $1")
            .bind(ppp_id_b)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(!a_default, "A should no longer be default");
    assert!(b_default, "B should be default");
}

/// Soft-deleting the current default returns 422 PPP_IS_DEFAULT.
#[sqlx::test(migrations = "./migrations")]
async fn test_quitar_default_bloqueado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    // Add presentation and set as default
    let (_, row) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;
    let ppp_id = row["id"].as_i64().unwrap() as i32;

    common::patch_json(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}/set-default",
            pp_id, ppp_id
        ),
        &token,
        serde_json::json!({}),
    )
    .await;

    // Try to delete the default — must be rejected
    let (status, body) = common::delete_req(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}",
            pp_id, ppp_id
        ),
        &token,
    )
    .await;

    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 422 PPP_IS_DEFAULT, body: {body}"
    );
    assert_eq!(body["code"], "PPP_IS_DEFAULT", "body: {body}");
}

/// Calling set-default on a soft-deleted (inactive) presentation returns 422 PPP_INACTIVE.
#[sqlx::test(migrations = "./migrations")]
async fn test_set_default_on_inactive_returns_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    // Add a presentation (non-default)
    let (_, row) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;
    let ppp_id = row["id"].as_i64().unwrap() as i32;

    // Soft-delete it
    let (del_status, _) = common::delete_req(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones/{}", pp_id, ppp_id),
        &token,
    )
    .await;
    assert_eq!(del_status, StatusCode::OK, "Soft delete should succeed");

    // Now try to set the inactive row as default — must fail with PPP_INACTIVE
    let (status, body) = common::patch_json(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}/set-default",
            pp_id, ppp_id
        ),
        &token,
        serde_json::json!({}),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 422 PPP_INACTIVE, body: {body}"
    );
    assert_eq!(body["code"], "PPP_INACTIVE", "body: {body}");
}

/// Soft-deleting a non-default presentation succeeds and removes it from the active list.
#[sqlx::test(migrations = "./migrations")]
async fn test_quitar_presentacion_ok(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (pp_id, pres_id, _) = setup_pp(&pool, &token, &app).await;

    // Add presentation (non-default)
    let (_, row) = common::post_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
        serde_json::json!({ "presentacion_id": pres_id }),
    )
    .await;
    let ppp_id = row["id"].as_i64().unwrap() as i32;

    // Delete it
    let (status, _) = common::delete_req(
        &app,
        &format!(
            "/api/v1/producto-proveedor/{}/presentaciones/{}",
            pp_id, ppp_id
        ),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Expected 200 on soft delete");

    // Row must still exist in DB but with activo = false
    let activo: bool =
        sqlx::query_scalar("SELECT activo FROM producto_proveedor_presentacion WHERE id = $1")
            .bind(ppp_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!activo, "Row should be inactive after soft delete");

    // Should NOT appear in the active list
    let (_, list) = common::get_json(
        &app,
        &format!("/api/v1/producto-proveedor/{}/presentaciones", pp_id),
        &token,
    )
    .await;
    assert!(
        list.as_array().unwrap().is_empty(),
        "Inactive row should not appear in list"
    );
}

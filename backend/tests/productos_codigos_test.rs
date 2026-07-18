mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// Inserta un producto mínimo y devuelve su id.
async fn seed_producto(pool: &PgPool, codigo_interno: &str, nombre: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ($1, $2, 1) RETURNING id",
    )
    .bind(codigo_interno)
    .bind(nombre)
    .fetch_one(pool)
    .await
    .expect("Should insert producto")
}

#[sqlx::test(migrations = "./migrations")]
async fn agregar_y_listar_codigos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0001", "Reactivo con codigos").await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/productos/{id}/codigos"),
        &token,
        serde_json::json!({ "codigo": "7891234567890" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["codigo"], "7891234567890");
    assert!(json["id"].as_i64().is_some());

    let (status, json) =
        common::get_json(&app, &format!("/api/v1/productos/{id}/codigos"), &token).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().expect("array de codigos");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["codigo"], "7891234567890");
}

#[sqlx::test(migrations = "./migrations")]
async fn agregar_codigo_vacio_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0002", "Reactivo vacio").await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{id}/codigos"),
        &token,
        serde_json::json!({ "codigo": "   " }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn agregar_codigo_producto_inexistente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);
    let fantasma = Uuid::new_v4();

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{fantasma}/codigos"),
        &token,
        serde_json::json!({ "codigo": "123456" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn agregar_codigo_duplicado_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0003", "Reactivo duplicado").await;
    let app = common::test_app(pool);

    let path = format!("/api/v1/productos/{id}/codigos");
    let body = serde_json::json!({ "codigo": "DUP-001" });

    let (status, _) = common::post_json(&app, &path, &token, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = common::post_json(&app, &path, &token, body).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn eliminar_codigo_lo_quita_del_listado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0004", "Reactivo a borrar").await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/productos/{id}/codigos"),
        &token,
        serde_json::json!({ "codigo": "DEL-001" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let codigo_id = json["id"].as_i64().unwrap();

    let (status, _) = common::delete_req(
        &app,
        &format!("/api/v1/productos/{id}/codigos/{codigo_id}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) =
        common::get_json(&app, &format!("/api/v1/productos/{id}/codigos"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn eliminar_codigo_inexistente_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0005", "Reactivo sin codigo").await;
    let app = common::test_app(pool);

    let (status, _) = common::delete_req(
        &app,
        &format!("/api/v1/productos/{id}/codigos/999999"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn obtener_detalle_incluye_codigos_barras(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0006", "Reactivo con detalle").await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{id}/codigos"),
        &token,
        serde_json::json!({ "codigo": "DET-001" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) = common::get_json(&app, &format!("/api/v1/productos/{id}"), &token).await;
    assert_eq!(status, StatusCode::OK);
    let codigos = json["codigos_barras"].as_array().expect("codigos_barras");
    assert_eq!(codigos.len(), 1);
    assert_eq!(codigos[0]["codigo"], "DET-001");
}

#[sqlx::test(migrations = "./migrations")]
async fn asignar_codigo_via_scan(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let id = seed_producto(&pool, "PRD-B0007", "Reactivo asignar").await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/productos/scan/asignar",
        &token,
        serde_json::json!({ "codigo": "SCAN-001", "producto_id": id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["codigo"], "SCAN-001");
    assert_eq!(json["producto_id"], serde_json::json!(id));
}

#[sqlx::test(migrations = "./migrations")]
async fn agregar_codigo_en_conflicto_con_barcode_primario_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    // Producto B se inserta antes de mover el pool al router.
    let id_b = seed_producto(&pool, "PRD-B0008", "Producto B").await;
    let app = common::test_app(pool);

    // Producto A con un código de barras PRIMARIO (en presentaciones).
    let (status, _) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Producto con primario",
            "unidad_base_id": 1,
            "presentaciones": [{
                "nombre": "Caja",
                "nombre_plural": "Cajas",
                "factor_conversion": 10.0,
                "codigo_barras": "PRIMARY-999"
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Producto B intenta registrar el mismo código como alias secundario.
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{id_b}/codigos"),
        &token,
        serde_json::json!({ "codigo": "PRIMARY-999" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

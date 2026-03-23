mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn crear_producto_con_presentaciones(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Glucosa Oxidasa",
            "descripcion": "Reactivo para glucosa",
            "categoria_id": 1,
            "unidad_base_id": 1,
            "stock_minimo": 500,
            "presentaciones": [
                { "nombre": "Frasco 500ml", "nombre_plural": "Frascos 500ml", "factor_conversion": 500 },
                { "nombre": "Caja x10", "nombre_plural": "Cajas x10", "factor_conversion": 10 }
            ],
            "area_ids": [1, 2]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(json["id"].is_string());
    assert!(json["codigo_interno"].as_str().unwrap().starts_with("PRD-"));
}

#[sqlx::test(migrations = "./migrations")]
async fn listar_productos_paginado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;

    // Crear varios productos
    for i in 1..=5 {
        sqlx::query(
            "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ($1, $2, 1)",
        )
        .bind(format!("PRD-T{:04}", i))
        .bind(format!("Producto Test {}", i))
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = common::test_app(pool);

    // Página 1
    let (status, json) = common::get_json(
        &app,
        "/api/v1/productos?page=1&per_page=2",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"].as_array().unwrap().len(), 2);
    assert_eq!(json["total"], 5);
    assert_eq!(json["page"], 1);
    assert_eq!(json["per_page"], 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn buscar_productos_por_nombre(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;

    sqlx::query(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ('PRD-X0001', 'Hemoglobina Glicosilada', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ('PRD-X0002', 'Buffer pH', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = common::test_app(pool);

    let (status, json) = common::get_json(
        &app,
        "/api/v1/productos?q=hemoglobina",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"].as_array().unwrap().len(), 1);
    assert_eq!(json["data"][0]["nombre"], "Hemoglobina Glicosilada");
}

#[sqlx::test(migrations = "./migrations")]
async fn obtener_detalle_producto(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Crear producto
    let (_, json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Test Detalle",
            "unidad_base_id": 1,
            "presentaciones": [
                { "nombre": "Unitario", "nombre_plural": "Unitarios", "factor_conversion": 1 }
            ]
        }),
    )
    .await;

    let id = json["id"].as_str().unwrap();

    let (status, json) = common::get_json(
        &app,
        &format!("/api/v1/productos/{}", id),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["nombre"], "Test Detalle");
    assert_eq!(json["presentaciones"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn actualizar_producto_optimistic_locking(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // Crear
    let (_, json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Original",
            "unidad_base_id": 1,
        }),
    )
    .await;
    let id = json["id"].as_str().unwrap();

    // Actualizar con version correcta
    let (status, json) = common::put_json(
        &app,
        &format!("/api/v1/productos/{}", id),
        &token,
        serde_json::json!({
            "nombre": "Modificado",
            "version": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["nombre"], "Modificado");
    assert_eq!(json["version"], 2);

    // Actualizar con version incorrecta → 409
    let (status, _) = common::put_json(
        &app,
        &format!("/api/v1/productos/{}", id),
        &token,
        serde_json::json!({
            "nombre": "Otra vez",
            "version": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_presentacion_para_producto(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // Crear producto
    let (_, json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Para Presentacion",
            "unidad_base_id": 1,
        }),
    )
    .await;
    let producto_id = json["id"].as_str().unwrap();

    // Crear presentación
    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/presentaciones", producto_id),
        &token,
        serde_json::json!({
            "nombre": "Caja x20",
            "nombre_plural": "Cajas x20",
            "factor_conversion": 20,
            "codigo_barras": "7891234567890"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["nombre"], "Caja x20");
    assert_eq!(json["factor_conversion"], "20.00");
}

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
    let (status, json) =
        common::get_json(&app, "/api/v1/productos?page=1&per_page=2", &token).await;

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

    let (status, json) = common::get_json(&app, "/api/v1/productos?q=hemoglobina", &token).await;

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

    let (status, json) = common::get_json(&app, &format!("/api/v1/productos/{}", id), &token).await;

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
    assert_eq!(json["factor_conversion"], "20.000000");
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_presentaciones_con_sku_duplicado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // 1. Crear producto 1
    let (_, prod1_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Producto 1 para SKU",
            "unidad_base_id": 1,
        }),
    )
    .await;
    let prod1_id = prod1_json["id"].as_str().unwrap();

    // 2. Crear producto 2
    let (_, prod2_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Producto 2 para SKU",
            "unidad_base_id": 1,
        }),
    )
    .await;
    let prod2_id = prod2_json["id"].as_str().unwrap();

    // 3. Crear presentación para producto 1 con SKU "SKU-DUPLICADO"
    let (status1, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/presentaciones", prod1_id),
        &token,
        serde_json::json!({
            "nombre": "Frasco 1",
            "nombre_plural": "Frascos 1",
            "factor_conversion": 10,
            "sku": "SKU-DUPLICADO"
        }),
    )
    .await;
    assert_eq!(status1, StatusCode::CREATED);

    // 4. Intentar crear presentación para producto 2 con el mismo SKU "SKU-DUPLICADO" -> 409 o similar database error/validation error.
    // En Axum/AppError, los errores de clave única en base de datos retornan INTERNAL o un error específico si se mapea.
    // Veamos qué status retorna. Debería fallar por la clave única en base de datos.
    let (status2, _) = common::post_json(
        &app,
        &format!("/api/v1/productos/{}/presentaciones", prod2_id),
        &token,
        serde_json::json!({
            "nombre": "Frasco 2",
            "nombre_plural": "Frascos 2",
            "factor_conversion": 10,
            "sku": "SKU-DUPLICADO"
        }),
    )
    .await;
    
    // El error de clave única se mapea como AppError::Database/Internal, que retorna un status de error.
    assert!(status2.is_client_error() || status2.is_server_error());
}

#[sqlx::test(migrations = "./migrations")]
async fn listar_filtra_por_categoria(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;

    // Producto en categoría 1 y otro en categoría 2 (ambos del seed base).
    sqlx::query(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id, categoria_id) VALUES ('PRD-C0001', 'Reactivo Cat Uno', 1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id, categoria_id) VALUES ('PRD-C0002', 'Reactivo Cat Dos', 1, 2)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = common::test_app(pool);

    let (status, json) =
        common::get_json(&app, "/api/v1/productos?categoria_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["total"], 1);
    assert_eq!(json["data"][0]["nombre"], "Reactivo Cat Uno");
}

#[sqlx::test(migrations = "./migrations")]
async fn listar_ordena_por_codigo_desc(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;

    for i in 1..=3 {
        sqlx::query(
            "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ($1, $2, 1)",
        )
        .bind(format!("PRD-S{:04}", i))
        .bind(format!("Sortable {}", i))
        .execute(&pool)
        .await
        .unwrap();
    }

    let app = common::test_app(pool);

    let (status, json) = common::get_json(
        &app,
        "/api/v1/productos?sort_by=codigo&sort_dir=desc",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["data"][0]["codigo_interno"], "PRD-S0003");
}

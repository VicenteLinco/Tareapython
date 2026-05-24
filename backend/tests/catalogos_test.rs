mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

// ==========================================
// CATEGORÍAS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn crear_categoria(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/categorias",
        &token,
        serde_json::json!({ "nombre": "Test Categoría", "descripcion": "Desc" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["nombre"], "Test Categoría");
    assert!(json["id"].is_number());
}

#[sqlx::test(migrations = "./migrations")]
async fn listar_categorias(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/categorias", &token).await;

    assert_eq!(status, StatusCode::OK);
    // Seed tiene 8 categorías
    assert!(json.as_array().unwrap().len() >= 8);
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_categoria_duplicada_retorna_409(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // "Reactivo" ya existe en seed
    let (status, _) = common::post_json(
        &app,
        "/api/v1/categorias",
        &token,
        serde_json::json!({ "nombre": "Reactivo" }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
async fn actualizar_categoria(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // Crear una
    let (_, json) = common::post_json(
        &app,
        "/api/v1/categorias",
        &token,
        serde_json::json!({ "nombre": "Temporal" }),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let version = json["version"].as_i64().unwrap();

    // Actualizar
    let (status, json) = common::put_json(
        &app,
        &format!("/api/v1/categorias/{}", id),
        &token,
        serde_json::json!({ "nombre": "Actualizada", "version": version }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["nombre"], "Actualizada");
}

// ==========================================
// UNIDADES DE MEDIDA
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn listar_unidades(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/unidades-basicas", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(json.as_array().unwrap().len() >= 6); // 6 del seed
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_unidad(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/unidades-basicas",
        &token,
        serde_json::json!({ "nombre": "microlitro", "nombre_plural": "microlitros" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["nombre"], "microlitro");
}

#[sqlx::test(migrations = "./migrations")]
async fn eliminar_unidad_con_productos_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;

    // Crear un producto que use la unidad "unidad" (id=1)
    let unidad_id: i32 =
        sqlx::query_scalar("SELECT id FROM unidades_basicas WHERE nombre = 'unidad'")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query("INSERT INTO productos (codigo_interno, nombre, unidad_base_id) VALUES ('PRD-99999', 'Test Prod', $1)")
        .bind(unidad_id)
        .execute(&pool)
        .await
        .unwrap();

    let app = common::test_app(pool);
    let (status, _) = common::delete_req(
        &app,
        &format!("/api/v1/unidades-basicas/{}", unidad_id),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

// ==========================================
// ÁREAS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn listar_areas(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/areas", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 12); // 12 del seed
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_area(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/areas",
        &token,
        serde_json::json!({ "nombre": "Laboratorio Nuevo", "es_bodega": false }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["nombre"], "Laboratorio Nuevo");
    assert_eq!(json["es_bodega"], false);
}

// ==========================================
// PROVEEDORES
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn crud_proveedor(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    // Crear
    let (status, json) = common::post_json(
        &app,
        "/api/v1/proveedores",
        &token,
        serde_json::json!({
            "nombre": "Merck Chile",
            "contacto": "Juan",
            "telefono": "+56912345678",
            "email": "ventas@merck.cl"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = json["id"].as_i64().unwrap();
    assert_eq!(json["version"], 1);

    // Listar
    let (status, json) = common::get_json(&app, "/api/v1/proveedores", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);

    // Actualizar con optimistic locking
    let (status, json) = common::put_json(
        &app,
        &format!("/api/v1/proveedores/{}", id),
        &token,
        serde_json::json!({
            "nombre": "Merck Chile S.A.",
            "version": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["version"], 2);
    assert_eq!(json["nombre"], "Merck Chile S.A.");

    // Actualizar con version incorrecta → 409
    let (status, _) = common::put_json(
        &app,
        &format!("/api/v1/proveedores/{}", id),
        &token,
        serde_json::json!({
            "nombre": "Otro nombre",
            "version": 1
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Soft delete
    let (status, _) =
        common::delete_req(&app, &format!("/api/v1/proveedores/{}", id), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Ya no aparece en listado
    let (_, json) = common::get_json(&app, "/api/v1/proveedores", &token).await;
    assert_eq!(json.as_array().unwrap().len(), 0);
}

// ==========================================
// USUARIOS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn crear_usuario(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::post_json(
        &app,
        "/api/v1/usuarios",
        &token,
        serde_json::json!({
            "nombre": "María López",
            "email": "maria@lab.cl",
            "password": "Password123!",
            "rol": "tecnologo",
            "area_ids": [1, 2, 3]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["nombre"], "María López");
    assert_eq!(json["rol"], "tecnologo");
    assert_eq!(json["areas"].as_array().unwrap().len(), 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_usuario_email_duplicado(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/usuarios",
        &token,
        serde_json::json!({
            "nombre": "Otro Admin",
            "email": common::TEST_ADMIN_EMAIL,
            "password": "Password123!",
            "rol": "admin",
            "area_ids": []
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
}

#[sqlx::test(migrations = "./migrations")]
async fn tecnologo_no_puede_crear_usuarios(pool: PgPool) {
    let token = common::create_tecnologo_token(&pool, &[1]).await;
    let app = common::test_app(pool);

    let (status, _) = common::post_json(
        &app,
        "/api/v1/usuarios",
        &token,
        serde_json::json!({
            "nombre": "Intento",
            "email": "intento@lab.cl",
            "password": "Password123!",
            "rol": "consulta",
            "area_ids": []
        }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

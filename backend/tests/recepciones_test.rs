mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Crea proveedor + producto (con proveedor) + obtiene presentacion_id.
/// Retorna (proveedor_id, producto_uuid, presentacion_id).
/// Usa area_id = 1 del seed (siempre disponible).
async fn setup_base(pool: &PgPool, token: &str, app: &axum::Router) -> (i32, Uuid, i32) {
    let (_, prov) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({ "nombre": format!("Prov-{}", &Uuid::new_v4().to_string()[..8]) }),
    )
    .await;
    let proveedor_id = prov["id"].as_i64().unwrap() as i32;

    let (_, prod) = common::post_json(
        app,
        "/api/v1/productos",
        token,
        serde_json::json!({
            "nombre": format!("Prod-{}", &Uuid::new_v4().to_string()[..8]),
            "unidad_base_id": 1,
            "proveedor_id": proveedor_id,
            "stock_minimo": 10,
            "presentaciones": [{ "nombre": "Unidad", "nombre_plural": "Unidades", "factor_conversion": 1 }]
        }),
    )
    .await;
    let producto_id: Uuid = prod["id"].as_str().unwrap().parse().unwrap();

    let presentacion_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_id)
            .fetch_one(pool)
            .await
            .unwrap();

    sqlx::query("UPDATE presentaciones SET proveedor_id = $1 WHERE id = $2")
        .bind(proveedor_id)
        .bind(presentacion_id)
        .execute(pool)
        .await
        .unwrap();

    (proveedor_id, producto_id, presentacion_id)
}

/// Construye el payload JSON para crear una recepción.
fn payload_recepcion(
    proveedor_id: i32,
    producto_id: Uuid,
    presentacion_id: i32,
    area_id: i32,
    estado: &str,
    cantidad: f64,
) -> serde_json::Value {
    serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": estado,
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "numero_lote": format!("REC-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
            "fecha_vencimiento": "2028-06-30",
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": cantidad,
            "area_destino_id": area_id,
        }]
    })
}

/// Retorna el stock total del producto en el área (suma de todos los lotes).
async fn stock_del_producto(
    pool: &PgPool,
    producto_id: Uuid,
    area_id: i32,
) -> rust_decimal::Decimal {
    sqlx::query_scalar::<_, Option<rust_decimal::Decimal>>(
        "SELECT SUM(s.cantidad) FROM stock s
         JOIN lotes l ON l.id = s.lote_id
         WHERE l.producto_id = $1 AND s.area_id = $2",
    )
    .bind(producto_id)
    .bind(area_id)
    .fetch_one(pool)
    .await
    .unwrap()
    .unwrap_or(rust_decimal::Decimal::ZERO)
}

// ─── Grupo 1: CRUD básico ───────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn listar_recepciones(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    let idem = Uuid::new_v4().to_string();
    common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "completa",
            10.0,
        ),
        &idem,
    )
    .await;

    let (status, json) = common::get_json(&app, "/api/v1/recepciones", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(!items.is_empty());
    assert!(json["total"].as_i64().unwrap() >= 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn obtener_recepcion_por_id(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    let idem = Uuid::new_v4().to_string();
    let (_, created) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "completa",
            10.0,
        ),
        &idem,
    )
    .await;
    let id = created["id"].as_str().unwrap();

    let (status, json) =
        common::get_json(&app, &format!("/api/v1/recepciones/{}", id), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["recepcion"]["estado"], "completa");
    assert!(!json["detalle"].as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_sin_token_retorna_401(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let req = axum::http::Request::builder()
        .method(axum::http::Method::POST)
        .uri("/api/v1/recepciones")
        .header("Content-Type", "application/json")
        .header("X-Idempotency-Key", Uuid::new_v4().to_string())
        .body(axum::body::Body::from(
            serde_json::to_string(&payload_recepcion(
                proveedor_id,
                producto_id,
                presentacion_id,
                1,
                "completa",
                5.0,
            ))
            .unwrap(),
        ))
        .unwrap();

    use tower::ServiceExt;
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn consulta_no_puede_crear_recepcion(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    // Crear usuario con rol consulta
    let config = common::test_config();
    let password_hash = common::hash_test_password("TestConsultaFixture123!");
    let consulta_id: Uuid = sqlx::query_scalar(
        "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Consulta', 'consulta@test.cl', $1, 'consulta') RETURNING id"
    )
    .bind(password_hash)
    .fetch_one(&pool)
    .await
    .unwrap();
    let consulta_token = inventario_lab_backend::auth::jwt::create_access_token(
        consulta_id,
        "consulta",
        vec![],
        &config,
    )
    .unwrap();

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &consulta_token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "completa",
            5.0,
        ),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ─── Grupo 2: Flujo borrador (nuevos endpoints) ────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn confirmar_borrador_impacta_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    // Crear borrador
    let (status, json) = common::post_json(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "borrador",
            30.0,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let recepcion_id = json["id"].as_str().unwrap();

    // Stock debe ser 0 antes de confirmar
    let stock_antes = stock_del_producto(&pool, producto_id, 1).await;
    assert_eq!(stock_antes, rust_decimal::Decimal::ZERO);

    // Confirmar
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/recepciones/{}/confirmar", recepcion_id),
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Stock debe ser 30 tras confirmar
    let stock_despues = stock_del_producto(&pool, producto_id, 1).await;
    assert_eq!(stock_despues.to_string(), "30.00");

    // Estado debe ser "completa"
    let estado: String = sqlx::query_scalar("SELECT estado FROM recepciones WHERE id = $1")
        .bind(recepcion_id.parse::<Uuid>().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(estado, "completa");
}

#[sqlx::test(migrations = "./migrations")]
async fn confirmar_recepcion_no_borrador_retorna_409(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let idem = Uuid::new_v4().to_string();
    let (_, json) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "completa",
            10.0,
        ),
        &idem,
    )
    .await;
    let id = json["id"].as_str().unwrap();

    // Intentar confirmar una recepción que ya es "completa"
    let (status, json) = common::post_json(
        &app,
        &format!("/api/v1/recepciones/{}/confirmar", id),
        &token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(json["code"], "ESTADO_INVALIDO");
}

#[sqlx::test(migrations = "./migrations")]
async fn eliminar_borrador_retorna_204(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let (_, json) = common::post_json(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "borrador",
            10.0,
        ),
    )
    .await;
    let id = json["id"].as_str().unwrap();

    let (status, _) =
        common::delete_req(&app, &format!("/api/v1/recepciones/{}", id), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Ya no debe existir
    let existe: Option<Uuid> = sqlx::query_scalar("SELECT id FROM recepciones WHERE id = $1")
        .bind(id.parse::<Uuid>().unwrap())
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(existe.is_none());
}

#[sqlx::test(migrations = "./migrations")]
async fn eliminar_recepcion_confirmada_retorna_409(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let idem = Uuid::new_v4().to_string();
    let (_, json) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion(
            proveedor_id,
            producto_id,
            presentacion_id,
            1,
            "completa",
            5.0,
        ),
        &idem,
    )
    .await;
    let id = json["id"].as_str().unwrap();

    let (status, json) =
        common::delete_req(&app, &format!("/api/v1/recepciones/{}", id), &token).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(json["code"], "ESTADO_INVALIDO");
}

// ─── Grupo 3: Idempotencia ──────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn mismo_idempotency_key_no_duplica_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let idem = Uuid::new_v4().to_string();
    let body = payload_recepcion(
        proveedor_id,
        producto_id,
        presentacion_id,
        1,
        "completa",
        20.0,
    );

    let (s1, _) =
        common::post_json_idempotent(&app, "/api/v1/recepciones", &token, body.clone(), &idem)
            .await;
    let (s2, _) =
        common::post_json_idempotent(&app, "/api/v1/recepciones", &token, body.clone(), &idem)
            .await;

    assert_eq!(s1, StatusCode::CREATED);
    assert_eq!(s2, StatusCode::CREATED);

    // Stock debe ser 20, no 40
    let stock = stock_del_producto(&pool, producto_id, 1).await;
    assert_eq!(stock.to_string(), "20.00");

    // Una sola recepción en DB
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recepciones WHERE proveedor_id = $1")
        .bind(proveedor_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

// ─── Grupo 4: Reconciliación con solicitud ──────────────────────────────────

/// Crea una solicitud con el producto dado y la guarda (estado "guardada").
/// Retorna el solicitud_id.
async fn setup_solicitud_guardada(pool: &PgPool, producto_id: Uuid, app: &axum::Router) -> Uuid {
    let tec_token = common::create_tecnologo_token(pool, &[1]).await;

    let (_, sol) = common::post_json(
        app,
        "/api/v1/solicitudes-compra",
        &tec_token,
        serde_json::json!({
            "items": [{ "producto_id": producto_id, "cantidad_sugerida": 20, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let sol_id = sol["id"].as_str().unwrap().to_string();

    common::post_json(
        app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", sol_id),
        &tec_token,
        serde_json::json!({}),
    )
    .await;

    sol_id.parse().unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn recepcion_completa_cierra_solicitud(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let sol_id = setup_solicitud_guardada(&pool, producto_id, &app).await;

    // Recepción que cubre todo lo solicitado (20 unidades)
    let idem = Uuid::new_v4().to_string();
    let mut body = payload_recepcion(
        proveedor_id,
        producto_id,
        presentacion_id,
        1,
        "completa",
        20.0,
    );
    body["solicitud_id"] = serde_json::json!(sol_id);

    let (status, _) =
        common::post_json_idempotent(&app, "/api/v1/recepciones", &token, body, &idem).await;
    assert_eq!(status, StatusCode::CREATED);

    let estado: String = sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1")
        .bind(sol_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(estado, "completada");
}

#[sqlx::test(migrations = "./migrations")]
async fn recepcion_parcial_deja_solicitud_parcialmente_recibida(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let sol_id = setup_solicitud_guardada(&pool, producto_id, &app).await;

    // Recepción con solo 5 de los 20 solicitados
    let idem = Uuid::new_v4().to_string();
    let mut body = payload_recepcion(
        proveedor_id,
        producto_id,
        presentacion_id,
        1,
        "completa",
        5.0,
    );
    body["solicitud_id"] = serde_json::json!(sol_id);

    let (status, _) =
        common::post_json_idempotent(&app, "/api/v1/recepciones", &token, body, &idem).await;
    assert_eq!(status, StatusCode::CREATED);

    let estado: String = sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1")
        .bind(sol_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(estado, "parcialmente_recibida");
}

// ─── Grupo 5: Validaciones ──────────────────────────────────────────────────

#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_estado_invalido_retorna_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let mut body = payload_recepcion(
        proveedor_id,
        producto_id,
        presentacion_id,
        1,
        "completa",
        5.0,
    );
    body["estado"] = serde_json::json!("estado_inexistente");

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

// ─── Grupo 6: control_lote en recepción ──────────────────────────────────────

/// control_lote = 'trazable' → número de lote OBLIGATORIO. Omitirlo es error.
#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_trazable_sin_lote_retorna_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    sqlx::query("UPDATE productos SET control_lote = 'trazable' WHERE id = $1")
        .bind(producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let body = serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "fecha_vencimiento": "2028-06-30",
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": 5.0,
            "area_destino_id": 1,
        }]
    });

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// control_lote = 'trazable' → fecha de vencimiento OBLIGATORIA. Omitirla es error.
#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_trazable_sin_vto_retorna_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    sqlx::query("UPDATE productos SET control_lote = 'trazable' WHERE id = $1")
        .bind(producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let body = serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "numero_lote": "TRZ-001",
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": 5.0,
            "area_destino_id": 1,
        }]
    });

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// control_lote = 'simple' → el usuario NO carga lote ni vencimiento. La recepción
/// crea un lote implícito (numero_lote sentinela 'IMPL-...', vencimiento NULL) y
/// aplica el stock igual.
#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_simple_sin_lote_ni_vto_ok(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    sqlx::query("UPDATE productos SET control_lote = 'simple' WHERE id = $1")
        .bind(producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let body = serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": 7.0,
            "area_destino_id": 1,
        }]
    });

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "el simple sin lote debe crearse"
    );

    // Stock aplicado.
    let stock = stock_del_producto(&pool, producto_id, 1).await;
    assert!(
        stock > rust_decimal::Decimal::ZERO,
        "el stock del simple se aplica"
    );

    // Lote implícito: sentinela 'IMPL-' y sin vencimiento.
    let (numero_lote, fv): (String, Option<chrono::NaiveDate>) =
        sqlx::query_as("SELECT numero_lote, fecha_vencimiento FROM lotes WHERE producto_id = $1")
            .bind(producto_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(fv.is_none(), "lote simple sin vencimiento");
    assert!(
        numero_lote.starts_with("IMPL-"),
        "lote implícito con sentinela, got {}",
        numero_lote
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn crear_recepcion_completa_sin_detalle_retorna_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (proveedor_id, _, _) = setup_base(&pool, &token, &app).await;

    let body = serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": []
    });

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

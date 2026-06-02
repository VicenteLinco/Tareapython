mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// Helper: crea un producto, proveedor, presentación, y hace una recepción para tener stock
async fn setup_stock(
    pool: &PgPool,
    token: &str,
    app: &axum::Router,
    area_id: i32,
    cantidad: f64,
) -> (Uuid, String) {
    // Crear proveedor
    let (_, prov_json) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({
            "nombre": "Proveedor Test"
        }),
    )
    .await;
    let proveedor_id = prov_json["id"].as_i64().unwrap();

    // Crear producto
    let (_, prod_json) = common::post_json(
        app,
        "/api/v1/productos",
        token,
        serde_json::json!({
            "nombre": format!("Producto Test {}", Uuid::new_v4()),
            "unidad_base_id": 1,
            "stock_minimo": 100,
            "presentaciones": [
                { "nombre": "Unitario", "nombre_plural": "Unitarios", "factor_conversion": 1 }
            ]
        }),
    )
    .await;
    let producto_id = prod_json["id"].as_str().unwrap().to_string();
    let producto_uuid: Uuid = producto_id.parse().unwrap();

    // Obtener presentación
    let pres_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_uuid)
            .fetch_one(pool)
            .await
            .unwrap();

    // Crear recepción para generar stock
    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        app,
        "/api/v1/recepciones",
        token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("LOT-TEST-{}", Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2027-06-15",
                "presentacion_id": pres_id,
                "cantidad_presentaciones": cantidad,
                "area_destino_id": area_id,
            }]
        }),
        &idem_key,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Recepción debería crear stock");

    (producto_uuid, producto_id)
}

// ==========================================
// RECEPCIONES
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn recepcion_completa_genera_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (producto_uuid, _) = setup_stock(&pool, &token, &app, 1, 100.0).await;

    // Verificar stock
    let stock: Option<rust_decimal::Decimal> = sqlx::query_scalar(
        r#"SELECT SUM(s.cantidad) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1 AND s.area_id = 1"#,
    )
    .bind(producto_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(stock.unwrap().to_string(), "100.00");

    // Verificar movimiento INGRESO
    let mov_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM movimientos m JOIN lotes l ON l.id = m.lote_id WHERE l.producto_id = $1 AND m.tipo = 'INGRESO'",
    )
    .bind(producto_uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(mov_count.0, 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn recepcion_borrador_no_genera_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Crear proveedor y producto
    let (_, prov) = common::post_json(
        &app,
        "/api/v1/proveedores",
        &token,
        serde_json::json!({"nombre": "Prov Draft"}),
    )
    .await;
    let (_, prod) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Prod Draft",
            "unidad_base_id": 1,
            "presentaciones": [{"nombre": "U", "nombre_plural": "Us", "factor_conversion": 1}]
        }),
    )
    .await;
    let prod_id = prod["id"].as_str().unwrap();
    let pres_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(prod_id.parse::<Uuid>().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();

    // Crear recepción como borrador (no necesita idempotency)
    let (status, json) = common::post_json(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": prov["id"].as_i64().unwrap(),
            "estado": "borrador",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": prod_id,
                "numero_lote": "DRAFT-LOT",
                "fecha_vencimiento": "2027-06-15",
                "presentacion_id": pres_id,
                "cantidad_presentaciones": 50,
                "area_destino_id": 1,
            }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["estado"], "borrador");

    // No debería haber stock
    let stock: Option<rust_decimal::Decimal> = sqlx::query_scalar(
        "SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = $1",
    )
    .bind(prod_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(stock.is_none() || stock.unwrap() == rust_decimal::Decimal::ZERO);
}

// ==========================================
// CONSUMOS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn consumo_individual_fefo(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 200.0).await;

    // Consumir 50
    let idem_key = Uuid::new_v4().to_string();
    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 50,
            "unidad": "base",
            "nota": "Test consumo"
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(json["grupo_movimiento"].is_string());
    // Decimal se serializa como string
    assert_eq!(json["stock_restante_area"].as_str().unwrap(), "150.00");
    assert_eq!(json["movimientos"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrations = "./migrations")]
async fn consumo_stock_insuficiente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 30.0).await;

    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 50,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn consumo_idempotente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 200.0).await;

    let idem_key = Uuid::new_v4().to_string();
    let body = serde_json::json!({
        "producto_id": producto_id,
        "area_id": 1,
        "cantidad": 50,
        "unidad": "base",
    });

    // Primera vez
    let (s1, j1) =
        common::post_json_idempotent(&app, "/api/v1/consumos", &token, body.clone(), &idem_key)
            .await;
    assert_eq!(s1, StatusCode::CREATED);

    // Segunda vez con misma key → misma respuesta, no se descuenta más
    let (s2, j2) =
        common::post_json_idempotent(&app, "/api/v1/consumos", &token, body, &idem_key).await;
    assert_eq!(s2, StatusCode::CREATED);
    assert_eq!(j1["grupo_movimiento"], j2["grupo_movimiento"]);

    // Verificar que solo se descontó una vez
    let (stock,): (Option<rust_decimal::Decimal>,) = sqlx::query_as(
        r#"SELECT SUM(s.cantidad) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1 AND s.area_id = 1"#,
    )
    .bind(producto_id.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(stock.unwrap().to_string(), "150.00");
}

#[sqlx::test(migrations = "./migrations")]
async fn consumo_batch(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, prod_id_1) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    let (_, prod_id_2) = setup_stock(&pool, &token, &app, 1, 200.0).await;

    let idem_key = Uuid::new_v4().to_string();
    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos/batch",
        &token,
        serde_json::json!({
            "area_id": 1,
            "items": [
                { "producto_id": prod_id_1, "cantidad": 30, "unidad": "base" },
                { "producto_id": prod_id_2, "cantidad": 50, "unidad": "base" },
            ],
            "nota": "Batch test"
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(json["movimientos_generados"].as_u64().unwrap() >= 2);
    assert_eq!(json["resumen"].as_array().unwrap().len(), 2);
}

#[sqlx::test(migrations = "./migrations")]
async fn consumo_batch_rollback_si_un_item_falla(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, prod_id_1) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    let (_, prod_id_2) = setup_stock(&pool, &token, &app, 1, 10.0).await; // solo 10

    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos/batch",
        &token,
        serde_json::json!({
            "area_id": 1,
            "items": [
                { "producto_id": prod_id_1, "cantidad": 30, "unidad": "base" },
                { "producto_id": prod_id_2, "cantidad": 50, "unidad": "base" }, // insuficiente
            ],
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Verificar que el primer producto NO se descontó (rollback total)
    let (stock,): (Option<rust_decimal::Decimal>,) = sqlx::query_as(
        r#"SELECT SUM(s.cantidad) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1 AND s.area_id = 1"#,
    )
    .bind(prod_id_1.parse::<Uuid>().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(stock.unwrap().to_string(), "100.00"); // sin cambios
}

// ==========================================
// DESCARTES
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn descarte_vencido(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (producto_uuid, _) = setup_stock(&pool, &token, &app, 1, 100.0).await;

    // Obtener lote_id
    let lote_id: Uuid =
        sqlx::query_scalar("SELECT l.id FROM lotes l WHERE l.producto_id = $1 LIMIT 1")
            .bind(producto_uuid)
            .fetch_one(&pool)
            .await
            .unwrap();

    let idem_key = Uuid::new_v4().to_string();
    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/descartes",
        &token,
        serde_json::json!({
            "items": [{
                "lote_id": lote_id,
                "area_id": 1,
                "cantidad": 40,
                "tipo": "DESCARTE_VENCIDO",
                "nota": "Lote vencido"
            }]
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(json["grupo_movimiento"].is_string());

    // Verificar stock (100 - 40 = 60)
    let (stock,): (Option<rust_decimal::Decimal>,) = sqlx::query_as(
        "SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = $1",
    )
    .bind(producto_uuid)
    .fetch_one(&pool)
    .await.unwrap();
    assert_eq!(stock.unwrap().to_string(), "60.00");
}

// ==========================================
// STOCK Y ALERTAS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn consultar_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    setup_stock(&pool, &token, &app, 1, 500.0).await;

    let (status, json) = common::get_json(&app, "/api/v1/stock?area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(!json["data"].as_array().unwrap().is_empty());
    assert!(
        json["resumen"]["total_productos_con_stock"]
            .as_i64()
            .unwrap()
            >= 1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn consultar_stock_por_area(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    setup_stock(&pool, &token, &app, 1, 300.0).await;

    let (status, json) = common::get_json(&app, "/api/v1/stock/area/1", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["area"]["id"], 1);
    assert!(!json["productos"].as_array().unwrap().is_empty());

    // Cada producto tiene lotes
    let producto = &json["productos"][0];
    assert!(!producto["lotes"].as_array().unwrap().is_empty());
}

#[sqlx::test(migrations = "./migrations")]
async fn alertas_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool);

    let (status, json) = common::get_json(&app, "/api/v1/stock/alertas", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(json["data"].is_array());
    assert!(json["total"].is_number());
    assert!(json["page"].is_number());
}

#[sqlx::test(migrations = "./migrations")]
async fn filtro_por_vencer_no_incluye_sin_stock(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (vence_uuid, vence_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    sqlx::query(
        "UPDATE lotes SET fecha_vencimiento = CURRENT_DATE + INTERVAL '10 days' WHERE producto_id = $1",
    )
    .bind(vence_uuid)
    .execute(&pool)
    .await
    .expect("debe marcar el lote como proximo a vencer");

    let (_, sin_stock_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": sin_stock_id,
            "area_id": 1,
            "cantidad": 100,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (vencido_uuid, vencido_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    sqlx::query(
        "UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - INTERVAL '1 day' WHERE producto_id = $1",
    )
    .bind(vencido_uuid)
    .execute(&pool)
    .await
    .expect("debe marcar el lote como vencido");

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?estado=vence_pronto&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items.iter().any(|i| i["producto_id"] == vence_id),
        "el filtro por vencer debe incluir el producto con lote vigente proximo a vencer: {json}"
    );
    assert!(
        !items.iter().any(|i| i["producto_id"] == sin_stock_id),
        "el filtro por vencer no debe incluir productos sin stock: {json}"
    );
    assert!(
        !items.iter().any(|i| i["producto_id"] == vencido_id),
        "el filtro por vencer no debe incluir productos vencidos: {json}"
    );

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?estado=vencido&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items.iter().any(|i| i["producto_id"] == vencido_id),
        "el filtro vencido debe incluir productos con lote positivo vencido: {json}"
    );
    assert!(
        !items.iter().any(|i| i["producto_id"] == vence_id),
        "el filtro vencido no debe incluir productos solo por vencer: {json}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn filtro_normal_excluye_alarmas_operativas(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, normal_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    let (_, bajo_id) = setup_stock(&pool, &token, &app, 1, 50.0).await;
    let (vencido_uuid, vencido_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    sqlx::query(
        "UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - INTERVAL '1 day' WHERE producto_id = $1",
    )
    .bind(vencido_uuid)
    .execute(&pool)
    .await
    .expect("debe marcar lote vencido");

    let (_, sin_stock_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": sin_stock_id,
            "area_id": 1,
            "cantidad": 100,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?estado=normal&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|i| i["producto_id"] == normal_id && i["estado_alerta"] == "normal"),
        "normal debe incluir productos con stock positivo, minimo cubierto y sin vencimiento cercano: {json}"
    );
    for excluded_id in [bajo_id, vencido_id, sin_stock_id] {
        assert!(
            !items.iter().any(|i| i["producto_id"] == excluded_id),
            "normal no debe incluir productos con alarmas operativas: {json}"
        );
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn filtro_sin_stock_incluye_agotados_sin_minimo(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (producto_uuid, producto_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    sqlx::query("UPDATE productos SET stock_minimo = 0 WHERE id = $1")
        .bind(producto_uuid)
        .execute(&pool)
        .await
        .expect("debe dejar el minimo en cero");

    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 100,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?estado=sin_stock&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items.iter().any(|i| i["producto_id"] == producto_id),
        "el filtro sin_stock debe incluir productos inicializados agotados aunque no tengan minimo: {json}"
    );

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?con_alertas=true&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items.iter().any(|i| i["producto_id"] == producto_id),
        "la vista de alertas del inventario debe incluir agotados inicializados igual que el dashboard: {json}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn filtro_sin_stock_incluye_stock_directo_en_cero(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let producto_id = Uuid::new_v4();
    let lote_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO productos
           (id, codigo_interno, nombre, categoria_id, unidad_base_id, stock_minimo, activo)
           VALUES ($1, 'ZERO-DIRECT-001', 'Producto directo en cero', 1, 1, 0, true)"#,
    )
    .bind(producto_id)
    .execute(&pool)
    .await
    .expect("debe crear producto");

    sqlx::query(
        r#"INSERT INTO lotes
           (id, producto_id, numero_lote, fecha_vencimiento, codigo_interno)
           VALUES ($1, $2, 'ZERO-DIRECT-LOT', CURRENT_DATE + INTERVAL '180 days', 'ZERO-DIRECT-LOT')"#,
    )
    .bind(lote_id)
    .bind(producto_id)
    .execute(&pool)
    .await
    .expect("debe crear lote");

    sqlx::query("INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 0)")
        .bind(lote_id)
        .execute(&pool)
        .await
        .expect("debe crear stock cero");

    let (status, json) =
        common::get_json(&app, "/api/v1/stock?estado=sin_stock&area_id=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let items = json["data"].as_array().unwrap();
    assert!(
        items
            .iter()
            .any(|i| i["producto_id"] == producto_id.to_string()),
        "el filtro sin_stock debe incluir productos con fila de stock en cero aunque no tengan movimientos: {json}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn producto_sin_historial_queda_pendiente_y_no_alerta_dashboard(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let producto_id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO productos
           (id, codigo_interno, nombre, categoria_id, unidad_base_id, stock_minimo, activo)
           VALUES ($1, 'SIN-STOCK-001', 'Producto sin stock test', 1, 1, 10, true)"#,
    )
    .bind(producto_id)
    .execute(&pool)
    .await
    .expect("debe crear producto sin stock");

    let (status, json) = common::get_json(&app, "/api/v1/stock/alertas?area_ids=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    let alertas = json["data"].as_array().unwrap();
    assert!(
        !alertas.iter().any(|a| {
            a["nombre"] == "Producto sin stock test" && a["tipo_alerta"] == "sin_stock"
        }),
        "el producto activo sin historial debe quedar fuera del dashboard: {json}"
    );

    let (status, json) = common::get_json(&app, "/api/v1/stock?per_page=1", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["total"], 0,
        "el producto pendiente no debe contar como insumo activo del dashboard: {json}"
    );

    let (status, json) = common::get_json(
        &app,
        "/api/v1/productos?q=Producto%20sin%20stock%20test",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let productos = json["data"].as_array().unwrap();
    assert!(
        productos.iter().any(|p| {
            p["nombre"] == "Producto sin stock test" && p["estado_stock"] == "pendiente_inicializar"
        }),
        "el creador de productos debe mostrar el estado pendiente_inicializar: {json}"
    );
}

// ==========================================
// MOVIMIENTOS
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn listar_movimientos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Crear stock y consumir para generar movimientos
    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;

    let idem_key = Uuid::new_v4().to_string();
    common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 10,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;

    let (status, json) = common::get_json(&app, "/api/v1/movimientos?tipo=salida", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(!json["data"].as_array().unwrap().is_empty());
    assert_eq!(json["data"][0]["tipo"], "salida");
}

// ==========================================
// LOTES
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn buscar_lote_por_codigo(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    setup_stock(&pool, &token, &app, 1, 100.0).await;

    // Obtener código interno del lote
    let codigo: String = sqlx::query_scalar("SELECT codigo_interno FROM lotes LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, json) = common::get_json(
        &app,
        &format!("/api/v1/lotes/buscar-codigo/{}", codigo),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["resultados"].as_array().unwrap().len(), 1);
    assert_eq!(json["resultados"][0]["tipo"], "lote_interno");
}

// ==========================================
// VALIDACIÓN DE ACCESO POR ÁREA
// ==========================================

#[sqlx::test(migrations = "./migrations")]
async fn tecnologo_sin_acceso_a_area_recibe_403(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;

    // Crear tecnólogo con acceso solo a área 2
    let tec_token = common::create_tecnologo_token(&pool, &[2]).await;

    // Intentar consumir en área 1 → 403
    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &tec_token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 10,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

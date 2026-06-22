mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Setup helpers ────────────────────────────────────────────────────────────

/// Creates provider + product with a presentacion (factor 10).
/// Returns (proveedor_id, producto_uuid, presentacion_id).
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
            "stock_minimo": 5,
            "presentaciones": [{
                "nombre": "Caja",
                "nombre_plural": "Cajas",
                "factor_conversion": 10
            }]
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

    (proveedor_id, producto_id, presentacion_id)
}

/// Creates a reception with 15 cajas (factor 10 = 150 base units) in area 1.
async fn create_reception_with_pres(
    pool: &PgPool,
    app: &axum::Router,
    token: &str,
    proveedor_id: i32,
    producto_id: Uuid,
    presentacion_id: i32,
) -> Uuid {
    let (_, json) = common::post_json_idempotent(
        app,
        "/api/v1/recepciones",
        token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("STK-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": presentacion_id,
                "cantidad_presentaciones": 15.0,
                "area_destino_id": 1,
            }]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;

    // Get lote_id
    let lote_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM lotes WHERE producto_id = $1 AND proveedor_id = $2 LIMIT 1",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .fetch_one(pool)
    .await
    .unwrap();

    let _ = json; // suppress unused warning
    lote_id
}

// ─── Phase 7 Tests: stock_por_area presentation equivalents ──────────────────

/// Scenario: stock_por_area returns presentacion_nombre and cantidad_presentaciones_equivalente
/// when a lot has presentacion_id set.
/// With 150 base units and factor_conversion = 10, expected equivalente = 15.00
#[sqlx::test(migrations = "./migrations")]
async fn test_stock_por_area_includes_presentacion_equivalente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    // Call stock_por_area for area 1
    let (status, json) = common::get_json(&app, "/api/v1/stock/area/1", &token).await;
    assert_eq!(status, StatusCode::OK, "Expected OK, got {:?}: {:?}", status, json);

    // Find our product in the response
    let productos = json["productos"].as_array().expect("expected productos array");
    let prod = productos
        .iter()
        .find(|p| p["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("product not found in stock_por_area response");

    let lotes = prod["lotes"].as_array().expect("expected lotes array");
    assert!(!lotes.is_empty(), "Expected at least one lote with stock");

    let lote = &lotes[0];

    // Check presentacion_nombre is populated
    let pres_nombre = lote["presentacion_nombre"].as_str();
    assert!(
        pres_nombre.is_some(),
        "Expected presentacion_nombre to be set, got null"
    );
    assert_eq!(pres_nombre, Some("Caja"), "Expected presentacion_nombre = 'Caja'");

    // Check cantidad_presentaciones_equivalente = 150 / 10 = 15.00
    let equivalente = lote["cantidad_presentaciones_equivalente"].as_f64();
    assert!(
        equivalente.is_some(),
        "Expected cantidad_presentaciones_equivalente to be set, got null"
    );
    let eq_val = equivalente.unwrap();
    assert!(
        (eq_val - 15.0).abs() < 0.01,
        "Expected equivalente = 15.0, got {}",
        eq_val
    );

    // Check presentacion_factor = 10
    let factor = lote["presentacion_factor"].as_f64();
    assert!(factor.is_some(), "Expected presentacion_factor to be set");
    let factor_val = factor.unwrap();
    assert!(
        (factor_val - 10.0).abs() < 0.01,
        "Expected presentacion_factor = 10.0, got {}",
        factor_val
    );
}

/// Scenario: When a lot has no presentacion_id, the presentation fields are null.
#[sqlx::test(migrations = "./migrations")]
async fn test_stock_por_area_lote_without_presentacion_returns_null_equivalente(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, _presentacion_id) = setup_base(&pool, &token, &app).await;

    // Create reception WITHOUT presentacion_id
    common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("NULL-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": null,
                "cantidad_presentaciones": 50.0,
                "area_destino_id": 1,
            }]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock/area/1", &token).await;
    assert_eq!(status, StatusCode::OK);

    let productos = json["productos"].as_array().expect("expected productos array");
    let prod = productos
        .iter()
        .find(|p| p["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("product not found in stock_por_area response");

    let lotes = prod["lotes"].as_array().expect("expected lotes array");
    assert!(!lotes.is_empty());

    let lote = &lotes[0];

    // All three fields should be null when no presentation is linked
    assert!(
        lote["presentacion_nombre"].is_null(),
        "Expected presentacion_nombre = null, got {:?}",
        lote["presentacion_nombre"]
    );
    assert!(
        lote["cantidad_presentaciones_equivalente"].is_null(),
        "Expected cantidad_presentaciones_equivalente = null, got {:?}",
        lote["cantidad_presentaciones_equivalente"]
    );
    assert!(
        lote["presentacion_factor"].is_null(),
        "Expected presentacion_factor = null, got {:?}",
        lote["presentacion_factor"]
    );
}

// ─── Characterization tests: contrato actual de los endpoints sin cobertura ──
// Estos tests fijan la forma de la respuesta ANTES de mover el SQL a
// `stock_service`. Si el refactor es fiel, siguen pasando sin cambios.

/// Lee un valor numérico tolerando que `rust_decimal` se serialice como string
/// JSON (ej. `"150.0000"`) o como número.
fn json_num(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.0)
}

/// GET /api/v1/stock — la lista principal devuelve el envelope esperado y el
/// resumen agregado, e incluye un producto que acaba de recibir stock.
#[sqlx::test(migrations = "./migrations")]
async fn test_listar_stock_envelope_y_resumen(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    // Envelope de paginación
    assert!(json["data"].is_array(), "data debe ser array");
    assert!(json["total"].is_number(), "total debe ser número");
    assert!(json["page"].is_number(), "page debe ser número");
    assert!(json["per_page"].is_number(), "per_page debe ser número");
    assert!(json["total_pages"].is_number(), "total_pages debe ser número");

    // Resumen agregado con las tres claves del contrato
    let resumen = &json["resumen"];
    assert!(resumen["total_productos_con_stock"].is_number());
    assert!(resumen["productos_bajo_minimo"].is_number());
    assert!(resumen["productos_por_vencer_90d"].is_number());
    assert!(
        resumen["total_productos_con_stock"].as_i64().unwrap() >= 1,
        "el producto recién recibido debe contar como con stock"
    );

    // El producto recibido aparece en la lista
    let data = json["data"].as_array().unwrap();
    let found = data
        .iter()
        .find(|r| r["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("el producto con stock debe aparecer en /stock");
    assert!(json_num(&found["stock_total"]) > 0.0);
    assert!(found["estado_alerta"].is_string());
}

/// Modelo de dos ejes ortogonales (migration 002): un producto cuyo ÚNICO stock
/// está vencido debe reportar estado_cantidad='agotado' (no hay usable que comprar)
/// Y estado_vencimiento='vencido' (hay físico que descartar) AL MISMO TIEMPO.
/// Antes el enum único en cascada sólo mostraba 'vencido' y ocultaba el 'agotado'.
/// Además el titular deja de "marcar 1": stock_usable=0, lo vencido va aparte.
#[sqlx::test(migrations = "./migrations")]
async fn test_dos_ejes_solo_vencido_es_agotado_y_vencido(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    let lote_id =
        create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
            .await;

    // Vencer el lote: sus 150 u. pasan a ser físico-vencido (0 usable).
    sqlx::query("UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - 5 WHERE id = $1")
        .bind(lote_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, json) = common::get_json(&app, "/api/v1/stock?con_alertas=true", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    let data = json["data"].as_array().unwrap();
    let found = data
        .iter()
        .find(|r| r["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("el producto sólo-vencido debe aparecer en /stock");

    // Dos ejes ortogonales: ambos hechos visibles a la vez, sin pisarse.
    assert_eq!(
        found["estado_cantidad"].as_str(),
        Some("agotado"),
        "sin stock usable → eje cantidad = agotado"
    );
    assert_eq!(
        found["estado_vencimiento"].as_str(),
        Some("vencido"),
        "hay stock físico vencido → eje vencimiento = vencido"
    );
    // El titular ya no "marca 1": usable = 0, lo vencido se informa aparte.
    assert_eq!(json_num(&found["stock_usable"]), 0.0, "usable debe ser 0");
    assert!(
        json_num(&found["stock_vencido"]) >= 150.0 - 0.5,
        "el stock vencido (150 u.) se reporta aparte, got {}",
        json_num(&found["stock_vencido"])
    );
}

/// Los filtros de la lista de Stock van por los dos ejes: un producto vencido+agotado
/// debe aparecer tanto bajo el filtro "agotado" como bajo "vencido" (antes, con el
/// enum único, sólo salía en uno).
#[sqlx::test(migrations = "./migrations")]
async fn test_filtros_dos_ejes_vencido_agotado_aparece_en_ambos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;
    sqlx::query("UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - 2 WHERE producto_id = $1")
        .bind(producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let aparece = |json: &serde_json::Value| -> bool {
        json["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["producto_id"].as_str() == Some(&producto_id.to_string()))
    };

    // Filtro "agotado" (sin_stock) → aparece (0 usable).
    let (s1, j1) = common::get_json(&app, "/api/v1/stock?estado=sin_stock", &token).await;
    assert_eq!(s1, StatusCode::OK);
    assert!(aparece(&j1), "el ítem debe aparecer bajo el filtro 'agotado'");

    // Filtro "vencido" → aparece el MISMO ítem.
    let (s2, j2) = common::get_json(&app, "/api/v1/stock?estado=vencidos", &token).await;
    assert_eq!(s2, StatusCode::OK);
    assert!(aparece(&j2), "el MISMO ítem debe aparecer bajo el filtro 'vencido'");
}

/// GET /api/v1/stock — valoriza cada producto por el costo real de sus lotes.
/// El costo del lote sale del precio de su recepción de origen (por presentación)
/// normalizado a unidad base: precio_unitario / factor_conversion_usado.
#[sqlx::test(migrations = "./migrations")]
async fn test_listar_valoriza_stock_por_costo_de_lote(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    // Recibe 15 cajas (factor 10 = 150 base) a $100 por CAJA.
    // costo base = 100 / 10 = $10 por unidad; valor = 150 × 10 = $1500.
    common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("VAL-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": presentacion_id,
                "cantidad_presentaciones": 15.0,
                "area_destino_id": 1,
                "precio_unitario": 100
            }]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    let data = json["data"].as_array().unwrap();
    let found = data
        .iter()
        .find(|r| r["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("producto con stock");

    let valor = json_num(&found["valor_stock"]);
    assert!(
        (valor - 1500.0).abs() < 0.5,
        "valor_stock esperado ~1500, got {}",
        valor
    );

    // El resumen agrega el valor total del inventario.
    let valor_total = json_num(&json["resumen"]["valor_total_inventario"]);
    assert!(
        valor_total >= 1500.0 - 0.5,
        "valor_total_inventario debe incluir el producto valorizado, got {}",
        valor_total
    );
}

/// Un lote SIN costo (recepción sin precio) cuenta como $0 y se informa cuántas
/// unidades del inventario no tienen costo cargado.
#[sqlx::test(migrations = "./migrations")]
async fn test_listar_stock_sin_costo_se_informa(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    // create_reception_with_pres NO manda precio → costo del lote nulo.
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock", &token).await;
    assert_eq!(status, StatusCode::OK);

    let data = json["data"].as_array().unwrap();
    let found = data
        .iter()
        .find(|r| r["producto_id"].as_str() == Some(&producto_id.to_string()))
        .expect("producto con stock");
    assert_eq!(json_num(&found["valor_stock"]), 0.0, "sin costo → valor 0");

    // 150 unidades sin costo cargado se reportan en el resumen.
    assert!(
        json_num(&json["resumen"]["unidades_sin_costo"]) >= 150.0 - 0.5,
        "el resumen debe informar las unidades sin costo"
    );
}

/// GET /api/v1/stock/alertas — devuelve el envelope de alertas con su resumen
/// por tipo. Tras una recepción limpia el endpoint responde OK y bien formado.
#[sqlx::test(migrations = "./migrations")]
async fn test_alertas_envelope_y_resumen(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock/alertas", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    assert!(json["data"].is_array(), "data debe ser array");
    assert!(json["total"].is_number());
    assert!(json["total_pages"].is_number());

    let resumen = &json["resumen"];
    assert!(resumen["sin_stock"].is_number());
    assert!(resumen["vencido"].is_number());
    assert!(resumen["bajo_minimo"].is_number());
    assert!(resumen["vencimiento"].is_number());
}

/// Bug #1 del dashboard: un producto vencido+agotado debe contar en AMBOS
/// contadores (sin_stock Y vencido), no sólo en vencido. Con el enum único en
/// cascada sólo sumaba en vencido; con los dos ejes suma en los dos a la vez.
#[sqlx::test(migrations = "./migrations")]
async fn test_alertas_vencido_agotado_cuenta_en_ambos_ejes(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    // Vencer todo el stock: 0 usable (agotado) + stock vencido (vencido).
    sqlx::query("UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - 3 WHERE producto_id = $1")
        .bind(producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, json) = common::get_json(&app, "/api/v1/stock/alertas", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    let resumen = &json["resumen"];
    assert!(
        resumen["vencido"].as_i64().unwrap() >= 1,
        "el producto vencido debe contar en 'vencido'"
    );
    assert!(
        resumen["sin_stock"].as_i64().unwrap() >= 1,
        "el MISMO producto (0 usable) debe contar también en 'sin_stock' (agotado) — bug #1"
    );
}

/// GET /api/v1/stock/lotes-vencidos — con una ventana de alerta amplia incluye
/// el lote recién recibido y devuelve los campos esperados por ítem.
#[sqlx::test(migrations = "./migrations")]
async fn test_lotes_vencidos_incluye_lote_en_ventana(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    let lote_id =
        create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
            .await;

    // dias_alerta amplio: el lote (vence 2028) cae dentro de la ventana
    let (status, json) =
        common::get_json(&app, "/api/v1/stock/lotes-vencidos?dias_alerta=3650", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    let items = json.as_array().expect("lotes-vencidos devuelve un array");
    let found = items
        .iter()
        .find(|r| r["lote_id"].as_str() == Some(&lote_id.to_string()))
        .expect("el lote recibido debe aparecer dentro de la ventana de alerta");
    assert_eq!(found["producto_id"].as_str(), Some(producto_id.to_string().as_str()));
    assert!(found["fecha_vencimiento"].is_string());
    assert!(found["area_nombre"].is_string());
    assert!(json_num(&found["cantidad"]) > 0.0);
    assert!(found["unidad_base_nombre"].is_string());
}

/// GET /api/v1/stock/balance-check — tras movimientos normales el ledger está
/// sano: el stock materializado coincide con la suma de movimientos.
#[sqlx::test(migrations = "./migrations")]
async fn test_balance_check_sano_tras_recepcion(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;
    create_reception_with_pres(&pool, &app, &token, proveedor_id, producto_id, presentacion_id)
        .await;

    let (status, json) = common::get_json(&app, "/api/v1/stock/balance-check", &token).await;
    assert_eq!(status, StatusCode::OK, "got {:?}: {:?}", status, json);

    assert_eq!(json["sano"].as_bool(), Some(true), "el ledger debe estar sano");
    assert_eq!(
        json["discrepancias"].as_array().map(|a| a.len()),
        Some(0),
        "sin discrepancias tras una recepción limpia"
    );
}

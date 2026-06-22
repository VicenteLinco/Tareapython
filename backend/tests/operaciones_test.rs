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

/// El FEFO de consumo NO debe ofrecer producto vencido: su única salida es el
/// descarte. Un producto cuyo único stock está vencido reporta 0 usable y el
/// consumo falla con stock insuficiente (no "marca 1 y deja consumir vencido").
#[sqlx::test(migrations = "./migrations")]
async fn consumo_excluye_lotes_vencidos(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 10.0).await;

    // Vencer todo el stock del producto: ya no hay nada usable que consumir.
    sqlx::query("UPDATE lotes SET fecha_vencimiento = CURRENT_DATE - 1 WHERE producto_id = $1::uuid")
        .bind(&producto_id)
        .execute(&pool)
        .await
        .unwrap();

    let idem_key = Uuid::new_v4().to_string();
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id,
            "area_id": 1,
            "cantidad": 1,
            "unidad": "base",
        }),
        &idem_key,
    )
    .await;

    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "consumir un producto sólo-vencido debe fallar: 0 usable, sale por descarte"
    );
}

// ─── Grupo control_lote: consumo trazable (lote exacto + aviso FEFO) y simple ───

/// Crea proveedor + producto + presentación SIN stock. Retorna
/// (proveedor_id, producto_uuid, producto_str, presentacion_id).
async fn setup_prod_sin_stock(
    pool: &PgPool,
    token: &str,
    app: &axum::Router,
) -> (i64, Uuid, String, i32) {
    let (_, prov) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({ "nombre": format!("Prov-{}", &Uuid::new_v4().to_string()[..8]) }),
    )
    .await;
    let proveedor_id = prov["id"].as_i64().unwrap();

    let (_, prod) = common::post_json(
        app,
        "/api/v1/productos",
        token,
        serde_json::json!({
            "nombre": format!("Prod-{}", Uuid::new_v4()),
            "unidad_base_id": 1,
            "stock_minimo": 100,
            "presentaciones": [{ "nombre": "Unitario", "nombre_plural": "Unitarios", "factor_conversion": 1 }]
        }),
    )
    .await;
    let producto_str = prod["id"].as_str().unwrap().to_string();
    let producto_uuid: Uuid = producto_str.parse().unwrap();
    let pres_id: i32 = sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
        .bind(producto_uuid)
        .fetch_one(pool)
        .await
        .unwrap();
    (proveedor_id, producto_uuid, producto_str, pres_id)
}

/// Recibe un lote concreto (numero + vencimiento opcional) y devuelve su lote_id.
async fn recibir_lote(
    pool: &PgPool,
    app: &axum::Router,
    token: &str,
    proveedor_id: i64,
    producto_str: &str,
    producto_uuid: Uuid,
    pres_id: i32,
    numero_lote: &str,
    fecha_venc: Option<&str>,
    cantidad: f64,
    area_id: i32,
) -> Uuid {
    let mut detalle = serde_json::json!({
        "producto_id": producto_str,
        "presentacion_id": pres_id,
        "cantidad_presentaciones": cantidad,
        "area_destino_id": area_id,
        "numero_lote": numero_lote,
    });
    if let Some(fv) = fecha_venc {
        detalle["fecha_vencimiento"] = serde_json::json!(fv);
    }
    let (status, json) = common::post_json_idempotent(
        app,
        "/api/v1/recepciones",
        token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [detalle]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "recepción del lote {numero_lote}");
    // El lote_id viene en la respuesta (para 'simple' el numero_lote es sentinela).
    let _ = (producto_uuid, pool);
    json["lotes"][0]["lote_id"]
        .as_str()
        .expect("lote_id en la respuesta")
        .parse()
        .unwrap()
}

async fn stock_de_lote(pool: &PgPool, lote_id: Uuid, area_id: i32) -> rust_decimal::Decimal {
    sqlx::query_scalar::<_, Option<rust_decimal::Decimal>>(
        "SELECT SUM(cantidad) FROM stock WHERE lote_id = $1 AND area_id = $2",
    )
    .bind(lote_id)
    .bind(area_id)
    .fetch_one(pool)
    .await
    .unwrap()
    .unwrap_or(rust_decimal::Decimal::ZERO)
}

/// control_lote = 'trazable' → el consumo EXIGE lote_id (el escaneado). Sin él, error.
#[sqlx::test(migrations = "./migrations")]
async fn consumo_trazable_sin_lote_id_retorna_422(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (prov, prod_uuid, prod_str, pres) = setup_prod_sin_stock(&pool, &token, &app).await;
    recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "TRZ-1", Some("2028-01-01"), 100.0, 1).await;
    sqlx::query("UPDATE productos SET control_lote = 'trazable' WHERE id = $1")
        .bind(prod_uuid).execute(&pool).await.unwrap();

    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({ "producto_id": prod_str, "area_id": 1, "cantidad": 5, "unidad": "base" }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Consumo trazable por lote_id descuenta EXACTAMENTE ese lote (no FEFO). Si el lote
/// elegido NO es el más próximo a vencer, la respuesta trae aviso_fefo + lote_sugerido,
/// pero el consumo se concreta igual.
#[sqlx::test(migrations = "./migrations")]
async fn consumo_trazable_lote_exacto_con_aviso_fefo(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (prov, prod_uuid, prod_str, pres) = setup_prod_sin_stock(&pool, &token, &app).await;
    // Lote A vence ANTES; Lote B vence DESPUÉS.
    let lote_a = recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "A", Some("2027-01-01"), 100.0, 1).await;
    let lote_b = recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "B", Some("2028-01-01"), 100.0, 1).await;
    sqlx::query("UPDATE productos SET control_lote = 'trazable' WHERE id = $1")
        .bind(prod_uuid).execute(&pool).await.unwrap();

    // Consumir 10 del lote B (el que vence después): trazabilidad manda.
    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({ "producto_id": prod_str, "area_id": 1, "cantidad": 10, "unidad": "base", "lote_id": lote_b }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "got {:?}", json);

    // Se descontó B, no A (no se cae al FEFO).
    assert_eq!(stock_de_lote(&pool, lote_b, 1).await.to_string(), "90.00", "B baja a 90");
    assert_eq!(stock_de_lote(&pool, lote_a, 1).await.to_string(), "100.00", "A intacto");

    // Aviso no bloqueante: A vence antes que B.
    assert_eq!(json["aviso_fefo"].as_bool(), Some(true), "debe avisar que A vence antes");
    assert_eq!(
        json["lote_sugerido"]["lote_id"].as_str(),
        Some(lote_a.to_string().as_str()),
        "el sugerido es el lote A"
    );
}

/// Consumir el lote que SÍ es el más próximo a vencer no genera aviso.
#[sqlx::test(migrations = "./migrations")]
async fn consumo_trazable_lote_mas_proximo_sin_aviso(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (prov, prod_uuid, prod_str, pres) = setup_prod_sin_stock(&pool, &token, &app).await;
    let lote_a = recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "A", Some("2027-01-01"), 100.0, 1).await;
    recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "B", Some("2028-01-01"), 100.0, 1).await;
    sqlx::query("UPDATE productos SET control_lote = 'trazable' WHERE id = $1")
        .bind(prod_uuid).execute(&pool).await.unwrap();

    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({ "producto_id": prod_str, "area_id": 1, "cantidad": 10, "unidad": "base", "lote_id": lote_a }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "got {:?}", json);
    assert_eq!(json["aviso_fefo"].as_bool(), Some(false), "A es el más próximo: sin aviso");
}

/// control_lote = 'simple' → consumo FEFO sin lote: los lotes implícitos (sin
/// vencimiento) se drenan en orden FIFO por created_at (el más antiguo primero).
#[sqlx::test(migrations = "./migrations")]
async fn consumo_simple_fifo_por_created_at(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let (prov, prod_uuid, prod_str, pres) = setup_prod_sin_stock(&pool, &token, &app).await;
    sqlx::query("UPDATE productos SET control_lote = 'simple' WHERE id = $1")
        .bind(prod_uuid).execute(&pool).await.unwrap();

    // Dos lotes implícitos (dos recepciones), ambos sin vencimiento.
    let lote_viejo = recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "IMPL-X", None, 50.0, 1).await;
    let lote_nuevo = recibir_lote(&pool, &app, &token, prov, &prod_str, prod_uuid, pres, "IMPL-Y", None, 50.0, 1).await;
    // Forzar que "viejo" sea inequívocamente más antiguo.
    sqlx::query("UPDATE lotes SET created_at = created_at - interval '1 day' WHERE id = $1")
        .bind(lote_viejo).execute(&pool).await.unwrap();

    // Consumir 30 → debe salir todo del lote más antiguo (FIFO).
    let (status, _) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({ "producto_id": prod_str, "area_id": 1, "cantidad": 30, "unidad": "base" }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(stock_de_lote(&pool, lote_viejo, 1).await.to_string(), "20.00", "el viejo se drena primero");
    assert_eq!(stock_de_lote(&pool, lote_nuevo, 1).await.to_string(), "50.00", "el nuevo queda intacto");
}

// ─── Prueba integral: matriz de estados, alarmas del dashboard y consumo de vacíos ───

async fn mz_set_par(pool: &PgPool, producto: Uuid, min: f64, max: Option<f64>) {
    let maxs = max.map(|m| m.to_string()).unwrap_or_else(|| "NULL".into());
    sqlx::query(&format!(
        "INSERT INTO par_level_config (producto_id, area_id, stock_minimo, stock_maximo, safety_stock, metodo) \
         VALUES ($1, 1, {min}, {maxs}, 0, 'manual')"
    ))
    .bind(producto)
    .execute(pool)
    .await
    .unwrap();
}

async fn mz_venc(pool: &PgPool, producto: Uuid, dias_offset: i64) {
    sqlx::query(&format!(
        "UPDATE lotes SET fecha_vencimiento = CURRENT_DATE + {dias_offset} WHERE producto_id = $1"
    ))
    .bind(producto)
    .execute(pool)
    .await
    .unwrap();
}

async fn mz_consumo_hist(pool: &PgPool, producto: Uuid, admin: Uuid, qty: i32, dias: i32) {
    let lote: Uuid =
        sqlx::query_scalar("SELECT id FROM lotes WHERE producto_id = $1 ORDER BY fecha_vencimiento NULLS LAST LIMIT 1")
            .bind(producto)
            .fetch_one(pool)
            .await
            .unwrap();
    sqlx::query(&format!(
        "INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at) \
         VALUES ($1, 1, 'CONSUMO', {qty}, 0, $2, NOW() - make_interval(days => $3))"
    ))
    .bind(lote)
    .bind(admin)
    .bind(dias)
    .execute(pool)
    .await
    .unwrap();
}

async fn mz_add_lote_vencido(pool: &PgPool, producto: Uuid, admin: Uuid, qty: i32) {
    let prov: i32 = sqlx::query_scalar("SELECT proveedor_id FROM lotes WHERE producto_id = $1 LIMIT 1")
        .bind(producto)
        .fetch_one(pool)
        .await
        .unwrap();
    let lote: Uuid = sqlx::query_scalar(
        "INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento) \
         VALUES ($1, $2, $3, CURRENT_DATE - 5) RETURNING id",
    )
    .bind(producto)
    .bind(prov)
    .bind(format!("VENC-{}", &Uuid::new_v4().to_string()[..6]))
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(&format!(
        "INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id) \
         VALUES ($1, 1, 'AJUSTE_POSITIVO', {qty}, 0, $2)"
    ))
    .bind(lote)
    .bind(admin)
    .execute(pool)
    .await
    .unwrap();
}

async fn mz_consume(app: &axum::Router, token: &str, producto_id: &str, qty: i64) -> StatusCode {
    let (status, _) = common::post_json_idempotent(
        app,
        "/api/v1/consumos",
        token,
        serde_json::json!({ "producto_id": producto_id, "area_id": 1, "cantidad": qty, "unidad": "base" }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    status
}

#[sqlx::test(migrations = "./migrations")]
async fn matriz_estados_dashboard_y_consumo_de_vacios(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let admin = common::get_admin_id(&pool).await;

    // ── Sembrar la matriz (estados deterministas vía min/max manual) ──
    // N — normal: stock sano + historia liviana, sin par.
    let (n_uuid, n_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    for d in [5, 3, 1] {
        mz_consumo_hist(&pool, n_uuid, admin, 1, d).await;
    }
    // SD — sin_datos: stock, sin historia, sin par.
    let (_sd, _sd_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    // AG — agotado: consumir todo.
    let (_ag, ag_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;
    assert_eq!(mz_consume(&app, &token, &ag_id, 100).await, StatusCode::CREATED);
    // SV — solo vencido (agotado + vencido).
    let (sv, sv_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    mz_venc(&pool, sv, -3).await;
    // MX — usable + un lote vencido aparte (normal/sin_datos + vencido).
    let (mx, mx_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    mz_add_lote_vencido(&pool, mx, admin, 10).await;
    // CR — critico: stock 5, mínimo manual 20 (5 <= 20*0.5).
    let (cr, _cr_id) = setup_stock(&pool, &token, &app, 1, 5.0).await;
    mz_set_par(&pool, cr, 20.0, None).await;
    // RP — reponer: stock 15, mínimo manual 20 (15 <= 20).
    let (rp, _rp_id) = setup_stock(&pool, &token, &app, 1, 15.0).await;
    mz_set_par(&pool, rp, 20.0, None).await;
    // EX — exceso: stock 150, máximo manual 10.
    let (ex, _ex_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    mz_set_par(&pool, ex, 5.0, Some(10.0)).await;
    // PV — por_vencer: vence en 60 días.
    let (pv, _pv_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    mz_venc(&pool, pv, 60).await;
    // RG — riesgo_venc: vence en 15 días.
    let (rg, _rg_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    mz_venc(&pool, rg, 15).await;

    // ── Dashboard real: /stock/alertas ──
    let (status, json) = common::get_json(&app, "/api/v1/stock/alertas", &token).await;
    assert_eq!(status, StatusCode::OK, "alertas: {json}");
    let r = &json["resumen"];
    eprintln!(
        "\n=== RESUMEN DASHBOARD ===\n sin_stock(agotado)={}  vencido={}  bajo_minimo={}  vencimiento={}\n",
        r["sin_stock"], r["vencido"], r["bajo_minimo"], r["vencimiento"]
    );

    // Conteos esperados por eje (cada producto cuenta en el/los eje(s) que le corresponde).
    assert_eq!(r["sin_stock"].as_i64().unwrap(), 2, "agotado: AG + SV");
    assert_eq!(r["vencido"].as_i64().unwrap(), 2, "vencido: SV + MX (ejes independientes)");
    assert_eq!(r["bajo_minimo"].as_i64().unwrap(), 2, "bajo: CR + RP");
    assert_eq!(r["vencimiento"].as_i64().unwrap(), 2, "por vencer/riesgo: PV + RG");

    // ── Filtros de la lista por los dos ejes ──
    let contiene = |json: &serde_json::Value, id: &str| -> bool {
        json["data"].as_array().unwrap().iter().any(|x| x["producto_id"].as_str() == Some(id))
    };
    let (_, agotados) = common::get_json(&app, "/api/v1/stock?estado=sin_stock", &token).await;
    assert!(contiene(&agotados, &sv_id), "SV debe salir bajo filtro 'agotado'");
    let (_, vencidos) = common::get_json(&app, "/api/v1/stock?estado=vencidos", &token).await;
    assert!(contiene(&vencidos, &sv_id), "SV debe salir bajo filtro 'vencido'");
    assert!(contiene(&vencidos, &mx_id), "MX (usable+vencido) debe salir bajo filtro 'vencido'");
    let (_, excesos) = common::get_json(&app, "/api/v1/stock?estado=exceso", &token).await;
    assert!(contiene(&excesos, &_ex_id), "EX debe salir bajo filtro 'exceso'");

    // ── Consumo de vacíos: NO se pueden consumir; los sanos sí ──
    assert_eq!(
        mz_consume(&app, &token, &ag_id, 1).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "AGOTADO (0 stock) no se puede consumir"
    );
    assert_eq!(
        mz_consume(&app, &token, &sv_id, 1).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "SOLO-VENCIDO no se puede consumir (FEFO excluye vencidos)"
    );
    assert_eq!(
        mz_consume(&app, &token, &n_id, 1).await,
        StatusCode::CREATED,
        "NORMAL (stock usable) sí se consume"
    );
    // MX: consume del lote usable y deja intacto el vencido.
    assert_eq!(mz_consume(&app, &token, &mx_id, 1).await, StatusCode::CREATED, "MX consume lo usable");
    let vencido_intacto: bool = sqlx::query_scalar(
        "SELECT COALESCE(SUM(s.cantidad), 0) = 10 FROM stock s JOIN lotes l ON l.id = s.lote_id \
         WHERE l.producto_id = $1 AND l.fecha_vencimiento < CURRENT_DATE",
    )
    .bind(mx)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        vencido_intacto,
        "el lote vencido de MX NO se tocó al consumir (sigue en 10, sale por descarte)"
    );

    eprintln!("=== OK: matriz, dashboard y consumo de vacíos verificados ===\n");
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

    let (normal_uuid, normal_id) = setup_stock(&pool, &token, &app, 1, 150.0).await;
    // El estado "normal" requiere historial de consumo (fn_estado_stock usa cobertura,
    // no un mínimo manual): sin consumo el producto queda en "sin_datos". Sembramos 3
    // días de consumo bajo en la última semana → cobertura amplia (≈stock/0.3 días) → normal.
    {
        let lote_id: Uuid =
            sqlx::query_scalar("SELECT id FROM lotes WHERE producto_id = $1 LIMIT 1")
                .bind(normal_uuid)
                .fetch_one(&pool)
                .await
                .unwrap();
        let admin_uid = common::get_admin_id(&pool).await;
        for dias in [5_i32, 3, 1] {
            // El trigger BEFORE INSERT recalcula cantidad_resultante y ajusta `stock`.
            sqlx::query(
                "INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, created_at) \
                 VALUES ($1, 1, 'CONSUMO', 1, 0, $2, NOW() - make_interval(days => $3))",
            )
            .bind(lote_id)
            .bind(admin_uid)
            .bind(dias)
            .execute(&pool)
            .await
            .expect("debe registrar consumo histórico");
        }
    }

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

    // El producto se crea sin par_level_config → sin stock mínimo manual, que es
    // justo lo que valida este caso ("agotados sin minimo"). El estado de alerta lo
    // determina fn_estado_stock por cobertura/inicialización, no un mínimo manual.
    let (_producto_uuid, producto_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;

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
           (id, codigo_interno, nombre, categoria_id, unidad_base_id, activo)
           VALUES ($1, 'ZERO-DIRECT-001', 'Producto directo en cero', 1, 1, true)"#,
    )
    .bind(producto_id)
    .execute(&pool)
    .await
    .expect("debe crear producto");

    sqlx::query(
        r#"INSERT INTO lotes
           (id, producto_id, numero_lote, fecha_vencimiento)
           VALUES ($1, $2, 'ZERO-DIRECT-LOT', CURRENT_DATE + INTERVAL '180 days')"#,
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
           (id, codigo_interno, nombre, categoria_id, unidad_base_id, activo)
           VALUES ($1, 'SIN-STOCK-001', 'Producto sin stock test', 1, 1, true)"#,
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

    // Obtener número de lote del lote
    let codigo: String = sqlx::query_scalar("SELECT numero_lote FROM lotes LIMIT 1")
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
    assert_eq!(json["resultados"][0]["tipo"], "lote_fabricante");
}

// ==========================================
// VALIDACIÓN DE ACCESO POR ÁREA
// ==========================================

/// Política actual del laboratorio: todos los tecnólogos pueden operar en cualquier
/// área. El filtro de área es de UI, no un control de acceso — el handler de stock
/// valida sólo el rol (`validar_puede_operar_stock`), no la membresía de área. Este
/// test documenta esa política como spec ejecutable: si alguien agrega control de
/// acceso por área en el futuro, esta aserción lo va a marcar.
#[sqlx::test(migrations = "./migrations")]
async fn tecnologo_puede_operar_en_cualquier_area(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (_, producto_id) = setup_stock(&pool, &token, &app, 1, 100.0).await;

    // Tecnólogo asignado sólo al área 2.
    let tec_token = common::create_tecnologo_token(&pool, &[2]).await;

    // Consumir en el área 1 está permitido (sin control de acceso por área).
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

    assert_eq!(status, StatusCode::CREATED);
}

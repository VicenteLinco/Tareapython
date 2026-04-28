mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

async fn setup_producto(
    _pool: &PgPool,
    token: &str,
    app: &axum::Router,
) -> Uuid {
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
    producto_id.parse().unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn flujo_completo_solicitud(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let tec_token = common::create_tecnologo_token(&pool, &[1]).await;

    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    // 1. Tecnologo crea solicitud
    let (status, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &tec_token,
        serde_json::json!({
            "items": [
                { "producto_id": prod_id, "cantidad_sugerida": 10, "unidad": "base" }
            ]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK); // El handler retorna OK con status: "success"
    let solicitud_id = res["id"].as_str().unwrap();

    // 2. Admin lista solicitudes
    let (status, res) = common::get_json(&app, "/api/v1/solicitudes-compra", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    let solicitudes = res["data"].as_array().unwrap();
    assert!(solicitudes.iter().any(|s| s["id"] == solicitud_id && s["estado"] == "pendiente"));

    // 3. Admin aprueba
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/revisar", solicitud_id),
        &admin_token,
        serde_json::json!({ "estado": "aprobada", "nota_revision": "Aprobado" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 4. Verificar estado final
    let (status, res) = common::get_json(&app, &format!("/api/v1/solicitudes-compra/{}", solicitud_id), &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["estado"], "aprobada");
}

#[sqlx::test(migrations = "./migrations")]
async fn no_admin_no_puede_revisar(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let tec_token = common::create_tecnologo_token(&pool, &[1]).await;

    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &tec_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad": "base" }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    // Tecnologo intenta revisar -> 403 Forbidden
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/revisar", solicitud_id),
        &tec_token,
        serde_json::json!({ "estado": "aprobada" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn no_se_puede_revisar_dos_veces(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad": "base" }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    // Aprobar primera vez
    common::post_json(&app, &format!("/api/v1/solicitudes-compra/{}/revisar", solicitud_id), &admin_token, serde_json::json!({"estado": "aprobada"})).await;

    // Intentar revisar de nuevo -> 422
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/revisar", solicitud_id),
        &admin_token,
        serde_json::json!({"estado": "rechazada"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = "./migrations")]
async fn rechazo_con_nota(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad": "base" }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/revisar", solicitud_id),
        &admin_token,
        serde_json::json!({ "estado": "rechazada", "nota_revision": "Stock suficiente" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, res) = common::get_json(&app, &format!("/api/v1/solicitudes-compra/{}", solicitud_id), &admin_token).await;
    assert_eq!(res["estado"], "rechazada");
    assert_eq!(res["nota_revision"], "Stock suficiente");
}

#[sqlx::test(migrations = "./migrations")]
async fn solicitud_vacia_creada_correctamente(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (status, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": []
        }),
    )
    .await;
    
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["status"], "success");
    
    let solicitud_id = res["id"].as_str().unwrap();
    let (_, res_get) = common::get_json(&app, &format!("/api/v1/solicitudes-compra/{}", solicitud_id), &admin_token).await;
    assert_eq!(res_get["items"].as_array().unwrap().len(), 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn recomendaciones_baja_confianza_no_extrapola(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear producto con stock_minimo y lead_time_propio
    let prod_id = setup_producto(&pool, &admin_token, &app).await;
    sqlx::query(
        "UPDATE productos SET stock_minimo = 50, lead_time_propio = 10 WHERE id = $1",
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Insertar lote
    let lote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lotes (producto_id, numero_lote, codigo_interno, fecha_vencimiento)
           VALUES ($1, $2, $3, (NOW() + INTERVAL '180 days')::date)
           RETURNING id"#,
    )
    .bind(prod_id)
    .bind(format!("LOT-TEST-{}", prod_id))
    .bind(format!("LOTC-{}", &prod_id.to_string()[..8]))
    .fetch_one(&pool)
    .await
    .unwrap();

    // Obtener usuario admin para los movimientos
    let usuario_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    // 3. INGRESO 300u hace 5 días (establece stock inicial)
    sqlx::query(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'INGRESO', 300, 300, $2, NOW() - INTERVAL '5 days')"#,
    )
    .bind(lote_id)
    .bind(usuario_id)
    .execute(&pool)
    .await
    .unwrap();

    // 4. CONSUMO 100u hace 4 días
    sqlx::query(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 100, 200, $2, NOW() - INTERVAL '4 days')"#,
    )
    .bind(lote_id)
    .bind(usuario_id)
    .execute(&pool)
    .await
    .unwrap();

    // 5. CONSUMO 1u hace 3 días
    sqlx::query(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 1, 199, $2, NOW() - INTERVAL '3 days')"#,
    )
    .bind(lote_id)
    .bind(usuario_id)
    .execute(&pool)
    .await
    .unwrap();

    // 6. CONSUMO 30u hoy
    sqlx::query(
        r#"INSERT INTO movimientos (lote_id, area_id, tipo, cantidad, cantidad_resultante,
                                    usuario_id, created_at)
           VALUES ($1, 1, 'CONSUMO', 30, 169, $2, NOW())"#,
    )
    .bind(lote_id)
    .bind(usuario_id)
    .execute(&pool)
    .await
    .unwrap();

    // 7. Llamar al endpoint de recomendaciones
    let (status, body) = common::get_json(
        &app,
        "/api/v1/solicitudes-compra/recomendaciones",
        &admin_token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 8. El producto con sólo 3 días de consumo (confianza baja) y stock 169 > mínimo 50
    //    NO debe aparecer en recomendaciones, o si aparece, debe tener cantidad < 100
    let items = body["data"].as_array().expect("data debe ser array");
    let nuestro = items.iter().find(|i| {
        i["producto_id"].as_str() == Some(&prod_id.to_string())
    });

    if let Some(item) = nuestro {
        let cant = item["cantidad_sugerida_base"].as_f64().unwrap_or(-1.0);
        assert!(
            cant < 100.0,
            "con confianza baja y stock suficiente, la sugerencia debe ser baja, fue {}",
            cant
        );
        assert_eq!(
            item["confianza"].as_str(),
            Some("baja"),
            "debe reportar confianza baja"
        );
    }
    // Si no aparece en la lista, también es correcto (sin urgencia)
}

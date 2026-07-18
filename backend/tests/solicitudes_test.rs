mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

async fn setup_producto(pool: &PgPool, token: &str, app: &axum::Router) -> Uuid {
    let (_, proveedor_json) = common::post_json(
        app,
        "/api/v1/proveedores",
        token,
        serde_json::json!({ "nombre": format!("Proveedor Test {}", Uuid::new_v4()) }),
    )
    .await;
    let proveedor_id = proveedor_json["id"].as_i64().unwrap();

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
    
    // Create oferta_proveedor
    let prod_uuid: Uuid = producto_id.parse().unwrap();
    let presentacion_id: i32 = sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
        .bind(prod_uuid)
        .fetch_one(pool)
        .await
        .unwrap();
        
    sqlx::query("INSERT INTO ofertas_proveedor (proveedor_id, presentacion_id, precio_adquisicion) VALUES ($1, $2, 50.0)")
        .bind(proveedor_id as i32)
        .bind(presentacion_id)
        .execute(pool)
        .await
        .unwrap();
        
    prod_uuid
}

#[sqlx::test(migrations = "./migrations")]
async fn flujo_completo_solicitud(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let tec_token = common::create_tecnologo_token(&pool, &[1]).await;

    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    // 1. Tecnologo crea solicitud como borrador
    let (status, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &tec_token,
        serde_json::json!({
            "items": [
                { "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }
            ]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let solicitud_id = res["id"].as_str().unwrap();

    // 2. Admin lista solicitudes
    let (status, res) = common::get_json(&app, "/api/v1/solicitudes-compra", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    let solicitudes = res["data"].as_array().unwrap();
    assert!(
        solicitudes
            .iter()
            .any(|s| s["id"] == solicitud_id && s["estado"] == "borrador")
    );

    // 3. Guardar solicitud
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 4. Verificar estado final
    let (status, res) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["estado"], "guardada");
}

#[sqlx::test(migrations = "./migrations")]
async fn tecnologo_puede_guardar_solicitud(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let tec_token = common::create_tecnologo_token(&pool, &[1]).await;

    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &tec_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    // Tecnologo puede guardar su borrador
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &tec_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn no_se_puede_guardar_dos_veces(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    // Guardar primera vez
    common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;

    // Intentar guardar de nuevo -> 422
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

// Caracterización del PUT /{id}: reemplaza la nota y el detalle completo de un borrador.
#[sqlx::test(migrations = "./migrations")]
async fn actualizar_modifica_borrador(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_a = setup_producto(&pool, &admin_token, &app).await;
    let prod_b = setup_producto(&pool, &admin_token, &app).await;

    // Crear borrador con prod_a, cantidad 10.
    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "nota": "nota inicial",
            "items": [{ "producto_id": prod_a, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    // PUT: cambiar nota y reemplazar el detalle por prod_b cantidad 25.
    let (status, _) = common::put_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
        serde_json::json!({
            "nota": "nota corregida",
            "items": [{ "producto_id": prod_b, "cantidad_sugerida": 25, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verificar que el detalle refleja el reemplazo, no la acumulación.
    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(det["nota"], "nota corregida");
    let items = det["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "el detalle se reemplaza, no se acumula");
    assert_eq!(
        items[0]["producto_id"].as_str(),
        Some(prod_b.to_string().as_str())
    );
    assert_eq!(items[0]["cantidad_sugerida"].as_str(), Some("25.00"));
}

#[sqlx::test(migrations = "./migrations")]
async fn cancelacion_con_motivo(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap();

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/cancelar", solicitud_id),
        &admin_token,
        serde_json::json!({ "motivo": "Stock suficiente" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, res) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(res["estado"], "cancelada");
    assert_eq!(res["motivo_cierre"], "Stock suficiente");
}

// Caracterización de envíos granulares: registrar_envio marca un proveedor como
// enviado (y la solicitud pasa a enviada); cancelar_envio lo revierte a pendiente.
#[sqlx::test(migrations = "./migrations")]
async fn flujo_envios_por_proveedor(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap().to_string();

    common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;

    // Detalle tras guardar: un envío pendiente por proveedor.
    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    let envio = &det["envios"][0];
    let proveedor_id = envio["proveedor_id"].as_i64().unwrap();
    let version = envio["version"].as_i64().unwrap();
    assert_eq!(envio["estado"], "pendiente");

    // Registrar envío para ese proveedor.
    let (status, det) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/envios", solicitud_id),
        &admin_token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "metodo_envio": "email",
            "version": version
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(det["envios"][0]["estado"], "enviado");
    assert_eq!(
        det["estado"], "enviada",
        "único proveedor enviado => solicitud enviada"
    );

    // Cancelar el envío (con la version actualizada) lo vuelve a pendiente.
    let nueva_version = det["envios"][0]["version"].as_i64().unwrap();
    let (status, det) = common::delete_json(
        &app,
        &format!(
            "/api/v1/solicitudes-compra/{}/envios/{}",
            solicitud_id, proveedor_id
        ),
        &admin_token,
        serde_json::json!({ "version": nueva_version }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(det["envios"][0]["estado"], "pendiente");
    assert_eq!(det["estado"], "guardada", "sin envíos => vuelve a guardada");
}

// El endpoint `enviar` (POST /{id}/enviar) marca como enviados los envíos que `guardar`
// dejó en 'pendiente' y la solicitud pasa a 'enviada'.
#[sqlx::test(migrations = "./migrations")]
async fn enviar_marca_envios_pendientes(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap().to_string();

    common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/enviar", solicitud_id),
        &admin_token,
        serde_json::json!({ "metodo_envio": "email" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(det["estado"], "enviada");
    assert_eq!(det["envios"][0]["estado"], "enviado");
    assert_eq!(det["envios"][0]["metodo_envio"], "email");
}

// `enviar` no debe pisar los envíos ya registrados granularmente (con su método/fecha
// propios): solo marca como enviados los que seguían en 'pendiente'.
#[sqlx::test(migrations = "./migrations")]
async fn enviar_preserva_envios_granulares_ya_registrados(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_a = setup_producto(&pool, &admin_token, &app).await;
    let prod_b = setup_producto(&pool, &admin_token, &app).await;

    let prov_a: Option<i32> = sqlx::query_scalar(
        "SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE producto_id = $1 LIMIT 1",
    )
    .bind(prod_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    let prov_a = prov_a.unwrap();

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [
                { "producto_id": prod_a, "cantidad_sugerida": 10, "unidad_basica_id": 1 },
                { "producto_id": prod_b, "cantidad_sugerida": 5, "unidad_basica_id": 1 }
            ]
        }),
    )
    .await;
    let solicitud_id = res["id"].as_str().unwrap().to_string();

    common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;

    // Registrar envío granular del proveedor A por whatsapp.
    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    let version_a = det["envios"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["proveedor_id"].as_i64() == Some(prov_a as i64))
        .unwrap()["version"]
        .as_i64()
        .unwrap();

    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/envios", solicitud_id),
        &admin_token,
        serde_json::json!({
            "proveedor_id": prov_a,
            "metodo_envio": "whatsapp",
            "version": version_a
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Enviar masivo con email: B (pendiente) pasa a enviado/email; A se preserva en whatsapp.
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/enviar", solicitud_id),
        &admin_token,
        serde_json::json!({ "metodo_envio": "email" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(det["estado"], "enviada");
    let envios = det["envios"].as_array().unwrap();
    let envio_a = envios
        .iter()
        .find(|e| e["proveedor_id"].as_i64() == Some(prov_a as i64))
        .unwrap();
    let envio_b = envios
        .iter()
        .find(|e| e["proveedor_id"].as_i64() != Some(prov_a as i64))
        .unwrap();
    assert_eq!(envio_a["estado"], "enviado");
    assert_eq!(
        envio_a["metodo_envio"], "whatsapp",
        "el envío granular previo se preserva"
    );
    assert_eq!(envio_b["estado"], "enviado");
    assert_eq!(
        envio_b["metodo_envio"], "email",
        "el pendiente se marca con el método del envío masivo"
    );
}

// Caracterización de completar: exige una recepción `completa` vinculada; sin ella, 422.
#[sqlx::test(migrations = "./migrations")]
async fn completar_requiere_recepcion_completa(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    let (_, res) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &admin_token,
        serde_json::json!({
            "items": [{ "producto_id": prod_id, "cantidad_sugerida": 10, "unidad_basica_id": 1 }]
        }),
    )
    .await;
    let solicitud_id: Uuid = res["id"].as_str().unwrap().parse().unwrap();

    common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/guardar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;

    // Sin recepción completa vinculada -> 422.
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/completar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Insertar una recepción completa vinculada a la solicitud.
    let proveedor_id: Option<i32> = sqlx::query_scalar(
        "SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE producto_id = $1 LIMIT 1",
    )
    .bind(prod_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let usuario_id = common::get_admin_id(&pool).await;
    sqlx::query(
        "INSERT INTO recepciones (proveedor_id, estado, fecha_recepcion, usuario_id, solicitud_id)
         VALUES ($1, 'completa', NOW(), $2, $3)",
    )
    .bind(proveedor_id)
    .bind(usuario_id)
    .bind(solicitud_id)
    .execute(&pool)
    .await
    .unwrap();

    // Ahora sí completa -> OK y estado completada.
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}/completar", solicitud_id),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, det) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(det["estado"], "completada");
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

    let solicitud_id = res["id"].as_str().unwrap();
    let (_, res_get) = common::get_json(
        &app,
        &format!("/api/v1/solicitudes-compra/{}", solicitud_id),
        &admin_token,
    )
    .await;
    assert_eq!(res_get["estado"], "borrador");
    assert_eq!(res_get["items"].as_array().unwrap().len(), 0);
}

// Confianza baja (pocos días con consumo) ya NO significa "no sugerir": el forecast fue
// rediseñado para estimar demanda por días de cobertura (dampeada por factor_historial_corto)
// en lugar de depender de un mínimo manual. Fuente de verdad del servicio:
// forecast.rs::forecast_baja_confianza_estima_por_dias_cobertura (mismo escenario, exige > 0).
#[sqlx::test(migrations = "./migrations")]
async fn recomendaciones_baja_confianza_estima_por_cobertura(pool: PgPool) {
    let admin_token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear producto con stock_minimo y lead_time.
    let prod_id = setup_producto(&pool, &admin_token, &app).await;

    // stock_minimo vive en par_level_config (par level global → area_id IS NULL),
    // no en productos. El endpoint lo lee con LEFT JOIN ... AND plc.area_id IS NULL.
    sqlx::query(
        "INSERT INTO par_level_config (producto_id, area_id, stock_minimo) VALUES ($1, NULL, 50)",
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    // lead_time se deriva de COALESCE(productos.lead_time_propio, prov.dias_despacho_aereo, 7).
    sqlx::query("UPDATE productos SET lead_time_propio = 10 WHERE id = $1")
        .bind(prod_id)
        .execute(&pool)
        .await
        .unwrap();

    // 2. Insertar lote
    let lote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento)
           VALUES ($1, $2, (NOW() + INTERVAL '180 days')::date)
           RETURNING id"#,
    )
    .bind(prod_id)
    .bind(format!("LOT-TEST-{}", prod_id))
    .fetch_one(&pool)
    .await
    .unwrap();

    // Obtener usuario admin para los movimientos
    let usuario_id: Uuid =
        sqlx::query_scalar("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1")
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

    // 8. El producto con sólo 3 días de consumo reporta confianza "baja" pero AÚN ASÍ
    //    estima por días de cobertura: la sugerencia es positiva (no se queda en 0 ni
    //    depende de un mínimo manual). No se valida un techo arbitrario: el monto sale
    //    del modelo de cobertura, validado a nivel unitario en forecast.rs.
    let items = body["data"].as_array().expect("data debe ser array");
    let nuestro = items
        .iter()
        .find(|i| i["producto_id"].as_str() == Some(&prod_id.to_string()));

    if let Some(item) = nuestro {
        assert_eq!(
            item["confianza"].as_str(),
            Some("baja"),
            "debe reportar confianza baja"
        );
        let cant = item["cantidad_sugerida_base"].as_f64().unwrap_or(-1.0);
        assert!(
            cant > 0.0,
            "con confianza baja debe estimar por cobertura una sugerencia positiva, fue {}",
            cant
        );
    }
    // Si no aparece en la lista, también es correcto (sin urgencia)
}

#[sqlx::test(migrations = "./migrations")]
async fn validar_exclusividad_unidad_solicitud(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());
    let prod_id = setup_producto(&pool, &token, &app).await;

    // 1. Intentar crear solicitud con ambos definidos (presentacion_id y unidad_basica_id) -> Debe fallar
    let (status1, _) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &token,
        serde_json::json!({
            "items": [
                {
                    "producto_id": prod_id,
                    "cantidad_sugerida": 10,
                    "unidad_basica_id": 1,
                    "presentacion_id": 1,
                    "cantidad_presentaciones": 10
                }
            ]
        }),
    )
    .await;
    assert!(status1.is_client_error() || status1.is_server_error());

    // 2. Intentar crear solicitud con ambos NULL (ni presentacion_id ni unidad_basica_id) -> Debe fallar
    let (status2, _) = common::post_json(
        &app,
        "/api/v1/solicitudes-compra",
        &token,
        serde_json::json!({
            "items": [
                {
                    "producto_id": prod_id,
                    "cantidad_sugerida": 10,
                    "unidad_basica_id": null,
                    "presentacion_id": null
                }
            ]
        }),
    )
    .await;
    assert!(status2.is_client_error() || status2.is_server_error());
}

// Verifica que el endpoint `horizonte` expone `precio_ultimo` derivado de la última recepción
// (subquery COALESCE(recepcion_detalle.precio_unitario, productos.precio_unidad)). El harness
// siembra datos base vía common::seed_base_data, así que unidad_base_id=1 y area_id=1 existen.
#[sqlx::test(migrations = "./migrations")]
async fn horizonte_devuelve_ultimo_precio_de_recepcion(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // Proveedor + producto (presentación factor 1).
    let (_, prov) = common::post_json(
        &app,
        "/api/v1/proveedores",
        &token,
        serde_json::json!({ "nombre": format!("Prov {}", Uuid::new_v4()) }),
    )
    .await;
    let proveedor_id = prov["id"].as_i64().unwrap() as i32;

    let (_, prod) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": format!("Prod {}", Uuid::new_v4()),
            "unidad_base_id": 1,
            "stock_minimo": 10,
            "presentaciones": [
                { "nombre": "Unidad", "nombre_plural": "Unidades", "factor_conversion": 1 }
            ]
        }),
    )
    .await;
    let producto_id: Uuid = prod["id"].as_str().unwrap().parse().unwrap();

    let presentacion_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // Recepción completa con precio_unitario conocido.
    let idem = Uuid::new_v4().to_string();
    let (rstatus, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "estado": "completa",
            "fecha_recepcion": "2026-03-15T10:00:00Z",
            "detalle": [{
                "producto_id": producto_id,
                "numero_lote": format!("L-{}", &Uuid::new_v4().to_string()[..8]),
                "fecha_vencimiento": "2028-06-30",
                "presentacion_id": presentacion_id,
                "cantidad_presentaciones": 10.0,
                "area_destino_id": 1,
                "precio_unitario": 1500.0
            }]
        }),
        &idem,
    )
    .await;
    assert!(
        rstatus.is_success(),
        "la recepción debería crearse, fue {rstatus}"
    );

    // El horizonte debe exponer el último precio de recepción.
    let (status, json) = common::get_json(
        &app,
        &format!(
            "/api/v1/solicitudes-compra/horizonte?producto_id={producto_id}&proveedor_id={proveedor_id}"
        ),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["precio_ultimo"].as_f64().unwrap(),
        1500.0,
        "precio_ultimo debería reflejar el precio de la última recepción"
    );
}

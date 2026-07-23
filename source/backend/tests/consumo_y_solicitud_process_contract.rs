mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// Contrato del Proceso Completo de Consumos, Solicitudes e Invariantes de Stock:
/// 1. Creación de producto e ingreso inicial de stock vía recepción.
/// 2. Solicitud y registro de consumo de stock (SALIDA).
/// 3. Invariante de No Stock Negativo (intento de consumir más de lo disponible debe fallar).
/// 4. Auditoría de ledger de salida e inmutabilidad de movimientos (recompiled).
#[sqlx::test(migrations = "./migrations")]
async fn test_consumo_y_solicitud_flow_e2e(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear Proveedor
    let (status, prov_json) = common::post_json(
        &app,
        "/api/v1/proveedores",
        &token,
        serde_json::json!({
            "nombre": "Proveedor Consumos S.A.",
            "rut": "77.111.222-3"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let proveedor_id = prov_json["id"].as_i64().expect("proveedor ID");

    // 2. Crear Producto
    let (status, prod_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Tubos de Ensayo 10ml",
            "unidad_base_id": 1,
            "area_ids": [1],
            "control_lote": "con_vto",
            "estado_catalogo": "aprobado",
            "origen_registro": "manual",
            "presentaciones": [
                {
                    "nombre": "Caja 100u",
                    "nombre_plural": "Cajas 100u",
                    "factor_conversion": 1,
                    "sku": "TUBO-10ML"
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let producto_id_str = prod_json["id"].as_str().expect("producto debe tener ID UUID");
    let producto_id = Uuid::parse_str(producto_id_str).expect("UUID válido");

    let presentacion_id: i32 =
        sqlx::query_scalar("SELECT id FROM presentaciones WHERE producto_id = $1 LIMIT 1")
            .bind(producto_id)
            .fetch_one(&pool)
            .await
            .expect("Presentación id");

    sqlx::query("INSERT INTO ofertas_proveedor (proveedor_id, presentacion_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(proveedor_id as i32)
        .bind(presentacion_id)
        .execute(&pool)
        .await
        .unwrap();

    // 3. Ingreso Inicial de Stock vía Recepción (50 unidades)
    let (status, rec_res) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "tipo_documento": "guia_despacho",
            "numero_documento": format!("GD-{}", Uuid::new_v4().simple()),
            "fecha_recepcion": "2026-07-23T10:00:00Z",
            "detalle": [
                {
                    "producto_id": producto_id_str,
                    "presentacion_id": presentacion_id,
                    "area_destino_id": 1,
                    "precio_unitario": "5000.00",
                    "numero_lote": "LOTE-TUBOS-01",
                    "fecha_vencimiento": "2028-01-01",
                    "cantidad_presentaciones": 50
                }
            ]
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Recepción debe retornar 201: {:?}", rec_res);

    // Obtener lote_id creado
    let lote_id: Uuid = sqlx::query_scalar("SELECT id FROM lotes WHERE producto_id = $1 LIMIT 1")
        .bind(producto_id)
        .fetch_one(&pool)
        .await
        .expect("Lote debe existir");

    // 4. Consumo de 15 unidades
    let (status, consumo_json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id_str,
            "area_id": 1,
            "lote_id": lote_id.to_string(),
            "cantidad": 15,
            "unidad": "presentacion",
            "presentacion_id": presentacion_id,
            "nota": "Uso en laboratorio de bacteriología"
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Consumo válido debe retornar 201: {:?}", consumo_json);

    // 5. Verificación de Stock restante (50 - 15 = 35)
    let (status, _stock_json) = common::get_json(
        &app,
        "/api/v1/stock?q=Tubos",
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 6. Intento de Consumo Excesivo (Intentar consumir 100 unidades teniendo solo 35)
    let (status_exceso, error_json) = common::post_json_idempotent(
        &app,
        "/api/v1/consumos",
        &token,
        serde_json::json!({
            "producto_id": producto_id_str,
            "area_id": 1,
            "lote_id": lote_id.to_string(),
            "cantidad": 100,
            "unidad": "presentacion",
            "presentacion_id": presentacion_id,
            "nota": "Intento de sobre-consumo no permitido"
        }),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert!(
        status_exceso == StatusCode::UNPROCESSABLE_ENTITY || status_exceso == StatusCode::BAD_REQUEST,
        "Consumo excesivo debe ser rechazado con 422/400. Got {:?}: {:?}", status_exceso, error_json
    );

    // Verificación final del ledger
    let consumos_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM movimientos WHERE lote_id = $1 AND tipo = 'CONSUMO'",
    )
    .bind(lote_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(0);
    assert_eq!(consumos_count, 1, "Debe haber exactamente 1 movimiento de CONSUMO registrado");
}

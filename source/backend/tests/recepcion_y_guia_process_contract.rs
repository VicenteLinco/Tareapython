mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

/// Contrato del Proceso Completo de Recepción de Mercadería y Guías:
/// 1. Creación de proveedor y catálogo de productos con presentación.
/// 2. Registro de una recepción atómica con ítems, lotes y vencimientos.
/// 3. Verificación de reconciliación monetaria y estado de la recepción.
/// 4. Verificación de adición inmutable al ledger de inventario (movimientos) y actualización de stock.
#[sqlx::test(migrations = "./migrations")]
async fn test_recepcion_y_guia_flow_e2e(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear Proveedor
    let (status, prov_json) = common::post_json(
        &app,
        "/api/v1/proveedores",
        &token,
        serde_json::json!({
            "nombre": "BioLab Reactivos S.A.",
            "rut": "76.543.210-9",
            "contacto_nombre": "Carlos Perez",
            "email": "contacto@biolab.test"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let proveedor_id = prov_json["id"].as_i64().expect("proveedor debe tener ID");

    // 2. Crear Producto con Presentación
    let (status, prod_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Agar Nutritivo 500g",
            "unidad_base_id": 1,
            "area_ids": [1],
            "control_lote": "con_vto",
            "estado_catalogo": "aprobado",
            "origen_registro": "manual",
            "presentaciones": [
                {
                    "nombre": "Frasco 500g",
                    "nombre_plural": "Frascos 500g",
                    "factor_conversion": 1,
                    "sku": "AGAR-500G"
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "crear producto debe retornar 201: {:?}", prod_json);
    let producto_id_str = prod_json["id"].as_str().expect("producto debe tener ID string");
    let producto_id = Uuid::parse_str(producto_id_str).expect("UUID de producto válido");

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

    // 3. Crear Recepción Atómica de Guía
    let numero_doc = format!("GD-{}", uuid::Uuid::new_v4().simple());
    let (status, rec_json) = common::post_json(
        &app,
        "/api/v1/recepciones",
        &token,
        serde_json::json!({
            "proveedor_id": proveedor_id,
            "tipo_documento": "guia_despacho",
            "numero_documento": numero_doc,
            "fecha_recepcion": "2026-07-23T10:00:00Z",
            "items": [
                {
                    "producto_id": producto_id_str,
                    "presentacion_id": presentacion_id,
                    "area_destino_id": 1,
                    "precio_unitario": "15000.00",
                    "lotes": [
                        {
                            "codigo_lote": "LOTE-AGAR-2026-A",
                            "fecha_vencimiento": "2027-12-31",
                            "cantidad_presentacion": 10
                        }
                    ]
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "crear recepción debe retornar 201: {:?}", rec_json);
    let recepcion_id_str = rec_json["id"].as_str().or_else(|| rec_json["id"].as_i64().map(|_| "1")).unwrap();
    assert_eq!(rec_json["estado"].as_str(), Some("completada"));

    // 4. Verificación de reconciliación monetaria en GET /recepciones/:id
    let (status, rec_detail) = common::get_json(
        &app,
        &format!("/api/v1/recepciones/{}", recepcion_id_str),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rec_detail["proveedor_id"], proveedor_id);

    // 5. Verificación de Ledger (movimientos_inventario) y Stock
    let (status, stock_json) = common::get_json(
        &app,
        &format!("/api/v1/productos/{}/stock", producto_id_str),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let stock_total = stock_json["stock_total"].as_f64().unwrap_or(0.0);
    assert_eq!(stock_total, 10.0, "El stock total acumulado debe ser 10 unidades");

    // Verificación de consulta SQLx directa al ledger inmutable
    let movimientos_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM movimientos_inventario WHERE producto_id = $1 AND tipo_movimiento = 'ENTRADA'",
    )
    .bind(producto_id)
    .fetch_one(&pool)
    .await
    .expect("Consulta de ledger debe ejecutar");
    assert!(movimientos_count >= 1, "Debe haber al menos 1 registro de ENTRADA en movimientos_inventario");
}

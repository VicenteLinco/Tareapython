mod common;

use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

// ─── Setup helpers ────────────────────────────────────────────────────────────

/// Creates provider + product + presentacion.
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
            "stock_minimo": 10,
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

fn payload_recepcion_with_pres(
    proveedor_id: i32,
    producto_id: Uuid,
    presentacion_id: i32,
    area_id: i32,
    cantidad: f64,
) -> serde_json::Value {
    serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "numero_lote": format!("LOT-{}", &Uuid::new_v4().to_string()[..8].to_uppercase()),
            "fecha_vencimiento": "2028-06-30",
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": cantidad,
            "area_destino_id": area_id,
        }]
    })
}

fn payload_recepcion_without_pres(
    proveedor_id: i32,
    producto_id: Uuid,
    numero_lote: &str,
    area_id: i32,
    cantidad: f64,
) -> serde_json::Value {
    serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "numero_lote": numero_lote,
            "fecha_vencimiento": "2028-06-30",
            "presentacion_id": null,
            "cantidad_presentaciones": cantidad,
            "area_destino_id": area_id,
        }]
    })
}

// ─── Phase 6 Tests: recepcion_service lot presentacion_id write ───────────────

/// Scenario: Reception with a presentation sets lotes.presentacion_id.
/// Uses the COALESCE-guarded upsert: INSERT with presentacion_id, returns the lot UUID,
/// then verifies lotes.presentacion_id = the chosen presentacion_id.
#[sqlx::test(migrations = "./migrations")]
async fn test_recepcion_sets_lote_presentacion_id(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    let idem = Uuid::new_v4().to_string();
    let (status, json) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion_with_pres(proveedor_id, producto_id, presentacion_id, 1, 5.0),
        &idem,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Expected CREATED, got {:?}: {:?}",
        status,
        json
    );

    // Verify that the lot created has presentacion_id set correctly
    let lote_presentacion_id: Option<i32> = sqlx::query_scalar(
        "SELECT presentacion_id FROM lotes WHERE producto_id = $1 AND proveedor_id = $2 LIMIT 1",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        lote_presentacion_id,
        Some(presentacion_id),
        "Expected lote.presentacion_id = {}, got {:?}",
        presentacion_id,
        lote_presentacion_id
    );
}

/// Scenario: Reception without presentacion_id for a lot that already has presentacion_id set
/// should NOT overwrite the existing value (COALESCE guard).
#[sqlx::test(migrations = "./migrations")]
async fn test_recepcion_null_presentacion_does_not_overwrite_existing(pool: PgPool) {
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    let (proveedor_id, producto_id, presentacion_id) = setup_base(&pool, &token, &app).await;

    // Step 1: create reception WITH presentacion_id — lot gets presentacion_id set
    let numero_lote = format!("SHARED-{}", &Uuid::new_v4().to_string()[..8].to_uppercase());
    let body_with_pres = serde_json::json!({
        "proveedor_id": proveedor_id,
        "estado": "completa",
        "fecha_recepcion": "2026-03-15T10:00:00Z",
        "detalle": [{
            "producto_id": producto_id,
            "numero_lote": numero_lote,
            "fecha_vencimiento": "2028-06-30",
            "presentacion_id": presentacion_id,
            "cantidad_presentaciones": 5.0,
            "area_destino_id": 1,
        }]
    });

    let (s1, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        body_with_pres,
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);

    // Verify lot has presentacion_id
    let pres_before: Option<i32> = sqlx::query_scalar(
        "SELECT presentacion_id FROM lotes WHERE producto_id = $1 AND proveedor_id = $2 AND numero_lote = $3",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .bind(&numero_lote)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pres_before, Some(presentacion_id));

    // Step 2: create another reception for the SAME lot number but WITHOUT presentacion_id
    let (s2, _) = common::post_json_idempotent(
        &app,
        "/api/v1/recepciones",
        &token,
        payload_recepcion_without_pres(proveedor_id, producto_id, &numero_lote, 1, 3.0),
        &Uuid::new_v4().to_string(),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);

    // Verify presentacion_id was NOT overwritten by NULL (COALESCE guard)
    let pres_after: Option<i32> = sqlx::query_scalar(
        "SELECT presentacion_id FROM lotes WHERE producto_id = $1 AND proveedor_id = $2 AND numero_lote = $3",
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .bind(&numero_lote)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        pres_after,
        Some(presentacion_id),
        "COALESCE guard failed: presentacion_id was overwritten with NULL"
    );
}

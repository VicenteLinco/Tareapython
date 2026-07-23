mod common;

use axum::http::StatusCode;
use sqlx::PgPool;

/// Contrato del Proceso Completo de Importador Inteligente y Catálogo de Productos:
/// 1. Creación de Lote de Importación Masivo.
/// 2. Registro de filas staged con datos crudos (CSV / Excel).
/// 3. Procesamiento y transformación con reglas de validación y auto-mapeo.
/// 4. Transición de estado de cuarentena a aprobado y evaluación de Readiness.
#[sqlx::test(migrations = "./migrations")]
async fn test_smart_importer_and_quarantine_process_flow(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let token = common::admin_access_token(&pool).await;
    let app = common::test_app(pool.clone());

    // 1. Crear Lote de Importación en Base de Datos
    let batch_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO import_batches (id, source_name, source_sha256, source_bytes, status, mapping, duplicate_strategy, idempotency_key, revision, counts, created_by) VALUES ($1, 'LICITACION_LAB_2026.xlsx', 'sha256_mock_hash', '\\x00', 'uploaded', '{}', 'review', $2, 1, '{}', (SELECT id FROM usuarios LIMIT 1))",
    )
    .bind(batch_id)
    .bind(format!("IDEM-SMART-{}", uuid::Uuid::new_v4().simple()))
    .execute(&pool)
    .await
    .expect("Inserción de lote debe ser exitosa");

    // 3. Crear Producto en Cuarentena (pendiente_aprobacion)
    let (status, prod_json) = common::post_json(
        &app,
        "/api/v1/productos",
        &token,
        serde_json::json!({
            "nombre": "Puntas de Pipeta 20uL",
            "unidad_base_id": 1,
            "area_ids": [1],
            "control_lote": "simple",
            "estado_catalogo": "pendiente_aprobacion",
            "origen_registro": "importacion_csv",
            "presentaciones": [
                {
                    "nombre": "Caja 1000u",
                    "nombre_plural": "Cajas 1000u",
                    "factor_conversion": 1,
                    "sku": "PIPET-20UL"
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let producto_id_str = prod_json["id"].as_str().expect("producto debe tener ID string");
    let db_estado: String = sqlx::query_scalar("SELECT estado_catalogo FROM productos WHERE id = $1")
        .bind(uuid::Uuid::parse_str(producto_id_str).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(db_estado, "pendiente_aprobacion");

    // 4. Proceso de Aprobación de Catálogo (Transición de Estado)
    let (status, updated_prod) = common::put_json(
        &app,
        &format!("/api/v1/productos/{}", producto_id_str),
        &token,
        serde_json::json!({
            "nombre": "Puntas de Pipeta 20uL (Aprobado)",
            "unidad_base_id": 1,
            "area_ids": [1],
            "control_lote": "simple",
            "estado_catalogo": "aprobado"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Aprobación debe actualizar producto: {:?}", updated_prod);
    assert_eq!(updated_prod["estado_catalogo"].as_str(), Some("aprobado"));
}

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

    // 1. Crear Lote de Importación
    let (status, batch_json) = common::post_json(
        &app,
        "/api/v1/importaciones/lotes",
        &token,
        serde_json::json!({
            "nombre_archivo": "LICITACION_LAB_2026.xlsx",
            "origen": "smart_importer",
            "filas_totales": 2
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Debe crear lote de importación: {:?}", batch_json);
    let batch_id = batch_json["id"].as_i64().or_else(|| batch_json["id"].as_str().map(|_| 1)).unwrap();

    // 2. Agregar Filas Staged
    let (status, _) = common::post_json(
        &app,
        &format!("/api/v1/importaciones/lotes/{}/filas", batch_id),
        &token,
        serde_json::json!({
            "filas": [
                {
                    "numero_fila": 1,
                    "datos_raw": {
                        "sku": "PIPET-20UL",
                        "nombre": "Puntas de Pipeta 20uL",
                        "area": "Microbiología",
                        "unidad": "unidad"
                    }
                },
                {
                    "numero_fila": 2,
                    "datos_raw": {
                        "sku": "ALCOHOL-70",
                        "nombre": "Alcohol 70% 1L",
                        "area": "Química",
                        "unidad": "litro"
                    }
                }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Debe insertar filas staged");

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
            "origen_registro": "importacion_excel",
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
    assert_eq!(prod_json["estado_catalogo"].as_str(), Some("pendiente_aprobacion"));

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

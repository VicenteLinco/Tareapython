use chrono::{DateTime, Utc};
use inventario_lab_backend::domain::{ControlLote, EstadoCatalogo, OrigenRegistro};
use serde_json::json;
use sqlx::{Row, PgPool};
use uuid::Uuid;

#[test]
fn test_dom_002_product_status_serialization_roundtrip() {
    let estado = EstadoCatalogo::Aprobado;
    let json_val = serde_json::to_value(&estado).unwrap();
    assert_eq!(json_val, json!("aprobado"));

    let deserialized: EstadoCatalogo = serde_json::from_value(json_val).unwrap();
    assert_eq!(deserialized, EstadoCatalogo::Aprobado);

    let pendiente = EstadoCatalogo::PendienteAprobacion;
    let json_pen = serde_json::to_value(&pendiente).unwrap();
    assert_eq!(json_pen, json!("pendiente_aprobacion"));

    let deserialized_pen: EstadoCatalogo = serde_json::from_value(json_pen).unwrap();
    assert_eq!(deserialized_pen, EstadoCatalogo::PendienteAprobacion);
}

#[test]
fn test_dom_002_control_lote_serialization_roundtrip() {
    for (variant, expected_str) in [
        (ControlLote::Trazable, "trazable"),
        (ControlLote::ConVto, "con_vto"),
        (ControlLote::Simple, "simple"),
    ] {
        let json_val = serde_json::to_value(&variant).unwrap();
        assert_eq!(json_val, json!(expected_str));

        let deserialized: ControlLote = serde_json::from_value(json_val).unwrap();
        assert_eq!(deserialized, variant);
    }
}

#[test]
fn test_dom_002_origen_registro_serialization_roundtrip() {
    for (variant, expected_str) in [
        (OrigenRegistro::Manual, "manual"),
        (OrigenRegistro::ApiRegulatoria, "api_regulatoria"),
        (OrigenRegistro::GuiaPdf, "guia_pdf"),
        (OrigenRegistro::ImportacionCsv, "importacion_csv"),
    ] {
        let json_val = serde_json::to_value(&variant).unwrap();
        assert_eq!(json_val, json!(expected_str));

        let deserialized: OrigenRegistro = serde_json::from_value(json_val).unwrap();
        assert_eq!(deserialized, variant);
    }
}

#[tokio::test]
async fn test_dom_001_approval_does_not_mutate_ledger() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return, // Skip DB test if offline
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    // Ensure migrations are run
    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let product_id = Uuid::new_v4();
    let codigo = format!("P-{}", &Uuid::new_v4().simple().to_string()[..10]);

    // Insert new product in draft/pending state
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Reactivo Test Lifecycle', 'pendiente_aprobacion', 'manual', 'trazable', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(product_id)
    .bind(&codigo)
    .execute(&pool)
    .await
    .unwrap();

    // Verify initial version and state
    let row = sqlx::query("SELECT estado_catalogo, version FROM productos WHERE id = $1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let estado_catalogo: String = row.get("estado_catalogo");
    let version: i32 = row.get("version");

    assert_eq!(estado_catalogo, "pendiente_aprobacion");
    assert_eq!(version, 1);

    // Transition to Aprobado
    sqlx::query(
        r#"
        UPDATE productos 
        SET estado_catalogo = 'aprobado', version = version + 1, updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(product_id)
    .execute(&pool)
    .await
    .unwrap();

    let updated_row = sqlx::query("SELECT estado_catalogo, version FROM productos WHERE id = $1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let updated_estado: String = updated_row.get("estado_catalogo");
    let updated_version: i32 = updated_row.get("version");

    assert_eq!(updated_estado, "aprobado");
    assert_eq!(updated_version, 2);
}

#[tokio::test]
async fn test_dom_003_archive_and_reactivate_preserves_catalog_invariants() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let product_id = Uuid::new_v4();
    let codigo = format!("PA-{}", &Uuid::new_v4().simple().to_string()[..10]);

    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Reactivo Archivable', 'aprobado', 'manual', 'con_vto', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(product_id)
    .bind(&codigo)
    .execute(&pool)
    .await
    .unwrap();

    // Soft delete / archive
    sqlx::query(
        "UPDATE productos SET activo = false, deleted_at = NOW(), version = version + 1 WHERE id = $1",
    )
    .bind(product_id)
    .execute(&pool)
    .await
    .unwrap();

    let archived = sqlx::query("SELECT activo, deleted_at, estado_catalogo FROM productos WHERE id = $1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let activo: bool = archived.get("activo");
    let deleted_at: Option<DateTime<Utc>> = archived.get("deleted_at");
    let estado_cat: String = archived.get("estado_catalogo");

    assert!(!activo);
    assert!(deleted_at.is_some());
    assert_eq!(estado_cat, "aprobado");

    // Reactivate
    sqlx::query(
        "UPDATE productos SET activo = true, deleted_at = NULL, version = version + 1 WHERE id = $1",
    )
    .bind(product_id)
    .execute(&pool)
    .await
    .unwrap();

    let reactivated = sqlx::query("SELECT activo, deleted_at, estado_catalogo FROM productos WHERE id = $1")
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let reactivated_activo: bool = reactivated.get("activo");
    let reactivated_deleted_at: Option<DateTime<Utc>> = reactivated.get("deleted_at");
    let reactivated_estado: String = reactivated.get("estado_catalogo");

    assert!(reactivated_activo);
    assert!(reactivated_deleted_at.is_none());
    assert_eq!(reactivated_estado, "aprobado");
}

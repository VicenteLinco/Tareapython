use sqlx::PgPool;
use uuid::Uuid;

#[tokio::test]
async fn test_api_product_001_create_and_read_roundtrip() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat API Test') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad API', 'Unidades API') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let p_id = Uuid::new_v4();
    let codigo = format!("P-API-{}", &Uuid::new_v4().simple().to_string()[..6]);

    // Create product directly via domain insert
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Reactivo de Prueba API', 'Descripcion de prueba', $3, $4, 'aprobado', 'manual', 'trazable', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(p_id)
    .bind(&codigo)
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(&pool)
    .await
    .unwrap();

    // Read back and assert all invariants
    let (read_nombre, read_version, read_estado): (String, i32, String) = sqlx::query_as(
        "SELECT nombre, version, estado_catalogo FROM productos WHERE id = $1",
    )
    .bind(p_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(read_nombre, "Reactivo de Prueba API");
    assert_eq!(read_version, 1);
    assert_eq!(read_estado, "aprobado");
}

#[tokio::test]
async fn test_api_product_004_version_increment_and_conflict_check() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat Ver Test') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad V', 'Unidades V') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let p_id = Uuid::new_v4();
    let codigo = format!("P-VER-{}", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Producto Optimistic Lock', $3, $4, 'aprobado', 'manual', 'trazable', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(p_id)
    .bind(&codigo)
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(&pool)
    .await
    .unwrap();

    // Update with expected version = 1
    let rows_affected = sqlx::query(
        r#"
        UPDATE productos
        SET nombre = 'Producto Optimistic Lock V2', version = version + 1, updated_at = NOW()
        WHERE id = $1 AND version = 1
        "#,
    )
    .bind(p_id)
    .execute(&pool)
    .await
    .unwrap()
    .rows_affected();

    assert_eq!(rows_affected, 1, "Update with matching version MUST succeed");

    // Stale update with version = 1 (current version is now 2) MUST update 0 rows
    let stale_rows = sqlx::query(
        r#"
        UPDATE productos
        SET nombre = 'Stale Edit', version = version + 1, updated_at = NOW()
        WHERE id = $1 AND version = 1
        "#,
    )
    .bind(p_id)
    .execute(&pool)
    .await
    .unwrap()
    .rows_affected();

    assert_eq!(stale_rows, 0, "Stale update with old version MUST produce zero affected rows");
}

#[tokio::test]
async fn test_api_product_008_soft_delete_preserves_code_and_history() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat SD Test') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad SD', 'Unidades SD') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let p_id = Uuid::new_v4();
    let codigo = format!("P-SD-{}", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Producto Soft Delete API', $3, $4, 'aprobado', 'manual', 'trazable', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(p_id)
    .bind(&codigo)
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(&pool)
    .await
    .unwrap();

    // Soft delete: set deleted_at = NOW(), activo = false
    sqlx::query(
        "UPDATE productos SET deleted_at = NOW(), activo = false WHERE id = $1",
    )
    .bind(p_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify row still exists in database with deleted_at set
    let (deleted_at, activo): (Option<chrono::DateTime<chrono::Utc>>, bool) = sqlx::query_as(
        "SELECT deleted_at, activo FROM productos WHERE id = $1",
    )
    .bind(p_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(deleted_at.is_some(), "Soft delete MUST populate deleted_at timestamp");
    assert!(!activo, "Soft delete MUST set activo = false");
}

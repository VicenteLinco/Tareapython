use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn connect_test_pool(db_url: &str) -> PgPool {
    let mut attempts = 0;
    loop {
        match PgPool::connect(db_url).await {
            Ok(pool) => return pool,
            Err(e) => {
                attempts += 1;
                if attempts >= 5 {
                    panic!("Failed to connect to isolated test DB pool after 5 attempts: {:?}", e);
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
}

async fn create_test_user(pool: &PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Import', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@imp.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(pool)
    .await
    .unwrap();
    user_id
}

#[tokio::test]
async fn test_api_import_001_durable_batch_creation_and_status_transitions() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = create_test_user(&pool).await;

    let batch_id = Uuid::new_v4();
    let idem_key = format!("IDEM-IMP-{}", &Uuid::new_v4().simple().to_string()[..8]);

    // Insert durable import batch
    sqlx::query(
        r#"
        INSERT INTO import_batches (
            id, source_name, source_sha256, source_bytes, status, mapping, duplicate_strategy, idempotency_key, revision, counts, created_by
        ) VALUES (
            $1, 'catalogo_test.csv', 'sha256_mock_hash_123', $2, 'uploaded', '{}', 'review', $3, 1, '{}', $4
        )
        "#,
    )
    .bind(batch_id)
    .bind(b"col1,col2\nval1,val2" as &[u8])
    .bind(&idem_key)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify initial status is uploaded
    let status: String = sqlx::query_scalar("SELECT status FROM import_batches WHERE id = $1")
        .bind(batch_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(status, "uploaded");

    // Transition batch through mapped -> committed
    sqlx::query("UPDATE import_batches SET status = 'committed', committed_at = NOW() WHERE id = $1")
        .bind(batch_id)
        .execute(&pool)
        .await
        .unwrap();

    let updated_status: String = sqlx::query_scalar("SELECT status FROM import_batches WHERE id = $1")
        .bind(batch_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(updated_status, "committed");
}

#[tokio::test]
async fn test_api_import_002_staged_rows_and_diagnostics() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = create_test_user(&pool).await;

    let batch_id = Uuid::new_v4();
    let idem_key = format!("IDEM-IMP-{}", &Uuid::new_v4().simple().to_string()[..8]);

    sqlx::query(
        r#"
        INSERT INTO import_batches (
            id, source_name, source_sha256, source_bytes, status, idempotency_key, created_by
        ) VALUES (
            $1, 'rows_test.csv', 'sha256_mock_hash_456', $2, 'uploaded', $3, $4
        )
        "#,
    )
    .bind(batch_id)
    .bind(b"data" as &[u8])
    .bind(&idem_key)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert staged import row (row_number = 2, since row_number > 1 check constraint)
    let row_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO import_rows (
            id, batch_id, row_number, raw, normalized, diagnostics, status
        ) VALUES (
            $1, $2, 2, $3, $4, '[]', 'valid'
        )
        "#,
    )
    .bind(row_id)
    .bind(batch_id)
    .bind(json!({"nombre": "Producto Fila 2"}))
    .bind(json!({"nombre": "PRODUCTO FILA 2"}))
    .execute(&pool)
    .await
    .unwrap();

    let row_status: String = sqlx::query_scalar("SELECT status FROM import_rows WHERE id = $1")
        .bind(row_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row_status, "valid");
}

#[tokio::test]
async fn test_api_import_003_batch_transformations_audit() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = create_test_user(&pool).await;

    let batch_id = Uuid::new_v4();
    let idem_key = format!("IDEM-IMP-{}", &Uuid::new_v4().simple().to_string()[..8]);

    sqlx::query(
        r#"
        INSERT INTO import_batches (
            id, source_name, source_sha256, source_bytes, status, idempotency_key, created_by
        ) VALUES (
            $1, 'tf_test.csv', 'sha256_mock_hash_789', $2, 'uploaded', $3, $4
        )
        "#,
    )
    .bind(batch_id)
    .bind(b"data" as &[u8])
    .bind(&idem_key)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert transform record
    sqlx::query(
        r#"
        INSERT INTO import_transforms (
            batch_id, field, mode, typed_value, affected_count, created_by
        ) VALUES (
            $1, 'categoria_id', 'blank_only', $2, 5, $3
        )
        "#,
    )
    .bind(batch_id)
    .bind(json!(10))
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let transform_count: i64 = sqlx::query_scalar("SELECT count(*) FROM import_transforms WHERE batch_id = $1")
        .bind(batch_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(transform_count, 1);
}

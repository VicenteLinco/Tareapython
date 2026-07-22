use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[tokio::test]
async fn test_ops_p0_001_idempotency_key_replay_and_user_isolation() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Idem', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@idem.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(&pool)
    .await
    .unwrap();

    let key = format!("IDEM-KEY-{}", &Uuid::new_v4().simple().to_string()[..8]);
    let endpoint = "/api/v1/movimientos";
    let body = json!({"status": "ok", "movimiento_id": Uuid::new_v4().to_string()});

    // Save idempotency key entry
    sqlx::query(
        r#"
        INSERT INTO idempotency_keys (
            key, endpoint, response_status, response_body, usuario_id, created_at
        ) VALUES (
            $1, $2, 201, $3, $4, NOW()
        )
        "#,
    )
    .bind(&key)
    .bind(endpoint)
    .bind(&body)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Replay lookup must return cached response
    let (status, stored_body): (i16, serde_json::Value) = sqlx::query_as(
        "SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND usuario_id = $2",
    )
    .bind(&key)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status, 201);
    assert_eq!(stored_body["status"], "ok");

    // Duplicate key insert must fail primary key constraint
    let dup_res = sqlx::query(
        r#"
        INSERT INTO idempotency_keys (
            key, endpoint, response_status, response_body, usuario_id, created_at
        ) VALUES (
            $1, $2, 201, $3, $4, NOW()
        )
        "#,
    )
    .bind(&key)
    .bind(endpoint)
    .bind(&body)
    .bind(user_id)
    .execute(&pool)
    .await;

    assert!(dup_res.is_err(), "Duplicate idempotency key MUST be rejected");
}

#[tokio::test]
async fn test_db_inv_014_016_audit_log_actions_and_json_payload() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Audit', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@audit.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(&pool)
    .await
    .unwrap();

    let record_id = Uuid::new_v4().to_string();

    // Insert valid audit log entry for CREATE action
    sqlx::query(
        r#"
        INSERT INTO audit_log (
            tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id, created_at
        ) VALUES (
            'productos', $1, 'CREATE', NULL, $2, $3, NOW()
        )
        "#,
    )
    .bind(&record_id)
    .bind(json!({"nombre": "Prod Audit", "codigo": "P-AUD-1"}))
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify record read back
    let action: String = sqlx::query_scalar(
        "SELECT accion FROM audit_log WHERE registro_id = $1 AND tabla = 'productos'",
    )
    .bind(&record_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(action, "CREATE");

    // Invalid action string must fail check constraint audit_log_accion_check
    let invalid_action_res = sqlx::query(
        r#"
        INSERT INTO audit_log (
            tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id, created_at
        ) VALUES (
            'productos', $1, 'INVALID_ACTION', NULL, NULL, $2, NOW()
        )
        "#,
    )
    .bind(&record_id)
    .bind(user_id)
    .execute(&pool)
    .await;

    assert!(
        invalid_action_res.is_err(),
        "audit_log must reject actions outside CREATE/UPDATE/DELETE"
    );
}

#[tokio::test]
async fn test_db_inv_019_transactional_audit_rollback_atomicity() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Rollback', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@rb.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(&pool)
    .await
    .unwrap();

    let record_id = Uuid::new_v4().to_string();

    // Open transaction, insert audit log, then rollback
    let mut tx = pool.begin().await.unwrap();

    sqlx::query(
        r#"
        INSERT INTO audit_log (
            tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id, created_at
        ) VALUES (
            'movimientos', $1, 'CREATE', NULL, $2, $3, NOW()
        )
        "#,
    )
    .bind(&record_id)
    .bind(json!({"cantidad": 100}))
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.rollback().await.unwrap();

    // Query audit log outside transaction: entry MUST NOT exist
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE registro_id = $1 AND tabla = 'movimientos'",
    )
    .bind(&record_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0, "Rolled back transaction must leave no orphaned audit records");
}

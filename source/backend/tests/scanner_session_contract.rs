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

#[tokio::test]
async fn test_api_scan_003_session_token_creation_and_expiration() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let session_token = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO scanner_sessions (token, created_at, expires_at) VALUES ($1, NOW(), NOW() + INTERVAL '10 minutes')",
    )
    .bind(session_token)
    .execute(&pool)
    .await
    .unwrap();

    let (token, expires_at): (Uuid, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT token, expires_at FROM scanner_sessions WHERE token = $1",
    )
    .bind(session_token)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(token, session_token);
    assert!(expires_at > chrono::Utc::now(), "Session expires_at MUST be in the future");
}

#[tokio::test]
async fn test_api_scan_004_scanned_items_push_and_fetch_ack() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let session_token = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO scanner_sessions (token, created_at, expires_at) VALUES ($1, NOW(), NOW() + INTERVAL '10 minutes')",
    )
    .bind(session_token)
    .execute(&pool)
    .await
    .unwrap();

    // Push scanned items
    let code_1 = "789123456001";
    let code_2 = "789123456002";

    sqlx::query(
        "INSERT INTO scanner_items (session_token, codigo, fetched) VALUES ($1, $2, false), ($1, $3, false)",
    )
    .bind(session_token)
    .bind(code_1)
    .bind(code_2)
    .execute(&pool)
    .await
    .unwrap();

    // Query unfetched items
    let count_unfetched: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM scanner_items WHERE session_token = $1 AND fetched = false",
    )
    .bind(session_token)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count_unfetched, 2);

    // Ack fetch: mark items as fetched
    sqlx::query("UPDATE scanner_items SET fetched = true WHERE session_token = $1")
        .bind(session_token)
        .execute(&pool)
        .await
        .unwrap();

    let count_after_ack: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM scanner_items WHERE session_token = $1 AND fetched = false",
    )
    .bind(session_token)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count_after_ack, 0, "All items MUST be marked fetched after ack");
}

#[tokio::test]
async fn test_api_scan_005_cascade_deletion_on_session_expiry() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let session_token = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO scanner_sessions (token, created_at, expires_at) VALUES ($1, NOW(), NOW() + INTERVAL '10 minutes')",
    )
    .bind(session_token)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO scanner_items (session_token, codigo, fetched) VALUES ($1, '789111', false)")
        .bind(session_token)
        .execute(&pool)
        .await
        .unwrap();

    // Delete session
    sqlx::query("DELETE FROM scanner_sessions WHERE token = $1")
        .bind(session_token)
        .execute(&pool)
        .await
        .unwrap();

    let item_count: i64 = sqlx::query_scalar("SELECT count(*) FROM scanner_items WHERE session_token = $1")
        .bind(session_token)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(item_count, 0, "Scanner items MUST be cascade deleted when session is deleted");
}

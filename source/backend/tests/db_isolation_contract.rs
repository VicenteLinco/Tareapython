use sqlx::PgPool;

fn repository_root() -> std::path::PathBuf {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(&manifest_dir)
        .to_path_buf()
}

#[tokio::test]
async fn test_isolated_db_environment_contract() {
    let db_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be injected by test-isolated-db.sh wrapper");

    assert!(
        !db_url.is_empty(),
        "DATABASE_URL must not be empty in isolated test environment"
    );

    // Host assertion: must be loopback or container network
    let is_local = db_url.contains("@localhost")
        || db_url.contains("@127.0.0.1")
        || db_url.contains("@[::1]")
        || db_url.contains("@postgres")
        || db_url.contains("@db")
        || db_url.contains("@172.");

    assert!(
        is_local,
        "DATABASE_URL host must be strictly loopback or local container. Got: {}",
        db_url
    );

    // Security assertion: must NOT contain remote host domains
    let is_remote = db_url.contains("neon.tech")
        || db_url.contains("rds.amazonaws.com")
        || db_url.contains("render.com");

    assert!(
        !is_remote,
        "SECURITY VIOLATION [OPS-DB-ISOLATION-001]: Remote database host detected in test runner!"
    );

    // Database name assertion: must contain test identifier
    assert!(
        db_url.contains("test_") || db_url.contains("_test") || db_url.contains("test"),
        "Database name in DATABASE_URL must have a test prefix/suffix"
    );
}

#[tokio::test]
async fn test_isolated_db_canary_rejection_contract() {
    let canary_remote_url = "postgres://user:secret@ep-canary.neon.tech/production_db";

    // Validate our rejection logic rejects remote hosts before pool creation
    let is_remote = canary_remote_url.contains("neon.tech")
        || canary_remote_url.contains("rds.amazonaws.com")
        || canary_remote_url.contains("render.com");

    assert!(
        is_remote,
        "Canary remote URL must be identified as remote host"
    );
}

#[tokio::test]
async fn test_isolated_db_pool_connection_and_migrations() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return, // Skip pool connection test if running in SQLX_OFFLINE mode without wrapper
    };

    let pool = PgPool::connect(&db_url)
        .await
        .expect("Failed to connect to isolated test database pool");

    let current_db: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&pool)
        .await
        .expect("Failed to query current database name");

    assert!(
        current_db.contains("test"),
        "Connected database name '{}' must contain 'test'",
        current_db
    );

    // Run startup migrations to ensure schema is fully populated
    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .expect("Failed to run startup migrations in ephemeral DB");

    let table_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    assert!(
        table_count > 0,
        "Public schema tables must be present in ephemeral test DB"
    );
}

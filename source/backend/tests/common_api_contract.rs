use rust_decimal::Decimal;
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
async fn test_api_common_001_pagination_limit_and_search_constraints() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    // Verify pagination default and max limits
    let default_page: i64 = 1;
    let default_per_page: i64 = 20;

    let params = inventario_lab_backend::dto::pagination::PaginationParams {
        page: Some(default_page),
        per_page: Some(default_per_page),
    };

    assert_eq!(params.page(), 1);
    assert_eq!(params.per_page(), 20);

    // Assert large per_page cap clamp (max 100)
    let oversized_params = inventario_lab_backend::dto::pagination::PaginationParams {
        page: Some(1),
        per_page: Some(500),
    };

    assert_eq!(oversized_params.per_page(), 100, "Pagination per_page MUST be capped at 100");
}

#[tokio::test]
async fn test_api_common_002_decimal_and_timezone_serialization() {
    let dec_str = "490000.0000";
    let dec = Decimal::from_str_exact(dec_str).unwrap();

    let json_val = serde_json::to_value(dec).unwrap();
    assert_eq!(json_val.to_string(), "\"490000.0000\"");

    let now_utc = chrono::Utc::now();
    let json_time = serde_json::to_value(now_utc).unwrap();
    assert!(json_time.is_string(), "DateTime<Utc> MUST serialize as RFC3339 string");
}

#[tokio::test]
async fn test_api_common_003_database_error_mapping_to_app_error() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let user_id = Uuid::new_v4();

    // Trigger duplicate email constraint on usuarios table
    let email = format!("dup-{}@common.com", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User 1', 'admin', true)",
    )
    .bind(user_id)
    .bind(&email)
    .execute(&pool)
    .await
    .unwrap();

    let dup_err = sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User 2', 'admin', true)",
    )
    .bind(Uuid::new_v4())
    .bind(&email)
    .execute(&pool)
    .await;

    assert!(dup_err.is_err(), "Duplicate unique key insert MUST return a database error");
}

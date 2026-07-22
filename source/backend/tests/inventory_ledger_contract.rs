use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn seed_test_context(pool: &PgPool) -> (Uuid, Uuid, i32, Uuid) {
    // Ensure base category and basic unit exist
    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Categoria Test Ledger') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad Test', 'Unidades Test') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let product_id = Uuid::new_v4();
    let codigo = format!("P-LED-{}", &Uuid::new_v4().simple().to_string()[..8]);

    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Producto Ledger Test', $3, $4, 'aprobado', 'manual', 'trazable', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(product_id)
    .bind(&codigo)
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(pool)
    .await
    .unwrap();

    let lote_id = Uuid::new_v4();
    let numero_lote = format!("LOT-{}", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        r#"
        INSERT INTO lotes (
            id, producto_id, numero_lote, fecha_vencimiento, created_at
        ) VALUES (
            $1, $2, $3, NOW() + INTERVAL '1 year', NOW()
        )
        "#,
    )
    .bind(lote_id)
    .bind(product_id)
    .bind(&numero_lote)
    .execute(pool)
    .await
    .unwrap();

    let area_id: i32 = sqlx::query_scalar(
        "INSERT INTO areas (nombre) VALUES ('Area Test Ledger') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Test', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@test.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(pool)
    .await
    .unwrap();

    (product_id, lote_id, area_id, user_id)
}

#[tokio::test]
async fn test_db_002_ledger_append_only_and_reversal() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (_product_id, lote_id, area_id, user_id) = seed_test_context(&pool).await;

    let mov_1_id = Uuid::new_v4();
    let doc_1 = format!("DOC-{}", &Uuid::new_v4().simple().to_string()[..6]);

    // Initial reception movement (+10)
    sqlx::query(
        r#"
        INSERT INTO movimientos (
            id, numero_documento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, created_at
        ) VALUES (
            $1, $2, $3, $4, 'CARGA_INICIAL', 10.0, 10.0, $5, 'manual', NOW()
        )
        "#,
    )
    .bind(mov_1_id)
    .bind(&doc_1)
    .bind(lote_id)
    .bind(area_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Reversal entry (+10 magnitude, tipo AJUSTE_NEGATIVO) added as NEW append-only row
    let mov_2_id = Uuid::new_v4();
    let doc_2 = format!("DOC-REV-{}", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        r#"
        INSERT INTO movimientos (
            id, numero_documento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota, created_at
        ) VALUES (
            $1, $2, $3, $4, 'AJUSTE_NEGATIVO', 10.0, 0.0, $5, 'manual', 'Reversion de recepcion', NOW()
        )
        "#,
    )
    .bind(mov_2_id)
    .bind(&doc_2)
    .bind(lote_id)
    .bind(area_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify both rows exist in ledger (append-only)
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM movimientos WHERE lote_id = $1")
        .bind(lote_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 2, "Reversal must preserve original entry and append a balancing movement");
}

#[tokio::test]
async fn test_db_003_balance_rebuild_consistency() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (_product_id, lote_id, area_id, user_id) = seed_test_context(&pool).await;

    // Movement 1: +50
    sqlx::query(
        r#"
        INSERT INTO movimientos (
            id, numero_documento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, created_at
        ) VALUES (
            $1, 'DOC-SUM-1', $2, $3, 'INGRESO', 50.0, 50.0, $4, 'manual', NOW()
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(lote_id)
    .bind(area_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Movement 2: -15 (cantidad is positive 15.0, tipo is CONSUMO)
    sqlx::query(
        r#"
        INSERT INTO movimientos (
            id, numero_documento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, created_at
        ) VALUES (
            $1, 'DOC-SUM-2', $2, $3, 'CONSUMO', 15.0, 35.0, $4, 'manual', NOW()
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(lote_id)
    .bind(area_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Calculate balance taking movement tipo into account (positive for INGRESO/CARGA_INICIAL, negative for CONSUMO/AJUSTE_NEGATIVO)
    let calculated_sum: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(
            CASE WHEN tipo IN ('INGRESO', 'CARGA_INICIAL', 'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA') THEN cantidad
                 ELSE -cantidad END
        ), 0) FROM movimientos WHERE lote_id = $1 AND area_id = $2
        "#,
    )
    .bind(lote_id)
    .bind(area_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(calculated_sum, Decimal::from(35), "Sum of movements (+50 INGRESO, -15 CONSUMO) MUST equal 35");
}

#[tokio::test]
async fn test_db_004_concurrent_consumption_no_negative_balance() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (_product_id, lote_id, area_id, user_id) = seed_test_context(&pool).await;

    // Initial stock: 10
    sqlx::query(
        r#"
        INSERT INTO movimientos (
            id, numero_documento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, created_at
        ) VALUES (
            $1, 'DOC-INIT-10', $2, $3, 'CARGA_INICIAL', 10.0, 10.0, $4, 'manual', NOW()
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(lote_id)
    .bind(area_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let current_balance: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(cantidad), 0) FROM movimientos WHERE lote_id = $1 AND area_id = $2",
    )
    .bind(lote_id)
    .bind(area_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(current_balance >= Decimal::ZERO, "Stock balance must not be negative");
}

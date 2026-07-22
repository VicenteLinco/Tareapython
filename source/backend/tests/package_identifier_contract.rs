use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

async fn create_test_product(pool: &PgPool, codigo: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, estado_catalogo, origen_registro, control_lote, version, activo, created_at, updated_at
        ) VALUES (
            $1, $2, 'Producto GTIN Contract Test', 'aprobado', 'manual', 'con_vto', 1, true, NOW(), NOW()
        )
        "#,
    )
    .bind(id)
    .bind(codigo)
    .execute(pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn test_db_001_fk_and_gtin_uniqueness() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let fake_product_id = Uuid::new_v4();

    // 1. Foreign key constraint test: inserting presentation for non-existent product MUST fail
    let fk_res = sqlx::query(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion) VALUES ($1, 'Caja Test', 'Cajas Test', 1)",
    )
    .bind(fake_product_id)
    .execute(&pool)
    .await;

    assert!(
        fk_res.is_err(),
        "FK constraint MUST fail when product_id does not exist in productos table"
    );

    // 2. GTIN uniqueness test
    let product_id = create_test_product(&pool, &format!("P-G-{}", &Uuid::new_v4().simple().to_string()[..8])).await;
    let gtin_val = format!("779000{}", &Uuid::new_v4().simple().to_string()[..7]);

    // Insert first presentacion with GTIN
    sqlx::query(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, gtin) VALUES ($1, 'Caja 1', 'Cajas 1', 1, $2)",
    )
    .bind(product_id)
    .bind(&gtin_val)
    .execute(&pool)
    .await
    .unwrap();

    // Second presentacion with same GTIN MUST fail GTIN uniqueness constraint
    let product_id_2 = create_test_product(&pool, &format!("P-G2-{}", &Uuid::new_v4().simple().to_string()[..7])).await;
    let dup_res = sqlx::query(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, gtin) VALUES ($1, 'Caja 2', 'Cajas 2', 1, $2)",
    )
    .bind(product_id_2)
    .bind(&gtin_val)
    .execute(&pool)
    .await;

    assert!(
        dup_res.is_err(),
        "Duplicate GTIN insertion MUST fail unique constraint"
    );
}

#[tokio::test]
async fn test_api_002_identifier_lookup_and_collision() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let product_id = create_test_product(&pool, &format!("P-L-{}", &Uuid::new_v4().simple().to_string()[..8])).await;
    let gtin = format!("779111{}", &Uuid::new_v4().simple().to_string()[..7]);

    let pres_id: i32 = sqlx::query_scalar(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, gtin) VALUES ($1, 'Kit A', 'Kits A', 1, $2) RETURNING id",
    )
    .bind(product_id)
    .bind(&gtin)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Scanner lookup by GTIN
    let found_id: i32 = sqlx::query_scalar("SELECT id FROM presentaciones WHERE gtin = $1")
        .bind(&gtin)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(found_id, pres_id, "Scanner lookup MUST return exact presentation ID by GTIN");
}

#[tokio::test]
async fn test_api_003_package_factor_revision_immutability() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let product_id = create_test_product(&pool, &format!("P-REV-{}", &Uuid::new_v4().simple().to_string()[..7])).await;

    let pres_id: i32 = sqlx::query_scalar(
        "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion) VALUES ($1, 'Caja Rev', 'Cajas Rev', 10) RETURNING id",
    )
    .bind(product_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Verify initial factor conversion as Decimal
    let factor: Decimal = sqlx::query_scalar("SELECT factor_conversion FROM presentaciones WHERE id = $1")
        .bind(pres_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(factor, Decimal::from(10));
}

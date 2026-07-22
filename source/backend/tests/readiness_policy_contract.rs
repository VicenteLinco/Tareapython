use sqlx::PgPool;
use uuid::Uuid;

#[tokio::test]
async fn test_dom_004_product_readiness_evaluator_and_reasons() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat Readiness') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad R', 'Unidades R') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    // Product 1: Incomplete (missing unidad_base_id and pending approval)
    let p1_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo
        ) VALUES (
            $1, $2, 'Producto Incompleto', $3, NULL, 'pendiente_aprobacion', 'manual', 'trazable', 1, true
        )
        "#,
    )
    .bind(p1_id)
    .bind(format!("P-RD-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(categoria_id)
    .execute(&pool)
    .await
    .unwrap();

    // Query product_readiness view for p1
    let (p1_ready, p1_missing): (bool, Vec<String>) = sqlx::query_as(
        "SELECT inventory_ready, missing_fields FROM product_readiness WHERE producto_id = $1",
    )
    .bind(p1_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(!p1_ready, "Incomplete product must NOT be inventory ready");
    assert!(
        p1_missing.contains(&"unidad_base".to_string()),
        "Missing fields must list unidad_base"
    );

    // Product 2: Complete and approved
    let p2_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo
        ) VALUES (
            $1, $2, 'Producto Listo', $3, $4, 'aprobado', 'manual', 'trazable', 1, true
        )
        "#,
    )
    .bind(p2_id)
    .bind(format!("P-RD-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(&pool)
    .await
    .unwrap();

    let (p2_ready, p2_missing): (bool, Vec<String>) = sqlx::query_as(
        "SELECT inventory_ready, missing_fields FROM product_readiness WHERE producto_id = $1",
    )
    .bind(p2_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(p2_ready, "Approved product with base unit MUST be inventory ready");
    assert!(p2_missing.is_empty(), "Complete product must have no missing fields");
}

#[tokio::test]
async fn test_db_011_012_custom_attributes_schema_and_types() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let def_id = Uuid::new_v4();

    // Create a required text custom attribute definition
    sqlx::query(
        r#"
        INSERT INTO lab_campo_definicion (
            id, nombre, tipo_dato, requerido, activo
        ) VALUES (
            $1, 'Concentracion', 'texto', true, true
        )
        "#,
    )
    .bind(def_id)
    .execute(&pool)
    .await
    .unwrap();

    // Assert invalid tipo_dato choice fails check constraint
    let invalid_res = sqlx::query(
        r#"
        INSERT INTO lab_campo_definicion (
            id, nombre, tipo_dato, requerido, activo
        ) VALUES (
            $1, 'InvalidAttr', 'tipo_invalido', false, true
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await;

    assert!(
        invalid_res.is_err(),
        "lab_campo_definicion must reject invalid tipo_dato values"
    );
}

#[tokio::test]
async fn test_db_013_inventory_policy_uniqueness_and_thresholds() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = PgPool::connect(&db_url).await.unwrap();

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat Policy') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad P', 'Unidades P') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let product_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo
        ) VALUES (
            $1, $2, 'Producto Policy', $3, $4, 'aprobado', 'manual', 'trazable', 1, true
        )
        "#,
    )
    .bind(product_id)
    .bind(format!("P-POL-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(&pool)
    .await
    .unwrap();

    let area_id: i32 = sqlx::query_scalar(
        "INSERT INTO areas (nombre) VALUES ('Area Policy') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .unwrap_or(1);

    // Insert par level config (inventory policy)
    sqlx::query(
        r#"
        INSERT INTO par_level_config (
            producto_id, area_id, stock_minimo, stock_maximo, safety_stock, metodo
        ) VALUES (
            $1, $2, 10.0, 100.0, 5.0, 'manual'
        )
        "#,
    )
    .bind(product_id)
    .bind(area_id)
    .execute(&pool)
    .await
    .unwrap();

    // Verify policy threshold values read back
    let (stock_min, safety): (rust_decimal::Decimal, rust_decimal::Decimal) = sqlx::query_as(
        "SELECT stock_minimo, safety_stock FROM par_level_config WHERE producto_id = $1 AND area_id = $2",
    )
    .bind(product_id)
    .bind(area_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(stock_min, rust_decimal::Decimal::from(10));
    assert_eq!(safety, rust_decimal::Decimal::from(5));
}

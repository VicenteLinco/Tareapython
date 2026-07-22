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

async fn seed_test_receipt_fixtures(pool: &PgPool) -> (Uuid, i32, Uuid, Uuid, i32, i32) {
    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat Receipt') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad Rec', 'Unidades Rec') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let product_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO productos (
            id, codigo_interno, nombre, categoria_id, unidad_base_id, estado_catalogo, origen_registro, control_lote, version, activo
        ) VALUES (
            $1, $2, 'Producto Receipt Atomic', $3, $4, 'aprobado', 'manual', 'trazable', 1, true
        )
        "#,
    )
    .bind(product_id)
    .bind(format!("P-REC-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(pool)
    .await
    .unwrap();

    let lote_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) VALUES ($1, $2, $3, NOW() + INTERVAL '1 year')",
    )
    .bind(lote_id)
    .bind(product_id)
    .bind(format!("LOT-REC-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(pool)
    .await
    .unwrap();

    let proveedor_id: i32 = sqlx::query_scalar(
        "INSERT INTO proveedores (nombre, activa) VALUES ('Proveedor Receipt', true) ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let area_id: i32 = sqlx::query_scalar(
        "INSERT INTO areas (nombre) VALUES ('Area Receipt') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO usuarios (id, email, password_hash, nombre, rol, activo) VALUES ($1, $2, 'hash', 'User Rec', 'admin', true)",
    )
    .bind(user_id)
    .bind(format!("user-{}@rec.com", &Uuid::new_v4().simple().to_string()[..6]))
    .execute(pool)
    .await
    .unwrap();

    (product_id, proveedor_id, lote_id, user_id, area_id, unidad_base_id)
}

#[tokio::test]
async fn test_api_receipt_001_atomic_creation_and_status() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (product_id, prov_id, lote_id, user_id, area_id, _ub_id) = seed_test_receipt_fixtures(&pool).await;

    let receipt_id = Uuid::new_v4();
    let doc_num = format!("REC-{}", &Uuid::new_v4().simple().to_string()[..6]);

    let mut tx = pool.begin().await.unwrap();

    // Insert header
    sqlx::query(
        r#"
        INSERT INTO recepciones (
            id, numero_documento, proveedor_id, estado, fecha_recepcion, usuario_id, created_at
        ) VALUES (
            $1, $2, $3, 'completa', NOW(), $4, NOW()
        )
        "#,
    )
    .bind(receipt_id)
    .bind(&doc_num)
    .bind(prov_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    // Insert detail line
    sqlx::query(
        r#"
        INSERT INTO recepcion_detalle (
            recepcion_id, producto_id, lote_id, area_destino_id, cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario
        ) VALUES (
            $1, $2, $3, $4, 10.0, 1.0, 10.0, 49000.00
        )
        "#,
    )
    .bind(receipt_id)
    .bind(product_id)
    .bind(lote_id)
    .bind(area_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();

    let (status, count): (String, i64) = sqlx::query_as(
        "SELECT r.estado, count(rd.id) FROM recepciones r JOIN recepcion_detalle rd ON rd.recepcion_id = r.id WHERE r.id = $1 GROUP BY r.estado",
    )
    .bind(receipt_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status, "completa");
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_api_receipt_002_total_money_reconciliation() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (product_id, prov_id, lote_id, user_id, area_id, _ub_id) = seed_test_receipt_fixtures(&pool).await;

    let receipt_id = Uuid::new_v4();
    let doc_num = format!("REC-{}", &Uuid::new_v4().simple().to_string()[..6]);

    sqlx::query(
        r#"
        INSERT INTO recepciones (
            id, numero_documento, proveedor_id, estado, fecha_recepcion, usuario_id, created_at
        ) VALUES (
            $1, $2, $3, 'completa', NOW(), $4, NOW()
        )
        "#,
    )
    .bind(receipt_id)
    .bind(&doc_num)
    .bind(prov_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert 10 items @ 49,000.00 each -> Total = 490,000.00
    sqlx::query(
        r#"
        INSERT INTO recepcion_detalle (
            recepcion_id, producto_id, lote_id, area_destino_id, cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario
        ) VALUES (
            $1, $2, $3, $4, 10.0, 1.0, 10.0, 49000.00
        )
        "#,
    )
    .bind(receipt_id)
    .bind(product_id)
    .bind(lote_id)
    .bind(area_id)
    .execute(&pool)
    .await
    .unwrap();

    let total_cost: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(cantidad_presentaciones * precio_unitario), 0) FROM recepcion_detalle WHERE recepcion_id = $1",
    )
    .bind(receipt_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(total_cost, Decimal::from_str_exact("490000.0000").unwrap());
}

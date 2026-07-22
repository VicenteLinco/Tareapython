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

async fn seed_product_and_supplier(pool: &PgPool) -> (Uuid, i32) {
    let categoria_id: i32 = sqlx::query_scalar(
        "INSERT INTO categorias (nombre) VALUES ('Cat Pkg Offer') ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    let unidad_base_id: i32 = sqlx::query_scalar(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Unidad PKG', 'Unidades PKG') ON CONFLICT DO NOTHING RETURNING id",
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
            $1, $2, 'Producto Package Offer Test', $3, $4, 'aprobado', 'manual', 'trazable', 1, true
        )
        "#,
    )
    .bind(product_id)
    .bind(format!("P-PO-{}", &Uuid::new_v4().simple().to_string()[..6]))
    .bind(categoria_id)
    .bind(unidad_base_id)
    .execute(pool)
    .await
    .unwrap();

    let proveedor_id: i32 = sqlx::query_scalar(
        "INSERT INTO proveedores (nombre, activa) VALUES ('Proveedor Test Offer', true) ON CONFLICT DO NOTHING RETURNING id",
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(1);

    (product_id, proveedor_id)
}

#[tokio::test]
async fn test_api_package_001_presentation_factor_and_gtin() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (product_id, _prov_id) = seed_product_and_supplier(&pool).await;

    let gtin_code = format!("7890{}", &Uuid::new_v4().simple().to_string()[..8]);

    // Insert presentation record
    let pres_id: i32 = sqlx::query_scalar(
        r#"
        INSERT INTO presentaciones (
            producto_id, nombre, nombre_plural, factor_conversion, gtin, activa
        ) VALUES (
            $1, 'Caja x 50', 'Cajas x 50', 50.0, $2, true
        ) RETURNING id
        "#,
    )
    .bind(product_id)
    .bind(&gtin_code)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (factor, read_gtin): (Decimal, Option<String>) = sqlx::query_as(
        "SELECT factor_conversion, gtin FROM presentaciones WHERE id = $1",
    )
    .bind(pres_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(factor, Decimal::from(50));
    assert_eq!(read_gtin.unwrap(), gtin_code);
}

#[tokio::test]
async fn test_api_offer_001_supplier_offer_price_binding() {
    let db_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => return,
    };

    let pool = connect_test_pool(&db_url).await;

    inventario_lab_backend::migration_recovery::run_startup_migrations(&pool, false, false)
        .await
        .unwrap();

    let (product_id, prov_id) = seed_product_and_supplier(&pool).await;

    let pres_id: i32 = sqlx::query_scalar(
        r#"
        INSERT INTO presentaciones (
            producto_id, nombre, nombre_plural, factor_conversion, activa
        ) VALUES (
            $1, 'Frasco 100ml', 'Frascos 100ml', 1.0, true
        ) RETURNING id
        "#,
    )
    .bind(product_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Bind supplier offer with price and SKU
    sqlx::query(
        r#"
        INSERT INTO ofertas_proveedor (
            presentacion_id, proveedor_id, precio_adquisicion, sku_proveedor
        ) VALUES (
            $1, $2, 12500.50, 'SKU-PROV-100'
        )
        "#,
    )
    .bind(pres_id)
    .bind(prov_id)
    .execute(&pool)
    .await
    .unwrap();

    let (precio, sku): (Decimal, Option<String>) = sqlx::query_as(
        "SELECT precio_adquisicion, sku_proveedor FROM ofertas_proveedor WHERE presentacion_id = $1 AND proveedor_id = $2",
    )
    .bind(pres_id)
    .bind(prov_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(precio, Decimal::from_str_exact("12500.50").unwrap());
    assert_eq!(sku.unwrap(), "SKU-PROV-100");
}

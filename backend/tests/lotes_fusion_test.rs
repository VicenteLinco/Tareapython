mod common;

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

// Inserta un producto mínimo y devuelve su id.
async fn crear_producto(pool: &PgPool, codigo: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO productos (codigo_interno, nombre, unidad_base_id) \
         VALUES ($1, 'Reactivo fusion', 1) RETURNING id",
    )
    .bind(codigo)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn fusion_lotes_duplicados_suma_stock(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let prod_id = crear_producto(&pool, "PRD-FUS1").await;

    // Soltar la constraint para poder sembrar duplicados (mismo producto + numero_lote).
    sqlx::query("ALTER TABLE lotes DROP CONSTRAINT lotes_producto_numero_lote_key")
        .execute(&pool)
        .await
        .unwrap();

    // Dos lotes, mismo numero_lote y MISMO vencimiento (distinto proveedor en la práctica).
    // El más antiguo es el superviviente.
    let superviviente: Uuid = sqlx::query_scalar(
        "INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, created_at) \
         VALUES ($1, 'LOTE-A', '2027-01-01', NOW() - INTERVAL '2 days') RETURNING id",
    )
    .bind(prod_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let duplicado: Uuid = sqlx::query_scalar(
        "INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, created_at) \
         VALUES ($1, 'LOTE-A', '2027-01-01', NOW()) RETURNING id",
    )
    .bind(prod_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Stock: 10 en el superviviente, 5 en el duplicado, misma área.
    sqlx::query("INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10), ($2, 1, 5)")
        .bind(superviviente)
        .bind(duplicado)
        .execute(&pool)
        .await
        .unwrap();

    let fusionados: i32 = sqlx::query_scalar("SELECT fn_fusionar_lotes_duplicados()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fusionados, 1, "se debe borrar 1 lote duplicado");

    // Queda un solo lote para el producto.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lotes WHERE producto_id = $1")
        .bind(prod_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    // El stock se sumó en el superviviente: 10 + 5 = 15.
    let cantidad: Decimal =
        sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = 1")
            .bind(superviviente)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cantidad, Decimal::new(15, 0));
}

#[sqlx::test(migrations = "./migrations")]
async fn fusion_aborta_si_vencimiento_conflictivo(pool: PgPool) {
    common::seed_base_data(&pool).await;
    let prod_id = crear_producto(&pool, "PRD-FUS2").await;

    sqlx::query("ALTER TABLE lotes DROP CONSTRAINT lotes_producto_numero_lote_key")
        .execute(&pool)
        .await
        .unwrap();

    // Mismo numero_lote pero vencimiento DISTINTO -> no se debe fusionar.
    sqlx::query(
        "INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento) \
         VALUES ($1, 'LOTE-B', '2027-01-01'), ($1, 'LOTE-B', '2028-01-01')",
    )
    .bind(prod_id)
    .execute(&pool)
    .await
    .unwrap();

    let res = sqlx::query_scalar::<_, i32>("SELECT fn_fusionar_lotes_duplicados()")
        .fetch_one(&pool)
        .await;
    assert!(res.is_err(), "la fusión debe abortar ante vencimientos en conflicto");
}

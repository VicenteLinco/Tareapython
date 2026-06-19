use dotenvy::dotenv;
use sqlx::postgres::PgPoolOptions;
use std::env;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let mut database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgres://lab_user:lab_password@localhost:5432/inventario_lab".to_string()
    });
    database_url = database_url.replace("localhost", "127.0.0.1");

    println!("Connecting to database: {}...", database_url);
    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Failed to connect to database: {}", e);
            return Ok(());
        }
    };

    println!("Database connected! Running inspections...\n");

    // 1. Active products with their current total stock.
    let products: Vec<(uuid::Uuid, String, Option<rust_decimal::Decimal>)> = sqlx::query_as(
        "SELECT id, nombre, (SELECT SUM(cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id) as stock_total FROM productos p WHERE activo = true"
    )
    .fetch_all(&pool)
    .await?;

    println!("--- ALL PRODUCTS (with stock_total) ---");
    for (id, name, total) in &products {
        let tot = total.unwrap_or(rust_decimal::Decimal::ZERO);
        if tot > rust_decimal::Decimal::ZERO {
            println!("ID: {}, Name: {}, Total Stock: {}", id, name, tot);
        }
    }
    println!();

    // 2. Active lots and their expiration dates.
    let lots: Vec<(
        String,
        String,
        Option<chrono::NaiveDate>,
        rust_decimal::Decimal,
        String,
    )> = sqlx::query_as(
        "SELECT p.nombre, l.codigo_lote, l.fecha_vencimiento, s.cantidad, a.nombre as area_nombre
         FROM stock s
         JOIN lotes l ON l.id = s.lote_id
         JOIN productos p ON p.id = l.producto_id
         JOIN areas a ON a.id = s.area_id
         WHERE s.cantidad > 0",
    )
    .fetch_all(&pool)
    .await?;

    println!("--- ACTIVE LOTS IN STOCK ---");
    for (prod_name, lot_code, exp_date, qty, area_name) in &lots {
        println!(
            "Product: {}, Lot: {}, Exp: {:?}, Qty: {}, Area: {}",
            prod_name, lot_code, exp_date, qty, area_name
        );
    }
    println!();

    Ok(())
}

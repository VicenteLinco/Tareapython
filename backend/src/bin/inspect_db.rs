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

    // 1. Let's see all products that are active and print their details
    let products: Vec<(uuid::Uuid, String, rust_decimal::Decimal, Option<rust_decimal::Decimal>)> = sqlx::query_as(
        "SELECT id, nombre, stock_minimo, (SELECT SUM(cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id) as stock_total FROM productos p WHERE activo = true"
    )
    .fetch_all(&pool)
    .await?;

    println!("--- ALL PRODUCTS (with stock_minimo and stock_total) ---");
    for (id, name, min, total) in &products {
        let tot = total.unwrap_or(rust_decimal::Decimal::ZERO);
        if *min > rust_decimal::Decimal::ZERO || tot > rust_decimal::Decimal::ZERO {
            println!(
                "ID: {}, Name: {}, Min Stock: {}, Total Stock: {}",
                id, name, min, tot
            );
        }
    }
    println!();

    // 2. Let's see all active lots and their expiration dates
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

    // 3. Let's run the exact alerts query logic and print the results
    let sql = r#"WITH stock_stats AS (
               SELECT
                   p.id as producto_id,
                   COALESCE(SUM(s.cantidad), 0) AS total,
                   MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proxima_fecha_venc,
                   EXISTS (
                       SELECT 1
                       FROM movimientos m
                       JOIN lotes lm ON lm.id = m.lote_id
                       WHERE lm.producto_id = p.id
                   ) AS inicializado
               FROM productos p
               LEFT JOIN lotes l ON l.producto_id = p.id
               LEFT JOIN stock s ON s.lote_id = l.id
               WHERE p.activo = true
               GROUP BY p.id
           ),
           movimiento_stats AS (
               SELECT
                   p.id as producto_id,
                   MAX(m.created_at) AS ultimo_movimiento,
                   (
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0 * 0.7) +
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 23.0 * 0.3)
                   )::DECIMAL AS consumo_diario_ponderado,
                   COUNT(DISTINCT CASE WHEN m.tipo = 'CONSUMO' THEN m.created_at::date END) AS dias_con_consumo,
                   EXTRACT(DAY FROM (NOW() - MIN(m.created_at)))::INT + 1 AS dias_vida_sistema,
                   (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0)::DECIMAL AS consumo_7d
               FROM productos p
               LEFT JOIN lotes l ON l.producto_id = p.id
               LEFT JOIN movimientos m ON m.lote_id = l.id
               GROUP BY p.id
           ),
           stats AS (
               SELECT
                   p.id as producto_id,
                   p.nombre,
                   p.stock_minimo,
                   COALESCE(ss.total, 0) AS total,
                   COALESCE(ss.inicializado, false) AS inicializado,
                   ss.proxima_fecha_venc,
                   ms.ultimo_movimiento,
                   CASE
                       WHEN ms.dias_vida_sistema < 30 THEN
                           COALESCE(ms.consumo_diario_ponderado * (30.0 / NULLIF(ms.dias_vida_sistema, 0)), 0)::NUMERIC(15,4)
                       ELSE COALESCE(ms.consumo_diario_ponderado, 0)::NUMERIC(15,4)
                   END AS consumo_diario_ajustado,
                   ms.dias_con_consumo,
                   (ms.consumo_7d > ms.consumo_diario_ponderado * 3 AND ms.dias_con_consumo > 5) AS es_anomalia
               FROM productos p
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               LEFT JOIN stock_stats ss ON ss.producto_id = p.id
               LEFT JOIN movimiento_stats ms ON ms.producto_id = p.id
               WHERE p.activo = true
           ),
           filtered_alertas AS (
               SELECT
                   producto_id,
                   nombre,
                   total,
                   proxima_fecha_venc,
                   stock_minimo,
                   inicializado,
                   alerta.tipo as tipo_alerta
               FROM stats
               CROSS JOIN LATERAL (
                   SELECT 'vencido' as tipo WHERE proxima_fecha_venc < CURRENT_DATE
                   UNION ALL
                   SELECT 'sin_stock' WHERE inicializado AND total <= 0 AND stock_minimo > 0
                   UNION ALL
                   SELECT 'vence_30d' WHERE proxima_fecha_venc >= CURRENT_DATE AND proxima_fecha_venc <= CURRENT_DATE + INTERVAL '30 days'
                   UNION ALL
                   SELECT 'bajo_minimo' WHERE stock_minimo > 0 AND total < stock_minimo AND total > 0
                   UNION ALL
                   SELECT 'vence_90d' WHERE proxima_fecha_venc > CURRENT_DATE + INTERVAL '30 days' AND proxima_fecha_venc <= CURRENT_DATE + INTERVAL '90 days'
               ) alerta
           )
           SELECT producto_id, nombre, total, proxima_fecha_venc, stock_minimo, inicializado, tipo_alerta
           FROM filtered_alertas
           ORDER BY tipo_alerta"#;

    let alerts_rows: Vec<(
        uuid::Uuid,
        String,
        rust_decimal::Decimal,
        Option<chrono::NaiveDate>,
        rust_decimal::Decimal,
        bool,
        String,
    )> = sqlx::query_as(sql).fetch_all(&pool).await?;

    println!("--- ALERTS RETURNED BY DB ---");
    for (id, name, total, exp, min, init, alert_type) in &alerts_rows {
        println!(
            "ID: {}, Name: {}, Total: {}, Exp: {:?}, Min: {}, Init: {}, Alert: {}",
            id, name, total, exp, min, init, alert_type
        );
    }
    println!();

    Ok(())
}

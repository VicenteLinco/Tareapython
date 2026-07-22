use sqlx::PgPool;
use std::time::Duration;
use tokio::time;
use uuid::Uuid;

/// Inicia el job de auto-descarte que se ejecuta cada 24 horas.
pub async fn start_auto_descarte_job(pool: PgPool) {
    // Ejecutar cada 24 horas. Para pruebas, podrías cambiarlo a menos, pero en producción 24h.
    let mut interval = time::interval(Duration::from_secs(3600 * 24));

    // Primer tick ocurre inmediatamente
    loop {
        interval.tick().await;

        match ejecutar_descarte_vencidos(&pool).await {
            Ok(count) => {
                if count > 0 {
                    tracing::info!(
                        "Auto-descarte: {} lotes vencidos descartados automáticamente",
                        count
                    );
                }
            }
            Err(e) => tracing::error!("Error en job de auto-descarte: {}", e),
        }
    }
}

#[allow(dead_code)]
#[derive(sqlx::FromRow)]
struct VencidoRecord {
    stock_id: i32,
    lote_id: Uuid,
    area_id: i32,
    cantidad: rust_decimal::Decimal,
    producto_nombre: String,
    numero_lote: String,
    area_nombre: String,
}

/// Ejecuta el descarte de lotes vencidos (encuentra lotes donde fecha_vencimiento < CURRENT_DATE)
pub async fn ejecutar_descarte_vencidos(pool: &PgPool) -> Result<u64, sqlx::Error> {
    // Buscar un usuario para asociarle el movimiento (idealmente admin)
    let system_user: Option<Uuid> = sqlx::query_scalar("SELECT id FROM usuarios LIMIT 1")
        .fetch_optional(pool)
        .await?;

    let usuario_id = match system_user {
        Some(u) => u,
        None => return Ok(0), // No hay usuarios, no operamos
    };

    let mut count = 0;
    let mut tx = pool.begin().await?;

    // Buscar stock de lotes vencidos.
    // Usamos SKIP LOCKED para no bloquear si alguien ya está modificando el lote.
    let vencidos = sqlx::query_as::<_, VencidoRecord>(
        r#"
        SELECT 
            s.id as stock_id, 
            s.lote_id, 
            s.area_id, 
            s.cantidad,
            p.nombre as producto_nombre,
            l.numero_lote,
            a.nombre as area_nombre
        FROM stock s
        JOIN lotes l ON l.id = s.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN areas a ON a.id = s.area_id
        WHERE s.cantidad > 0 
          AND l.fecha_vencimiento < CURRENT_DATE
        FOR UPDATE OF s SKIP LOCKED
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    if vencidos.is_empty() {
        tx.rollback().await?;
        return Ok(0);
    }

    let grupo_movimiento = Uuid::new_v4();

    for record in vencidos {
        // El trigger fn_procesar_movimiento_stock calculará cantidad_resultante
        // y actualizará las tablas stock y stock_snapshot
        sqlx::query(
            r#"
            INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, usuario_id, origen, nota)
            VALUES ($1, $2, $3, 'DESCARTE_VENCIDO', $4, $5, 'auto-descarte', 'Descarte automático por vencimiento')
            "#
        )
        .bind(grupo_movimiento)
        .bind(record.lote_id)
        .bind(record.area_id)
        .bind(record.cantidad)
        .bind(usuario_id)
        .execute(&mut *tx)
        .await?;

        // Generar una alerta/notificación para los administradores informando que el stock venció y fue limpiado
        let msg = format!(
            "El lote '{}' del producto '{}' en el área '{}' venció ({} unidades) y fue descartado automáticamente.",
            record.numero_lote, record.producto_nombre, record.area_nombre, record.cantidad
        );

        sqlx::query(
            r#"
            INSERT INTO notificaciones (id, usuario_id, titulo, mensaje, tipo)
            SELECT gen_random_uuid(), id, 'Descarte Automático por Vencimiento', $1, 'auto_descarte_vencido'
            FROM usuarios
            WHERE rol = 'admin' AND deleted_at IS NULL
            "#
        )
        .bind(&msg)
        .execute(&mut *tx)
        .await?;

        count += 1;
    }

    tx.commit().await?;

    Ok(count)
}

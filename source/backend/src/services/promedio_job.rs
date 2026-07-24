use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::time::Duration;
use tokio::time;
use uuid::Uuid;

/// Inicia el job de recalculo de promedio de uso mensual que se ejecuta cada 24 horas.
pub async fn start_promedio_recalculo_job(pool: PgPool) {
    let mut interval = time::interval(Duration::from_secs(3600 * 24));

    loop {
        interval.tick().await;

        match ejecutar_recalculo_promedios(&pool).await {
            Ok(count) => {
                if count > 0 {
                    tracing::info!(
                        "Recalculo de promedio de uso mensual completado para {} productos",
                        count
                    );
                }
            }
            Err(e) => tracing::error!("Error en job de recalculo de promedio: {}", e),
        }
    }
}

#[derive(sqlx::FromRow, Debug)]
struct ProductoRecalculoRecord {
    id: Uuid,
    created_at: DateTime<Utc>,
    promedio_uso_mensual_inicial: Decimal,
    sum_30d: Option<Decimal>,
    has_consumos_ever: bool,
}

/// Ejecuta el cálculo y actualización de promedios para todos los productos
pub async fn ejecutar_recalculo_promedios(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let now = Utc::now();
    let limite_30d = now - chrono::Duration::days(30);

    // Sum of CONSUMO movements for all products in the last 30 days
    // and check if they have any consumption ever
    let records = sqlx::query_as::<_, ProductoRecalculoRecord>(
        r#"
        SELECT 
            p.id,
            p.created_at,
            p.promedio_uso_mensual_inicial,
            COALESCE(SUM(CASE WHEN m.created_at >= $1 THEN m.cantidad END), 0.0) as sum_30d,
            (COUNT(m.id) > 0) as has_consumos_ever
        FROM productos p
        LEFT JOIN lotes l ON l.producto_id = p.id
        LEFT JOIN movimientos m ON m.lote_id = l.id 
            AND m.tipo = 'CONSUMO'
        GROUP BY p.id, p.created_at, p.promedio_uso_mensual_inicial
        "#,
    )
    .bind(limite_30d)
    .fetch_all(pool)
    .await?;

    let mut count = 0;
    let mut tx = pool.begin().await?;

    for record in records {
        let age_secs = now.signed_duration_since(record.created_at).num_seconds();
        let age_days = if age_secs <= 0 {
            Decimal::ZERO
        } else {
            let secs_dec = Decimal::from(age_secs);
            let day_secs_dec = Decimal::from(86400);
            secs_dec / day_secs_dec
        };

        let sum_30d = record.sum_30d.unwrap_or(Decimal::ZERO);
        let promedio_nuevo = calcular_promedio(
            sum_30d,
            record.promedio_uso_mensual_inicial,
            age_days,
            record.has_consumos_ever,
        );

        let stock_minimo_global = (promedio_nuevo / Decimal::from(30)) * Decimal::from(7);

        sqlx::query(
            r#"
            UPDATE productos
            SET promedio_uso_mensual = $1,
                stock_minimo_global = $2,
                updated_at = $3
            WHERE id = $4
            "#,
        )
        .bind(promedio_nuevo)
        .bind(stock_minimo_global.round_dp(2))
        .bind(now)
        .bind(record.id)
        .execute(&mut *tx)
        .await?;

        count += 1;
    }

    tx.commit().await?;
    Ok(count)
}

/// Calcula el promedio de uso mensual ajustado según la edad del producto.
pub fn calcular_promedio(
    sum_30d: Decimal,
    p_initial: Decimal,
    age_days: Decimal,
    has_consumos_ever: bool,
) -> Decimal {
    if !has_consumos_ever {
        return p_initial;
    }

    let zero = Decimal::ZERO;
    let thirty = Decimal::from(30);

    let age_days_capped = if age_days < zero {
        zero
    } else if age_days > thirty {
        thirty
    } else {
        age_days
    };

    if age_days >= thirty {
        sum_30d.round_dp(4)
    } else {
        let decay_factor = Decimal::ONE - (age_days_capped / thirty);
        let blended = sum_30d + (decay_factor * p_initial);
        blended.round_dp(4)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_calcular_promedio_new_product() {
        // Product age: 0 days
        // Sum_30d = 0.0, P_initial = 15.0
        // Expected: 0.0 + (1 - 0/30) * 15.0 = 15.0
        let res = calcular_promedio(dec!(0.0), dec!(15.0), dec!(0.0), true);
        assert_eq!(res, dec!(15.0));

        // Product age: 15 days
        // Sum_30d = 10.0, P_initial = 20.0
        // Expected: 10.0 + (1 - 15/30) * 20.0 = 10.0 + 0.5 * 20.0 = 20.0
        let res = calcular_promedio(dec!(10.0), dec!(20.0), dec!(15.0), true);
        assert_eq!(res, dec!(20.0));
    }

    #[test]
    fn test_calcular_promedio_old_product() {
        // Product age: 30 days
        // Sum_30d = 25.0, P_initial = 100.0
        // Expected: 25.0
        let res = calcular_promedio(dec!(25.0), dec!(100.0), dec!(30.0), true);
        assert_eq!(res, dec!(25.0));

        // Product age: 45 days
        // Sum_30d = 30.0, P_initial = 100.0
        // Expected: 30.0
        let res = calcular_promedio(dec!(30.0), dec!(100.0), dec!(45.0), true);
        assert_eq!(res, dec!(30.0));
    }

    #[test]
    fn test_calcular_promedio_negative_age() {
        // Product age: -5 days (clock skew)
        // Sum_30d = 5.0, P_initial = 10.0
        // Expected: age_days capped at 0, so decay factor is 1
        // 5.0 + (1 - 0) * 10.0 = 15.0
        let res = calcular_promedio(dec!(5.0), dec!(10.0), dec!(-5.0), true);
        assert_eq!(res, dec!(15.0));
    }

    #[test]
    fn test_calcular_promedio_no_movements_ever() {
        // Product age: 45 days, has_consumos_ever = false
        // Sum_30d = 0.0, P_initial = 50.0
        // Expected: 50.0 (kept because there are no movements ever)
        let res = calcular_promedio(dec!(0.0), dec!(50.0), dec!(45.0), false);
        assert_eq!(res, dec!(50.0));
    }
}

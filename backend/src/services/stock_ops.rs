use rust_decimal::Decimal;
use specta::Type;
use uuid::Uuid;

use crate::errors::AppError;

/// Lote disponible para FEFO
#[derive(Debug, sqlx::FromRow)]
pub struct LoteFefo {
    #[allow(dead_code)]
    pub stock_id: i32,
    pub lote_id: Uuid,
    pub cantidad: Decimal,
    pub area_id: i32,
}

/// Distribuye una salida FEFO de forma pura (sin acceso a DB).
/// Retorna `Vec<(lote_id, cantidad_a_tomar)>` en el orden en que deben
/// consumirse los lotes.
///
/// # Errores
/// - `AppError::Validation` si `cantidad_total` es cero o negativo.
/// - `AppError::StockInsuficiente` si la suma de lotes no alcanza `cantidad_total`.
pub fn distribuir_fefo(
    lotes: &[LoteFefo],
    cantidad_total: Decimal,
) -> Result<Vec<(Uuid, Decimal)>, AppError> {
    if cantidad_total <= Decimal::ZERO {
        return Err(AppError::Validation(
            "La cantidad solicitada debe ser mayor a cero".into(),
        ));
    }

    let mut restante = cantidad_total;
    let mut salidas: Vec<(Uuid, Decimal)> = Vec::new();

    for lote in lotes {
        if restante.is_zero() {
            break;
        }
        let tomar = lote.cantidad.min(restante);
        if tomar > Decimal::ZERO {
            restante -= tomar;
            salidas.push((lote.lote_id, tomar));
        }
    }

    if !restante.is_zero() {
        return Err(AppError::StockInsuficiente {
            disponible: cantidad_total - restante,
            solicitado: cantidad_total,
        });
    }

    Ok(salidas)
}

/// Busca lotes con FEFO para un producto en un área, bloqueando los registros (FOR UPDATE).
pub async fn lotes_fefo(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    producto_id: Uuid,
    area_id: i32,
) -> Result<Vec<LoteFefo>, AppError> {
    let lotes = sqlx::query_as::<_, LoteFefo>(
        r#"SELECT s.id as stock_id, s.lote_id, s.cantidad, s.area_id
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1
             AND s.area_id = $2
             AND s.cantidad > 0
             -- No se consume producto vencido: sólo sale por descarte.
             AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
           -- FEFO por vencimiento; los implícitos sin fecha (control_lote='simple')
           -- caen al final y se drenan FIFO por antigüedad de lote.
           ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC
           FOR UPDATE OF s"#,
    )
    .bind(producto_id)
    .bind(area_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(lotes)
}

/// Busca lotes con FEFO para un producto en TODAS las áreas.
pub async fn lotes_fefo_global(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    producto_id: Uuid,
) -> Result<Vec<LoteFefo>, AppError> {
    let lotes = sqlx::query_as::<_, LoteFefo>(
        r#"SELECT s.id as stock_id, s.lote_id, s.cantidad, s.area_id
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1
             AND s.cantidad > 0
             -- No se consume producto vencido: sólo sale por descarte.
             AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
           -- FEFO por vencimiento; los implícitos sin fecha (control_lote='simple')
           -- caen al final y se drenan FIFO por antigüedad de lote.
           ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.created_at ASC
           FOR UPDATE OF s"#,
    )
    .bind(producto_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(lotes)
}

/// Calcula el stock total disponible de un producto en un área
pub fn stock_total(lotes: &[LoteFefo]) -> Decimal {
    lotes.iter().map(|l| l.cantidad).sum()
}

/// Aplica un consumo/salida FEFO: inserta movimientos.
/// La tabla 'stock' y 'cantidad_resultante' se actualizan vía Trigger.
/// Delega la distribución de cantidades a `distribuir_fefo` (lógica pura).
#[allow(clippy::too_many_arguments)]
pub async fn aplicar_salida_fefo(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lotes: &[LoteFefo],
    cantidad_total: Decimal,
    usuario_id: Uuid,
    tipo: &str,
    grupo_movimiento: Uuid,
    nota: Option<&str>,
    origen: Option<&str>,
    destino_area_id: Option<i32>,
) -> Result<Vec<MovimientoGenerado>, AppError> {
    // Calcular distribución pura primero (sin DB)
    let plan = distribuir_fefo(lotes, cantidad_total)?;

    // Crear un índice lote_id → area_id para los inserts
    let area_por_lote: std::collections::HashMap<Uuid, i32> =
        lotes.iter().map(|l| (l.lote_id, l.area_id)).collect();

    let mut movimientos = Vec::new();

    for (lote_id, consumir) in plan {
        let area_id = area_por_lote[&lote_id];
        let mov = sqlx::query_as::<_, MovimientoGenerado>(
            r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, usuario_id, origen, nota, destino_area_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id, numero_documento, cantidad, cantidad_resultante"#,
        )
        .bind(grupo_movimiento)
        .bind(lote_id)
        .bind(area_id)
        .bind(tipo)
        .bind(consumir)
        .bind(usuario_id)
        .bind(origen)
        .bind(nota)
        .bind(destino_area_id)
        .fetch_one(&mut **tx)
        .await?;

        movimientos.push(mov);
    }

    Ok(movimientos)
}

/// Aplica un ingreso: inserta movimiento.
#[allow(clippy::too_many_arguments)]
pub async fn aplicar_ingreso(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lote_id: Uuid,
    area_id: i32,
    cantidad: Decimal,
    usuario_id: Uuid,
    tipo: &str,
    grupo_movimiento: Option<Uuid>,
    nota: Option<&str>,
    origen: Option<&str>,
    destino_area_id: Option<i32>,
) -> Result<MovimientoGenerado, AppError> {
    let mov = sqlx::query_as::<_, MovimientoGenerado>(
        r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, usuario_id, origen, nota, destino_area_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, numero_documento, cantidad, cantidad_resultante"#,
    )
    .bind(grupo_movimiento)
    .bind(lote_id)
    .bind(area_id)
    .bind(tipo)
    .bind(cantidad)
    .bind(usuario_id)
    .bind(origen)
    .bind(nota)
    .bind(destino_area_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(mov)
}

#[derive(Debug, serde::Serialize, sqlx::FromRow, Type)]
pub struct MovimientoGenerado {
    pub id: Uuid,
    pub numero_documento: String,
    pub cantidad: Decimal,
    pub cantidad_resultante: Decimal,
}

/// Verifica que el rol puede mutar stock (consumir, descartar, recibir, ajustar).
///
/// El área dejó de ser una barrera de permiso: es solo una dimensión física/organizativa
/// (para filtrar y reportar). El permiso se decide por rol: `admin` y `tecnologo` operan
/// sobre cualquier área; `consulta` es solo lectura.
pub fn validar_puede_operar_stock(rol: &str) -> Result<(), AppError> {
    if rol == "admin" || rol == "tecnologo" {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "Tu rol no permite modificar el stock".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn make_lote(lote_id: Uuid, cantidad: Decimal) -> LoteFefo {
        LoteFefo {
            stock_id: 1,
            lote_id,
            cantidad,
            area_id: 1,
        }
    }

    // ─── Escenario 1: Un solo lote, cantidad suficiente ─────────────────────
    #[test]
    fn fefo_un_lote_suficiente() {
        let id = Uuid::new_v4();
        let lotes = vec![make_lote(id, dec!(100))];
        let plan = distribuir_fefo(&lotes, dec!(60)).expect("debe distribuir");
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].0, id);
        assert_eq!(plan[0].1, dec!(60));
    }

    // ─── Escenario 2: Varios lotes en orden FEFO ────────────────────────────
    #[test]
    fn fefo_varios_lotes_en_orden() {
        let id1 = Uuid::new_v4(); // primer lote a vencer (más próximo)
        let id2 = Uuid::new_v4();
        let id3 = Uuid::new_v4();
        // Los lotes deben llegar ya ordenados por fecha (como los retorna la DB)
        let lotes = vec![
            make_lote(id1, dec!(30)),
            make_lote(id2, dec!(50)),
            make_lote(id3, dec!(20)),
        ];
        // Pedir 70: debe tomar 30 del primer lote y 40 del segundo
        let plan = distribuir_fefo(&lotes, dec!(70)).expect("debe distribuir");
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0], (id1, dec!(30)));
        assert_eq!(plan[1], (id2, dec!(40)));
    }

    // ─── Escenario 3: Primer lote agotado (cantidad 0) → salta al siguiente ─
    #[test]
    fn fefo_lote_agotado_salta_al_siguiente() {
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        let lotes = vec![
            make_lote(id1, dec!(0)), // agotado: la DB filtra con cantidad > 0,
            // pero si llega con 0, debe ignorarse
            make_lote(id2, dec!(50)),
        ];
        let plan = distribuir_fefo(&lotes, dec!(30)).expect("debe distribuir");
        // Solo debe aparecer el segundo lote
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].0, id2);
        assert_eq!(plan[0].1, dec!(30));
    }

    // ─── Escenario 4: Stock insuficiente ────────────────────────────────────
    #[test]
    fn fefo_stock_insuficiente() {
        let lotes = vec![
            make_lote(Uuid::new_v4(), dec!(10)),
            make_lote(Uuid::new_v4(), dec!(15)),
        ];
        let err = distribuir_fefo(&lotes, dec!(50)).expect_err("debe fallar");
        match err {
            AppError::StockInsuficiente {
                disponible,
                solicitado,
            } => {
                assert_eq!(disponible, dec!(25));
                assert_eq!(solicitado, dec!(50));
            }
            other => panic!("error inesperado: {:?}", other),
        }
    }

    // ─── Escenario 5: Cantidad cero o negativa → error de validación ────────
    #[test]
    fn fefo_cantidad_cero_es_invalida() {
        let lotes = vec![make_lote(Uuid::new_v4(), dec!(100))];
        let err = distribuir_fefo(&lotes, dec!(0)).expect_err("debe fallar con cero");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn fefo_cantidad_negativa_es_invalida() {
        let lotes = vec![make_lote(Uuid::new_v4(), dec!(100))];
        let err = distribuir_fefo(&lotes, dec!(-5)).expect_err("debe fallar con negativo");
        assert!(matches!(err, AppError::Validation(_)));
    }
}

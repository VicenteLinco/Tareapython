use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;

/// Lote disponible para FEFO
#[derive(Debug, sqlx::FromRow)]
pub struct LoteFefo {
    pub stock_id: i32,
    pub lote_id: Uuid,
    pub cantidad: Decimal,
    pub area_id: i32,
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
           ORDER BY l.fecha_vencimiento ASC
           FOR UPDATE OF s"#,
    )
    .bind(producto_id)
    .bind(area_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(lotes)
}

/// Busca lotes con FEFO para un producto en TODAS las áreas (sin filtro de área).
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
           ORDER BY l.fecha_vencimiento ASC
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

/// Aplica un consumo/salida FEFO: resta stock, inserta movimientos.
/// Retorna los movimientos generados (lote_id, cantidad consumida).
pub async fn aplicar_salida_fefo(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lotes: &[LoteFefo],
    cantidad_total: Decimal,
    usuario_id: Uuid,
    tipo: &str,
    grupo_movimiento: Uuid,
    nota: Option<&str>,
    origen: Option<&str>,
) -> Result<Vec<MovimientoGenerado>, AppError> {
    let mut restante = cantidad_total;
    let mut movimientos = Vec::new();

    for lote in lotes {
        if restante <= Decimal::ZERO {
            break;
        }

        let consumir = restante.min(lote.cantidad);
        restante -= consumir;

        // UPDATE stock
        sqlx::query(
            "UPDATE stock SET cantidad = cantidad - $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(consumir)
        .bind(lote.stock_id)
        .execute(&mut **tx)
        .await?;

        // INSERT movimiento con cantidad_resultante calculada en SQL
        let mov = sqlx::query_as::<_, MovimientoGenerado>(
            r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota)
               SELECT $1, $2, $3, $4, $5, s.cantidad, $6, $7, $8
               FROM stock s WHERE s.id = $9
               RETURNING id, numero_documento, cantidad, cantidad_resultante"#,
        )
        .bind(grupo_movimiento)
        .bind(lote.lote_id)
        .bind(lote.area_id)
        .bind(tipo)
        .bind(consumir)
        .bind(usuario_id)
        .bind(origen)
        .bind(nota)
        .bind(lote.stock_id)
        .fetch_one(&mut **tx)
        .await?;

        movimientos.push(mov);
    }

    Ok(movimientos)
}

/// Aplica un ingreso: upsert stock, inserta movimiento.
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
) -> Result<MovimientoGenerado, AppError> {
    // UPSERT stock
    sqlx::query(
        r#"INSERT INTO stock (lote_id, area_id, cantidad)
           VALUES ($1, $2, $3)
           ON CONFLICT (lote_id, area_id)
           DO UPDATE SET cantidad = stock.cantidad + $3, updated_at = NOW()"#,
    )
    .bind(lote_id)
    .bind(area_id)
    .bind(cantidad)
    .execute(&mut **tx)
    .await?;

    // INSERT movimiento
    let mov = sqlx::query_as::<_, MovimientoGenerado>(
        r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota)
           SELECT $1, $2, $3, $4, $5, s.cantidad, $6, $7, $8
           FROM stock s WHERE s.lote_id = $2 AND s.area_id = $3
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
    .fetch_one(&mut **tx)
    .await?;

    Ok(mov)
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct MovimientoGenerado {
    pub id: Uuid,
    pub numero_documento: String,
    pub cantidad: Decimal,
    pub cantidad_resultante: Decimal,
}

/// Valida que el usuario tiene acceso al área
pub async fn validar_acceso_area(
    pool: &PgPool,
    usuario_id: Uuid,
    area_id: i32,
    rol: &str,
) -> Result<(), AppError> {
    // Admin tiene acceso a todas las áreas
    if rol == "admin" {
        return Ok(());
    }

    let tiene_acceso: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM usuario_area WHERE usuario_id = $1 AND area_id = $2)",
    )
    .bind(usuario_id)
    .bind(area_id)
    .fetch_one(pool)
    .await?;

    if !tiene_acceso {
        return Err(AppError::Forbidden("Sin acceso a esta área".into()));
    }

    Ok(())
}

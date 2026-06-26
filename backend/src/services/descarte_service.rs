use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::dto::descarte::{DescarteRequest, DescarteResponse};
use crate::errors::AppError;
use crate::services::stock_ops;

pub async fn procesar_descartes(
    pool: &PgPool,
    req: DescarteRequest,
    usuario_id: Uuid,
    rol: &str,
) -> Result<DescarteResponse, AppError> {
    req.validate()?;

    if req.items.is_empty() {
        return Err(AppError::Validation("items no puede estar vacío".into()));
    }

    // Solo roles operativos mutan stock (el área ya no es barrera de permiso)
    stock_ops::validar_puede_operar_stock(rol)?;

    for item in &req.items {
        if item.cantidad <= Decimal::ZERO {
            return Err(AppError::Validation(
                "La cantidad debe ser mayor a 0".into(),
            ));
        }
    }

    let virtual_discarded_id: Option<i32> =
        sqlx::query_scalar("SELECT id FROM areas WHERE nombre = 'VIRTUAL_DISCARDED'")
            .fetch_optional(pool)
            .await?;

    let mut tx = pool.begin().await?;
    let grupo = Uuid::new_v4();
    let mut movimientos = Vec::new();

    for item in &req.items {
        // Bloquear stock para el lote en el área
        #[derive(sqlx::FromRow)]
        struct StockUpdateRow {
            stock_id: i32,
            cantidad: Decimal,
        }

        let stock = sqlx::query_as::<_, StockUpdateRow>(
            "SELECT id as stock_id, cantidad FROM stock WHERE lote_id = $1 AND area_id = $2 AND cantidad > 0 FOR UPDATE"
        )
        .bind(item.lote_id)
        .bind(item.area_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound("No hay stock de este lote en esta área".into()))?;

        if stock.cantidad < item.cantidad {
            return Err(AppError::StockInsuficiente {
                disponible: stock.cantidad,
                solicitado: item.cantidad,
            });
        }

        let lote_fefo = stock_ops::LoteFefo {
            stock_id: stock.stock_id,
            lote_id: item.lote_id,
            cantidad: stock.cantidad,
            area_id: item.area_id,
        };

        let movs = stock_ops::aplicar_salida_fefo(
            &mut tx,
            &[lote_fefo],
            item.cantidad,
            usuario_id,
            &item.tipo,
            grupo,
            item.nota.as_deref(),
            None,
            virtual_discarded_id,
        )
        .await?;

        movimientos.extend(movs);
    }

    tx.commit().await?;

    Ok(DescarteResponse {
        grupo_movimiento: grupo,
        movimientos,
    })
}

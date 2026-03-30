use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::{validate_text_length, AppError};
use crate::services::idempotency;
use crate::services::stock_ops;

#[derive(Debug, Deserialize)]
struct DescarteRequest {
    items: Vec<DescarteItem>,
}

#[derive(Debug, Deserialize)]
struct DescarteItem {
    lote_id: Uuid,
    area_id: i32,
    cantidad: Decimal,
    tipo: String, // "DESCARTE_VENCIDO" o "DESCARTE_DAÑADO"
    nota: Option<String>,
}

/// POST /api/v1/descartes
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<DescarteRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    if req.items.is_empty() {
        return Err(AppError::Validation("items no puede estar vacío".into()));
    }

    // Validar tipos y longitudes
    for item in &req.items {
        if let Some(ref nota) = item.nota { validate_text_length(nota, "nota", 1000)?; }
        if item.tipo != "DESCARTE_VENCIDO" && item.tipo != "DESCARTE_DAÑADO" {
            return Err(AppError::Validation(
                "tipo debe ser DESCARTE_VENCIDO o DESCARTE_DAÑADO".into(),
            ));
        }
        if item.cantidad <= Decimal::ZERO {
            return Err(AppError::Validation("La cantidad debe ser mayor a 0".into()));
        }
    }

    // Validar acceso a las áreas
    for item in &req.items {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, item.area_id, &claims.rol)
            .await?;
    }

    // Idempotency
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /descartes", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let mut tx = state.pool.begin().await?;
    let grupo = Uuid::new_v4();
    let mut movimientos = Vec::new();

    for item in &req.items {
        // Verificar stock disponible para el lote en el área
        let stock = sqlx::query_as::<_, StockRow>(
            "SELECT id as stock_id, cantidad FROM stock WHERE lote_id = $1 AND area_id = $2 AND cantidad > 0 FOR UPDATE",
        )
        .bind(item.lote_id)
        .bind(item.area_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound(
            "No hay stock de este lote en esta área".into(),
        ))?;

        if stock.cantidad < item.cantidad {
            tx.rollback().await?;
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            return Err(AppError::BusinessLogic(
                format!(
                    "Stock insuficiente. Disponible: {}, solicitado: {}",
                    stock.cantidad, item.cantidad
                ),
                "STOCK_INSUFICIENTE".into(),
            ));
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
            claims.sub,
            &item.tipo,
            grupo,
            item.nota.as_deref(),
            None,
        )
        .await?;

        movimientos.extend(movs);
    }

    tx.commit().await?;

    let response = serde_json::json!({
        "grupo_movimiento": grupo,
        "movimientos": movimientos,
    });

    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Debug, sqlx::FromRow)]
struct StockRow {
    stock_id: i32,
    cantidad: Decimal,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(crear))
}

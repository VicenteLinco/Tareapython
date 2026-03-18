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
struct TransferenciaRequest {
    producto_id: Uuid,
    lote_id: Option<Uuid>,
    area_origen_id: i32,
    area_destino_id: i32,
    cantidad: Decimal,
    nota: Option<String>,
}

/// POST /api/v1/transferencias
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<TransferenciaRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    if req.cantidad <= Decimal::ZERO {
        return Err(AppError::Validation("La cantidad debe ser mayor a 0".into()));
    }
    if let Some(ref nota) = req.nota { validate_text_length(nota, "nota", 1000)?; }
    if req.area_origen_id == req.area_destino_id {
        return Err(AppError::Validation("Área origen y destino deben ser diferentes".into()));
    }

    // Validar acceso al área de origen
    stock_ops::validar_acceso_area(&state.pool, claims.sub, req.area_origen_id, &claims.rol).await?;

    // Idempotency
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) = idempotency::try_claim(&state.pool, &idem_key, "POST /transferencias", claims.sub).await? {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let mut tx = state.pool.begin().await?;
    let grupo = Uuid::new_v4();

    // Salida del área origen
    let movs_salida = if let Some(lote_id) = req.lote_id {
        // Transferencia de un lote específico
        let lote_fefo = stock_ops::lotes_fefo(&mut tx, req.producto_id, req.area_origen_id).await?;
        let lote = lote_fefo.iter().find(|l| l.lote_id == lote_id);

        match lote {
            Some(l) if l.cantidad >= req.cantidad => {
                stock_ops::aplicar_salida_fefo(
                    &mut tx,
                    &[stock_ops::LoteFefo {
                        stock_id: l.stock_id,
                        lote_id: l.lote_id,
                        cantidad: l.cantidad,
                    }],
                    req.cantidad,
                    req.area_origen_id,
                    claims.sub,
                    "TRANSFERENCIA_SALIDA",
                    grupo,
                    req.nota.as_deref(),
                    None,
                )
                .await?
            }
            Some(l) => {
                tx.rollback().await?;
                idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
                return Err(AppError::BusinessLogic(
                    format!("Stock insuficiente en lote. Disponible: {}", l.cantidad),
                    "STOCK_INSUFICIENTE".into(),
                ));
            }
            None => {
                tx.rollback().await?;
                idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
                return Err(AppError::NotFound("Lote no tiene stock en esta área".into()));
            }
        }
    } else {
        // FEFO automático
        let lotes = stock_ops::lotes_fefo(&mut tx, req.producto_id, req.area_origen_id).await?;
        let disponible = stock_ops::stock_total(&lotes);

        if disponible < req.cantidad {
            tx.rollback().await?;
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            return Err(AppError::BusinessLogic(
                "Stock insuficiente".into(),
                "STOCK_INSUFICIENTE".into(),
            ));
        }

        stock_ops::aplicar_salida_fefo(
            &mut tx,
            &lotes,
            req.cantidad,
            req.area_origen_id,
            claims.sub,
            "TRANSFERENCIA_SALIDA",
            grupo,
            req.nota.as_deref(),
            None,
        )
        .await?
    };

    // Entrada al área destino — cada lote que salió, entra en destino
    // Necesitamos saber qué lotes se usaron en la salida
    let lotes_usados = sqlx::query_as::<_, LoteMov>(
        "SELECT lote_id, cantidad FROM movimientos WHERE grupo_movimiento = $1 AND tipo = 'TRANSFERENCIA_SALIDA'",
    )
    .bind(grupo)
    .fetch_all(&mut *tx)
    .await?;

    let mut mov_entrada = None;
    for lm in &lotes_usados {
        let mov = stock_ops::aplicar_ingreso(
            &mut tx,
            lm.lote_id,
            req.area_destino_id,
            lm.cantidad,
            claims.sub,
            "TRANSFERENCIA_ENTRADA",
            Some(grupo),
            req.nota.as_deref(),
            None,
        )
        .await?;
        mov_entrada = Some(mov);
    }

    // Auto-populate producto_area para destino
    sqlx::query(
        "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(req.producto_id)
    .bind(req.area_destino_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let response = serde_json::json!({
        "grupo_movimiento": grupo,
        "movimiento_salida": movs_salida.first(),
        "movimiento_entrada": mov_entrada,
    });

    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Debug, sqlx::FromRow)]
struct LoteMov {
    lote_id: Uuid,
    cantidad: Decimal,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(crear))
}

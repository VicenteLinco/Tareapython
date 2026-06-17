use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::{AppError, validate_text_length};
use crate::services::idempotency;
use crate::services::stock_ops;
use crate::services::consumo_service::{ConsumoService, ConsumoParams, ConsumoBatchParams, ConsumoBatchItemParams};

#[derive(Debug, Deserialize)]
struct ConsumoRequest {
    producto_id: Uuid,
    area_id: i32,
    cantidad: Decimal,
    unidad: String, // "base" o "presentacion"
    presentacion_id: Option<i32>,
    nota: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConsumoBatchRequest {
    area_id: Option<i32>,
    items: Vec<ConsumoBatchItem>,
    nota: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConsumoBatchItem {
    producto_id: Uuid,
    cantidad: Decimal,
    unidad: String,
    presentacion_id: Option<i32>,
    area_id: Option<i32>,  // NEW: per-item area override
    lote_id: Option<Uuid>, // NEW: specific lote override (bypasses FEFO)
}

/// POST /api/v1/consumos — Consumo individual con FEFO
async fn consumo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<ConsumoRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    // Validar longitud de campos de texto
    if let Some(ref nota) = req.nota {
        validate_text_length(nota, "nota", 1000)?;
    }
    validate_text_length(&req.unidad, "unidad", 50)?;

    // Validar acceso al área
    stock_ops::validar_acceso_area(&state.pool, claims.sub, req.area_id, &claims.rol).await?;

    // Idempotency
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /consumos", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let params = ConsumoParams {
        producto_id: req.producto_id,
        area_id: req.area_id,
        cantidad: req.cantidad,
        unidad: req.unidad,
        presentacion_id: req.presentacion_id,
        nota: req.nota,
    };

    match ConsumoService::registrar_consumo(&state.pool, params, claims.sub).await {
        Ok(response) => {
            idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;
            Ok((StatusCode::CREATED, Json(response)))
        }
        Err(err) => {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            Err(err)
        }
    }
}

/// POST /api/v1/consumos/batch — Consumo masivo, todo o nada
async fn consumo_batch(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<ConsumoBatchRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    if req.items.is_empty() {
        return Err(AppError::Validation("items no puede estar vacío".into()));
    }

    // Validar acceso a TODOS los área_id mencionados (global + por ítem), deduplicados
    {
        let mut areas_a_validar: std::collections::HashSet<i32> = std::collections::HashSet::new();
        if let Some(a) = req.area_id {
            areas_a_validar.insert(a);
        }
        for item in &req.items {
            if let Some(a) = item.area_id {
                areas_a_validar.insert(a);
            }
        }
        for area_id in areas_a_validar {
            stock_ops::validar_acceso_area(&state.pool, claims.sub, area_id, &claims.rol).await?;
        }
    }

    // Idempotency
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /consumos/batch", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let params = ConsumoBatchParams {
        area_id: req.area_id,
        items: req
            .items
            .into_iter()
            .map(|item| ConsumoBatchItemParams {
                producto_id: item.producto_id,
                cantidad: item.cantidad,
                unidad: item.unidad,
                presentacion_id: item.presentacion_id,
                area_id: item.area_id,
                lote_id: item.lote_id,
            })
            .collect(),
        nota: req.nota,
    };

    match ConsumoService::registrar_consumo_batch(&state.pool, params, claims.sub).await {
        Ok(response) => {
            idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;
            Ok((StatusCode::CREATED, Json(response)))
        }
        Err(err) => {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            Err(err)
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(consumo))
        .route("/batch", post(consumo_batch))
}

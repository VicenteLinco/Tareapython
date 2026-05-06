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

/// Convierte cantidad a unidades base si se especificó presentación
async fn convertir_a_base(
    pool: &sqlx::PgPool,
    producto_id: Uuid,
    cantidad: Decimal,
    unidad: &str,
    presentacion_id: Option<i32>,
) -> Result<Decimal, AppError> {
    if unidad == "presentacion" {
        let pres_id = presentacion_id.ok_or(AppError::Validation(
            "presentacion_id es requerido cuando unidad = 'presentacion'".into(),
        ))?;

        let factor: Decimal = sqlx::query_scalar(
            "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND producto_id = $2 AND activa = true",
        )
        .bind(pres_id)
        .bind(producto_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::Validation(format!(
            "La presentación {} no pertenece al producto {}",
            pres_id, producto_id
        )))?;

        Ok(cantidad * factor)
    } else {
        Ok(cantidad)
    }
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

    // Convertir a unidades base
    let cantidad_base = convertir_a_base(
        &state.pool,
        req.producto_id,
        req.cantidad,
        &req.unidad,
        req.presentacion_id,
    )
    .await?;
    if cantidad_base <= Decimal::ZERO {
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
        return Err(AppError::Validation(
            "La cantidad debe ser mayor a 0".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    // FEFO: obtener lotes disponibles
    let lotes = stock_ops::lotes_fefo(&mut tx, req.producto_id, req.area_id).await?;
    let disponible = stock_ops::stock_total(&lotes);

    if disponible < cantidad_base {
        tx.rollback().await?;
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;

        return Err(AppError::BusinessLogic(
            "Stock insuficiente".into(),
            "STOCK_INSUFICIENTE".into(),
        ));
    }

    let grupo = Uuid::new_v4();
    let movimientos = stock_ops::aplicar_salida_fefo(
        &mut tx,
        &lotes,
        cantidad_base,
        claims.sub,
        "CONSUMO",
        grupo,
        req.nota.as_deref(),
        None,
    )
    .await?;

    // Calcular stock restante
    let stock_restante: Option<Decimal> = sqlx::query_scalar(
        r#"SELECT SUM(s.cantidad) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE l.producto_id = $1 AND s.area_id = $2 AND s.cantidad > 0"#,
    )
    .bind(req.producto_id)
    .bind(req.area_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let response = serde_json::json!({
        "grupo_movimiento": grupo,
        "movimientos": movimientos,
        "stock_restante_area": stock_restante.unwrap_or(Decimal::ZERO),
    });

    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
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

    // Validar acceso al área (solo si se especificó área)
    if let Some(area_id) = req.area_id {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, area_id, &claims.rol).await?;
    }

    // Idempotency
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /consumos/batch", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    // Convertir todas las cantidades a base
    let mut item_pairs: Vec<(&ConsumoBatchItem, Decimal)> = Vec::with_capacity(req.items.len());
    for item in &req.items {
        let cantidad = convertir_a_base(
            &state.pool,
            item.producto_id,
            item.cantidad,
            &item.unidad,
            item.presentacion_id,
        )
        .await?;
        if cantidad <= Decimal::ZERO {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            return Err(AppError::Validation(
                "Todas las cantidades deben ser mayor a 0".into(),
            ));
        }
        item_pairs.push((item, cantidad));
    }

    // ORDENAR por producto_id para evitar deadlocks en base de datos al hacer FOR UPDATE
    item_pairs.sort_by_key(|(item, _)| item.producto_id);

    let mut tx = state.pool.begin().await?;
    let grupo = Uuid::new_v4();

    // Fase 1: validar stock de todos los items
    let mut items_fallidos = Vec::new();
    let mut lotes_por_item = Vec::new();

    for (item, cantidad) in &item_pairs {
        let effective_area_id = item.area_id.or(req.area_id);

        let lotes = if let Some(lote_id) = item.lote_id {
            // Pinned lote: validate it exists and has enough stock
            let pinned = sqlx::query_as::<_, stock_ops::LoteFefo>(
                r#"SELECT s.id as stock_id, s.lote_id, s.cantidad, s.area_id
                   FROM stock s
                   WHERE s.lote_id = $1
                     AND ($2::integer IS NULL OR s.area_id = $2)
                     AND s.cantidad > 0
                   LIMIT 1"#,
            )
            .bind(lote_id)
            .bind(effective_area_id)
            .fetch_optional(&mut *tx)
            .await?;
            match pinned {
                Some(l) => vec![l],
                None => {
                    tx.rollback().await?;
                    idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
                    return Err(AppError::Validation(format!(
                        "Lote {} no tiene stock disponible en el área indicada",
                        lote_id
                    )));
                }
            }
        } else {
            match effective_area_id {
                Some(area_id) => stock_ops::lotes_fefo(&mut tx, item.producto_id, area_id).await?,
                None => stock_ops::lotes_fefo_global(&mut tx, item.producto_id).await?,
            }
        };

        let disponible = stock_ops::stock_total(&lotes);

        if disponible < *cantidad {
            let nombre: Option<String> =
                sqlx::query_scalar("SELECT nombre FROM productos WHERE id = $1")
                    .bind(item.producto_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            items_fallidos.push(serde_json::json!({
                "producto_id": item.producto_id,
                "producto": nombre.unwrap_or_default(),
                "stock_disponible": disponible,
                "cantidad_pedida": cantidad,
            }));
        }
        lotes_por_item.push(lotes);
    }

    if !items_fallidos.is_empty() {
        tx.rollback().await?;
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
        return Err(AppError::BusinessLogic(
            "Stock insuficiente en uno o más items".into(),
            "STOCK_INSUFICIENTE_BATCH".into(),
        ));
    }

    // Fase 2: aplicar todos los consumos
    let mut total_movimientos = 0u32;
    let mut resumen = Vec::new();

    for (i, (item, cantidad)) in item_pairs.iter().enumerate() {
        let effective_area_id = item.area_id.or(req.area_id);
        let movs = stock_ops::aplicar_salida_fefo(
            &mut tx,
            &lotes_por_item[i],
            *cantidad,
            claims.sub,
            "CONSUMO",
            grupo,
            req.nota.as_deref(),
            None,
        )
        .await?;

        total_movimientos += movs.len() as u32;

        let stock_restante: Option<Decimal> = match effective_area_id {
            Some(area_id) => {
                sqlx::query_scalar(
                    r#"SELECT SUM(s.cantidad) FROM stock s
                   JOIN lotes l ON l.id = s.lote_id
                   WHERE l.producto_id = $1 AND s.area_id = $2 AND s.cantidad > 0"#,
                )
                .bind(item.producto_id)
                .bind(area_id)
                .fetch_optional(&mut *tx)
                .await?
            }
            None => {
                sqlx::query_scalar(
                    r#"SELECT SUM(s.cantidad) FROM stock s
                   JOIN lotes l ON l.id = s.lote_id
                   WHERE l.producto_id = $1 AND s.cantidad > 0"#,
                )
                .bind(item.producto_id)
                .fetch_optional(&mut *tx)
                .await?
            }
        };

        resumen.push(serde_json::json!({
            "producto_id": item.producto_id,
            "movimientos": movs.len(),
            "stock_restante": stock_restante,
        }));
    }

    tx.commit().await?;

    let response = serde_json::json!({
        "grupo_movimiento": grupo,
        "movimientos_generados": total_movimientos,
        "resumen": resumen,
    });

    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(consumo))
        .route("/batch", post(consumo_batch))
}

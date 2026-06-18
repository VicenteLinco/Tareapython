use axum::extract::{Path, State};
use axum::{Extension, Json};
use rust_decimal::Decimal;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::par_level::{ParLevelResponse, UpsertParLevelRequest};
use crate::errors::AppError;

/// GET /api/v1/productos/:id/par-level
///
/// Returns the global par level configuration for a product (area_id IS NULL).
/// Falls back to productos.stock_minimo if no par_level_config row exists yet.
pub async fn get_par_level(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(producto_id): Path<Uuid>,
) -> Result<Json<ParLevelResponse>, AppError> {
    // Try par_level_config first
    let row = sqlx::query_as::<_, ParLevelRow>(
        r#"SELECT
               plc.producto_id,
               plc.area_id,
               plc.stock_minimo,
               plc.stock_maximo,
               plc.safety_stock,
               plc.metodo,
               plc.horizonte_calculo_dias,
               plc.lead_time_dias
           FROM par_level_config plc
           WHERE plc.producto_id = $1 AND plc.area_id IS NULL"#,
    )
    .bind(producto_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(r) = row {
        return Ok(Json(ParLevelResponse {
            producto_id: r.producto_id,
            area_id: r.area_id,
            stock_minimo: r.stock_minimo,
            stock_maximo: r.stock_maximo,
            safety_stock: r.safety_stock,
            metodo: r.metodo,
            horizonte_calculo_dias: r.horizonte_calculo_dias,
            lead_time_dias: r.lead_time_dias,
        }));
    }

    // Fall back to productos.stock_minimo
    let fallback: Option<(Decimal,)> =
        sqlx::query_as("SELECT stock_minimo FROM productos WHERE id = $1 AND deleted_at IS NULL")
            .bind(producto_id)
            .fetch_optional(&state.pool)
            .await?;

    let stock_minimo = fallback
        .map(|(v,)| v)
        .ok_or_else(|| AppError::NotFound("Producto not found".into()))?;

    Ok(Json(ParLevelResponse {
        producto_id,
        area_id: None,
        stock_minimo,
        stock_maximo: None,
        safety_stock: Decimal::ZERO,
        metodo: "manual".into(),
        horizonte_calculo_dias: Some(90),
        lead_time_dias: None,
    }))
}

/// PUT /api/v1/productos/:id/par-level
///
/// Creates or updates the global par level configuration for a product
/// (area_id from request body, defaults to NULL = global).
pub async fn upsert_par_level(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(producto_id): Path<Uuid>,
    Json(req): Json<UpsertParLevelRequest>,
) -> Result<Json<ParLevelResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let metodo = req.metodo.as_deref().unwrap_or("manual");
    if metodo != "manual" && metodo != "auto_consumo" {
        return Err(AppError::Validation(
            "metodo must be 'manual' or 'auto_consumo'".into(),
        ));
    }

    let safety_stock = req.safety_stock.unwrap_or(Decimal::ZERO);

    sqlx::query(
        r#"INSERT INTO par_level_config
               (producto_id, area_id, stock_minimo, stock_maximo, safety_stock,
                metodo, horizonte_calculo_dias, lead_time_dias, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (producto_id, area_id) DO UPDATE SET
               stock_minimo            = EXCLUDED.stock_minimo,
               stock_maximo            = EXCLUDED.stock_maximo,
               safety_stock            = EXCLUDED.safety_stock,
               metodo                  = EXCLUDED.metodo,
               horizonte_calculo_dias  = EXCLUDED.horizonte_calculo_dias,
               lead_time_dias          = EXCLUDED.lead_time_dias,
               updated_by              = EXCLUDED.updated_by,
               updated_at              = now(),
               version                 = par_level_config.version + 1"#,
    )
    .bind(producto_id)
    .bind(req.area_id)
    .bind(req.stock_minimo)
    .bind(req.stock_maximo)
    .bind(safety_stock)
    .bind(metodo)
    .bind(req.horizonte_calculo_dias)
    .bind(req.lead_time_dias)
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(ParLevelResponse {
        producto_id,
        area_id: req.area_id,
        stock_minimo: req.stock_minimo,
        stock_maximo: req.stock_maximo,
        safety_stock,
        metodo: metodo.into(),
        horizonte_calculo_dias: req.horizonte_calculo_dias,
        lead_time_dias: req.lead_time_dias,
    }))
}

/// POST /api/v1/par-levels/recalculate
///
/// Recalculates stock_minimo for all par_level_config rows where
/// metodo = 'auto_consumo'. Uses average daily consumption from movimientos
/// over the configured horizonte_calculo_dias window.
pub async fn recalculate_par_levels(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // For each auto_consumo row, compute avg_daily * lead_time_dias
    let updated: (i64,) = sqlx::query_as(
        r#"WITH avg_consumo AS (
               SELECT
                   plc.id,
                   plc.lead_time_dias,
                   COALESCE(
                       SUM(m.cantidad)::NUMERIC /
                       GREATEST(plc.horizonte_calculo_dias, 1),
                       0
                   ) AS avg_daily
               FROM par_level_config plc
               LEFT JOIN lotes l ON l.producto_id = plc.producto_id
               LEFT JOIN movimientos m ON m.lote_id = l.id
                   AND m.tipo = 'CONSUMO'
                   AND m.created_at >= now() - (plc.horizonte_calculo_dias * INTERVAL '1 day')
               WHERE plc.metodo = 'auto_consumo'
               GROUP BY plc.id, plc.lead_time_dias
           ),
           upd AS (
               UPDATE par_level_config plc
               SET
                   stock_minimo = ROUND(ac.avg_daily * COALESCE(ac.lead_time_dias, 7), 2),
                   updated_at   = now()
               FROM avg_consumo ac
               WHERE ac.id = plc.id
               RETURNING plc.id
           )
           SELECT COUNT(*) FROM upd"#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "updated": updated.0 })))
}

// --- Internal row struct for sqlx deserialization ---

#[derive(sqlx::FromRow)]
struct ParLevelRow {
    producto_id: Uuid,
    area_id: Option<i32>,
    stock_minimo: Decimal,
    stock_maximo: Option<Decimal>,
    safety_stock: Decimal,
    metodo: String,
    horizonte_calculo_dias: Option<i32>,
    lead_time_dias: Option<i32>,
}

use axum::{
    extract::{Query, State},
    routing::get,
    Extension, Json, Router,
};
use chrono::{Duration, NaiveDate, Utc};

use crate::{
    auth::models::Claims,
    db::AppState,
    dto::reportes::{ConsumoAreaRow, ReporteParams, TopDescartadoRow},
    errors::AppError,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/consumo-area", get(consumo_por_area))
        .route("/top-descartados", get(top_descartados))
}

fn parse_rango(params: &ReporteParams) -> (NaiveDate, NaiveDate) {
    let hasta = params
        .hasta
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Utc::now().date_naive());
    let desde = params
        .desde
        .as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| hasta - Duration::days(90));
    (desde, hasta)
}

async fn consumo_por_area(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<ConsumoAreaRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);

    let rows = sqlx::query_as::<_, ConsumoAreaRow>(
        r#"
        SELECT
            a.id AS area_id,
            a.nombre AS area_nombre,
            TO_CHAR(DATE_TRUNC('month', m.created_at), 'YYYY-MM') AS mes,
            CAST(SUM(ABS(m.cantidad)) AS FLOAT8) AS total_consumido,
            COUNT(DISTINCT l.producto_id) AS unidades_distintas,
            COUNT(*) AS movimientos_count
        FROM movimientos m
        JOIN lotes l ON l.id = m.lote_id
        JOIN areas a ON a.id = m.area_id
        WHERE m.tipo = 'CONSUMO'
          AND m.created_at::date >= $1
          AND m.created_at::date <= $2
        GROUP BY a.id, a.nombre, DATE_TRUNC('month', m.created_at)
        ORDER BY mes DESC, total_consumido DESC
        "#,
    )
    .bind(desde)
    .bind(hasta)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn top_descartados(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<TopDescartadoRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);
    let limit = params.limit.unwrap_or(20).clamp(1, 100);

    let rows = sqlx::query_as::<_, TopDescartadoRow>(
        r#"
        SELECT
            p.id::text AS producto_id,
            p.nombre AS producto_nombre,
            CAST(SUM(ABS(m.cantidad)) AS FLOAT8) AS total_descartado,
            ub.nombre AS unidad,
            COUNT(*) AS movimientos_count
        FROM movimientos m
        JOIN lotes l ON l.id = m.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE m.tipo IN ('DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')
          AND m.created_at::date >= $1
          AND m.created_at::date <= $2
        GROUP BY p.id, p.nombre, ub.nombre
        ORDER BY total_descartado DESC
        LIMIT $3
        "#,
    )
    .bind(desde)
    .bind(hasta)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

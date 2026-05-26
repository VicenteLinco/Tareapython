use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    routing::get,
};
use chrono::{Duration, NaiveDate, Utc};

use crate::{
    auth::models::Claims,
    db::AppState,
    dto::reportes::{
        ConsumoAreaRow, ConsumoCalendarioRow, ConsumoProductoRow, ReporteParams, TopDescartadoRow,
    },
    errors::AppError,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/consumo-area", get(consumo_por_area))
        .route("/consumo-calendario", get(consumo_calendario))
        .route("/consumo-productos", get(consumo_productos))
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
    Extension(claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<ConsumoAreaRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);
    if claims.rol != "admin" && claims.area_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let area_filter = if claims.rol == "admin" {
        ""
    } else {
        "AND m.area_id = ANY($3)"
    };

    let sql = format!(
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
          {}
        GROUP BY a.id, a.nombre, DATE_TRUNC('month', m.created_at)
        ORDER BY mes DESC, total_consumido DESC
        "#,
        area_filter
    );

    let mut query = sqlx::query_as::<_, ConsumoAreaRow>(&sql)
        .bind(desde)
        .bind(hasta);
    if claims.rol != "admin" {
        query = query.bind(claims.area_ids.clone());
    }

    Ok(Json(query.fetch_all(&state.pool).await?))
}

async fn top_descartados(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<TopDescartadoRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);
    let limit = params.limit.unwrap_or(20).clamp(1, 100);
    if claims.rol != "admin" && claims.area_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let area_filter = if claims.rol == "admin" {
        ""
    } else {
        "AND m.area_id = ANY($6)"
    };

    let sql = format!(
        r#"
        SELECT
            p.id::text AS producto_id,
            p.nombre AS producto_nombre,
            CAST(SUM(ABS(m.cantidad)) AS FLOAT8) AS total_descartado,
            ub.nombre AS unidad,
            ub.nombre_plural AS unidad_plural,
            COUNT(*) AS movimientos_count
        FROM movimientos m
        JOIN lotes l ON l.id = m.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE m.tipo IN ('DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')
          AND m.created_at::date >= $1
          AND m.created_at::date <= $2
          AND ($4::int IS NULL OR m.area_id = $4)
          AND ($5::uuid IS NULL OR p.id = $5)
          {}
        GROUP BY p.id, p.nombre, ub.nombre, ub.nombre_plural
        ORDER BY total_descartado DESC
        LIMIT $3
        "#,
        area_filter
    );

    let producto_id = params
        .producto_id
        .as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());
    let mut query = sqlx::query_as::<_, TopDescartadoRow>(&sql)
        .bind(desde)
        .bind(hasta)
        .bind(limit)
        .bind(params.area_id)
        .bind(producto_id);
    if claims.rol != "admin" {
        query = query.bind(claims.area_ids.clone());
    }

    Ok(Json(query.fetch_all(&state.pool).await?))
}

async fn consumo_calendario(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<ConsumoCalendarioRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);
    let limit = params.limit.unwrap_or(300).clamp(1, 1000);
    if claims.rol != "admin" && claims.area_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let area_filter = if claims.rol == "admin" {
        ""
    } else {
        "AND m.area_id = ANY($6)"
    };

    let sql = format!(
        r#"
        SELECT
            TO_CHAR(m.created_at::date, 'YYYY-MM-DD') AS fecha,
            a.id AS area_id,
            a.nombre AS area_nombre,
            p.id::text AS producto_id,
            p.nombre AS producto_nombre,
            CAST(SUM(m.cantidad) AS FLOAT8) AS total_consumido,
            ub.nombre AS unidad,
            ub.nombre_plural AS unidad_plural,
            COUNT(*)::bigint AS movimientos_count,
            TO_CHAR(MAX(m.created_at), 'HH24:MI') AS ultimo_consumo
        FROM movimientos m
        JOIN lotes l ON l.id = m.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN areas a ON a.id = m.area_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE m.tipo = 'CONSUMO'
          AND m.created_at::date >= $1
          AND m.created_at::date <= $2
          AND ($3::int IS NULL OR m.area_id = $3)
          AND ($4::uuid IS NULL OR p.id = $4)
          {}
        GROUP BY m.created_at::date, a.id, a.nombre, p.id, p.nombre, ub.nombre, ub.nombre_plural
        ORDER BY m.created_at::date DESC, a.nombre ASC, total_consumido DESC
        LIMIT $5
        "#,
        area_filter
    );

    let producto_id = params
        .producto_id
        .as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());
    let mut query = sqlx::query_as::<_, ConsumoCalendarioRow>(&sql)
        .bind(desde)
        .bind(hasta)
        .bind(params.area_id)
        .bind(producto_id)
        .bind(limit);
    if claims.rol != "admin" {
        query = query.bind(claims.area_ids.clone());
    }

    Ok(Json(query.fetch_all(&state.pool).await?))
}

async fn consumo_productos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ReporteParams>,
) -> Result<Json<Vec<ConsumoProductoRow>>, AppError> {
    let (desde, hasta) = parse_rango(&params);
    let limit = params.limit.unwrap_or(50).clamp(1, 200);
    if claims.rol != "admin" && claims.area_ids.is_empty() {
        return Ok(Json(Vec::new()));
    }

    let area_filter = if claims.rol == "admin" {
        ""
    } else {
        "AND m.area_id = ANY($6)"
    };

    let sql = format!(
        r#"
        SELECT
            p.id::text AS producto_id,
            p.nombre AS producto_nombre,
            CAST(SUM(m.cantidad) AS FLOAT8) AS total_consumido,
            ub.nombre AS unidad,
            ub.nombre_plural AS unidad_plural,
            COUNT(DISTINCT m.created_at::date)::bigint AS dias_uso,
            COUNT(DISTINCT m.area_id)::bigint AS areas_distintas,
            COUNT(*)::bigint AS movimientos_count,
            TO_CHAR(MAX(m.created_at), 'YYYY-MM-DD HH24:MI') AS ultimo_consumo
        FROM movimientos m
        JOIN lotes l ON l.id = m.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE m.tipo = 'CONSUMO'
          AND m.created_at::date >= $1
          AND m.created_at::date <= $2
          AND ($3::int IS NULL OR m.area_id = $3)
          AND ($4::uuid IS NULL OR p.id = $4)
          {}
        GROUP BY p.id, p.nombre, ub.nombre, ub.nombre_plural
        ORDER BY total_consumido DESC
        LIMIT $5
        "#,
        area_filter
    );

    let producto_id = params
        .producto_id
        .as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());
    let mut query = sqlx::query_as::<_, ConsumoProductoRow>(&sql)
        .bind(desde)
        .bind(hasta)
        .bind(params.area_id)
        .bind(producto_id)
        .bind(limit);
    if claims.rol != "admin" {
        query = query.bind(claims.area_ids.clone());
    }

    Ok(Json(query.fetch_all(&state.pool).await?))
}

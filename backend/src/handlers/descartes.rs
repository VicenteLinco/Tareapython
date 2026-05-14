use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::descarte::DescarteRequest;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;
use crate::services::{descarte_service, idempotency};

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<DescarteRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    // Idempotencia
    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /descartes", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    // Procesar descartes vía servicio
    let response =
        match descarte_service::procesar_descartes(&state.pool, req, claims.sub, &claims.rol).await
        {
            Ok(res) => res,
            Err(e) => {
                idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
                return Err(e);
            }
        };

    let res_json =
        serde_json::to_value(&response).map_err(|e| AppError::Internal(e.to_string()))?;
    idempotency::save_response(&state.pool, &idem_key, 201, &res_json).await?;

    Ok((StatusCode::CREATED, Json(res_json)))
}

#[derive(Debug, Deserialize)]
struct DescartesQuery {
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    area_id: Option<i32>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, sqlx::FromRow)]
struct DescarteSessionRow {
    grupo_movimiento: Uuid,
    fecha: DateTime<Utc>,
    usuario_nombre: String,
    total_items: i64,
    areas: Vec<String>,
    items: serde_json::Value,
    total_count: i64,
}

async fn listar(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<DescartesQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec![
        "m.tipo IN ('DESCARTE_VENCIDO', 'DESCARTE_DAÑADO')".to_string(),
        "m.grupo_movimiento IS NOT NULL".to_string(),
    ];
    let mut param_idx = 0u32;

    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "m.created_at < ${}::date + INTERVAL '1 day'",
            param_idx
        ));
    }
    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.area_id = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
        r#"WITH session_data AS (
               SELECT
                   m.grupo_movimiento,
                   MIN(m.created_at) AS fecha,
                   MIN(u.nombre) AS usuario_nombre,
                   COUNT(*)::bigint AS total_items,
                   ARRAY_AGG(DISTINCT a.nombre ORDER BY a.nombre) AS areas,
                   JSON_AGG(
                       JSON_BUILD_OBJECT(
                           'producto_nombre', p.nombre,
                           'codigo_lote', l.numero_lote,
                           'area_nombre', a.nombre,
                           'tipo', m.tipo,
                           'cantidad', m.cantidad,
                           'unidad_base_nombre', um.nombre,
                           'unidad_base_nombre_plural', um.nombre_plural,
                           'fecha_vencimiento', l.fecha_vencimiento,
                           'nota', m.nota
                       ) ORDER BY m.created_at ASC
                   ) AS items
               FROM movimientos m
               JOIN lotes l ON l.id = m.lote_id
               JOIN productos p ON p.id = l.producto_id
               JOIN areas a ON a.id = m.area_id
               JOIN usuarios u ON u.id = m.usuario_id
               JOIN unidades_basicas um ON um.id = p.unidad_base_id
               WHERE {}
               GROUP BY m.grupo_movimiento
           ),
           total_count AS (
               SELECT COUNT(*) AS total_count FROM session_data
           )
           SELECT s.*, tc.total_count
           FROM session_data s, total_count tc
           ORDER BY s.fecha DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut query = sqlx::query_as::<_, DescarteSessionRow>(&sql);

    if let Some(v) = params.desde {
        query = query.bind(v);
    }
    if let Some(v) = params.hasta {
        query = query.bind(v);
    }
    if let Some(v) = params.area_id {
        query = query.bind(v);
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(&state.pool).await?;
    let total = rows.first().map(|r| r.total_count).unwrap_or(0);

    let data: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "grupo_movimiento": r.grupo_movimiento,
                "fecha": r.fecha,
                "usuario_nombre": r.usuario_nombre,
                "total_items": r.total_items,
                "areas": r.areas,
                "items": r.items,
            })
        })
        .collect();

    let total_pages = if limit > 0 { (total + limit - 1) / limit } else { 1 };
    Ok(Json(serde_json::json!({
        "data": data,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": total_pages,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
}

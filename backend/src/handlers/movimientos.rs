use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::AppState;
use crate::dto::pagination::{PaginatedResponse, PaginationParams};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
struct MovimientoQuery {
    area_id: Option<i32>,
    producto_id: Option<Uuid>,
    usuario_id: Option<Uuid>,
    tipo: Option<String>,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    grupo_movimiento: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MovimientoListItem {
    id: Uuid,
    numero_documento: String,
    grupo_movimiento: Option<Uuid>,
    tipo: String,
    cantidad: Decimal,
    cantidad_resultante: Decimal,
    lote_numero: String,
    producto_nombre: String,
    area_nombre: String,
    usuario_nombre: String,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
    nota: Option<String>,
    created_at: DateTime<Utc>,
}

/// GET /api/v1/movimientos
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<MovimientoQuery>,
) -> Result<Json<PaginatedResponse<MovimientoListItem>>, AppError> {
    let pagination = PaginationParams { page: params.page, per_page: params.per_page };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions: Vec<String> = vec!["TRUE".to_string()];
    let mut param_idx = 0u32;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.area_id = ${}", param_idx));
    }
    if params.producto_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.producto_id = ${}", param_idx));
    }
    if params.usuario_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.usuario_id = ${}", param_idx));
    }
    if params.tipo.is_some() {
        param_idx += 1;
        conditions.push(format!("m.tipo = ANY(${})", param_idx));
    }
    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at < ${}::date + INTERVAL '1 day'", param_idx));
    }
    if params.grupo_movimiento.is_some() {
        param_idx += 1;
        conditions.push(format!("m.grupo_movimiento = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let count_sql = format!(
        r#"SELECT COUNT(*) FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           WHERE {}"#,
        where_clause
    );

    let data_sql = format!(
        r#"SELECT m.id, m.numero_documento, m.grupo_movimiento, m.tipo,
                  m.cantidad, m.cantidad_resultante,
                  l.numero_lote as lote_numero, p.nombre as producto_nombre,
                  a.nombre as area_nombre, u.nombre as usuario_nombre,
                  um.nombre as unidad_base_nombre, um.nombre_plural as unidad_base_nombre_plural,
                  m.nota, m.created_at
           FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = m.area_id
           JOIN usuarios u ON u.id = m.usuario_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE {}
           ORDER BY m.created_at DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    let mut data_query = sqlx::query_as::<_, MovimientoListItem>(&data_sql);

    // Bind parameters in order
    if let Some(v) = params.area_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.producto_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.usuario_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(ref t) = params.tipo {
        let mapped = match t.as_str() {
            "entrada" => vec!["INGRESO", "CARGA_INICIAL"],
            "salida" => vec!["CONSUMO"],
            "descarte" => vec!["DESCARTE_VENCIDO", "DESCARTE_DAÑADO"],
            "ajuste" => vec!["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO"],
            "ajuste_pos" => vec!["AJUSTE_POSITIVO"],
            "ajuste_neg" => vec!["AJUSTE_NEGATIVO"],
            _ => vec![t.as_str()],
        };
        count_query = count_query.bind(mapped.clone());
        data_query = data_query.bind(mapped);
    }
    if let Some(v) = params.desde {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.hasta {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.grupo_movimiento {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }

    data_query = data_query.bind(limit).bind(offset);

    let total = count_query.fetch_one(&state.pool).await?;
    let mut data = data_query.fetch_all(&state.pool).await?;

    // Normalizar tipos para el frontend
    for item in &mut data {
        item.tipo = match item.tipo.as_str() {
            "INGRESO" | "CARGA_INICIAL" => "entrada".to_string(),
            "CONSUMO" => "salida".to_string(),
            "DESCARTE_VENCIDO" | "DESCARTE_DAÑADO" => "descarte".to_string(),
            "AJUSTE_POSITIVO" => "ajuste_pos".to_string(),
            "AJUSTE_NEGATIVO" => "ajuste_neg".to_string(),
            other => other.to_lowercase(),
        };
    }

    Ok(Json(PaginatedResponse {
        data,
        total,
        page: pagination.page(),
        per_page: limit,
    }))
}

/// GET /api/v1/movimientos/:id
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut mov = sqlx::query_as::<_, MovimientoListItem>(
        r#"SELECT m.id, m.numero_documento, m.grupo_movimiento, m.tipo,
                  m.cantidad, m.cantidad_resultante,
                  l.numero_lote as lote_numero, p.nombre as producto_nombre,
                  a.nombre as area_nombre, u.nombre as usuario_nombre,
                  um.nombre as unidad_base_nombre, um.nombre_plural as unidad_base_nombre_plural,
                  m.nota, m.created_at
           FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = m.area_id
           JOIN usuarios u ON u.id = m.usuario_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE m.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Movimiento no encontrado".into()))?;

    // Normalizar tipo
    mov.tipo = match mov.tipo.as_str() {
        "INGRESO" | "CARGA_INICIAL" => "entrada".to_string(),
        "CONSUMO" => "salida".to_string(),
        "DESCARTE_VENCIDO" | "DESCARTE_DAÑADO" => "descarte".to_string(),
        "AJUSTE_POSITIVO" => "ajuste_pos".to_string(),
        "AJUSTE_NEGATIVO" => "ajuste_neg".to_string(),
        other => other.to_lowercase(),
    };

    Ok(Json(serde_json::json!(mov)))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/{id}", get(obtener))
}

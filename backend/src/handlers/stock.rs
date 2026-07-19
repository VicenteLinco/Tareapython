use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use axum::Extension;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;
use crate::services::stock_service;

// === DTOs (entrada HTTP) ===

#[derive(Debug, Deserialize)]
struct StockQuery {
    area_id: Option<i32>,
    area_ids: Option<String>,
    q: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    stock_bajo: Option<bool>,
    con_alertas: Option<bool>,
    filter: Option<String>,
    estado: Option<String>, // nuevo param unificado: todos|normal|bajo|critico|sin_stock
    custom_filters: Option<String>,
    incluir_pendientes: Option<bool>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn parse_area_ids(value: Option<&str>) -> Result<Vec<i32>, AppError> {
    value
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<i32>()
                .map_err(|_| AppError::Validation("area_ids debe contener solo enteros".into()))
        })
        .collect()
}

// === Handlers ===

/// GET /api/v1/stock — Vista principal de stock
async fn listar(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let requested_area_ids = parse_area_ids(params.area_ids.as_deref())?;

    if params.area_id.is_some() && !requested_area_ids.is_empty() {
        return Err(AppError::Validation(
            "Usa area_id o area_ids, no ambos".into(),
        ));
    }

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    }
    .validated()?;
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let resultado = stock_service::listar(
        &state.pool,
        stock_service::ListarParams {
            area_id: params.area_id,
            area_ids: requested_area_ids,
            q: params.q,
            categoria_id: params.categoria_id,
            proveedor_id: params.proveedor_id,
            stock_bajo: params.stock_bajo,
            con_alertas: params.con_alertas,
            filter: params.filter,
            estado: params.estado,
            custom_filters: params.custom_filters,
            incluir_pendientes: params.incluir_pendientes == Some(true),
            limit,
            offset,
        },
    )
    .await?;

    let total_pages = if limit > 0 {
        (resultado.total + limit - 1) / limit
    } else {
        1
    };

    Ok(Json(serde_json::json!({
        "data": resultado.rows,
        "total": resultado.total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": total_pages,
        "resumen": {
            "total_productos_con_stock": resultado.total_productos_con_stock,
            "productos_bajo_minimo": resultado.productos_bajo_minimo,
            "productos_por_vencer_90d": resultado.productos_por_vencer_90d,
            "valor_total_inventario": resultado.valor_total_inventario,
            "unidades_sin_costo": resultado.unidades_sin_costo,
            "unidades_total_inventario": resultado.unidades_total_inventario,
        }
    })))
}

/// GET /api/v1/stock/area/:area_id — Stock de un área específica
async fn stock_por_area(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(area_id): Path<i32>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    }
    .validated()?;
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let resultado = stock_service::por_area(&state.pool, area_id, params.q, limit, offset).await?;

    let total_pages = if limit > 0 {
        (resultado.total + limit - 1) / limit
    } else {
        1
    };

    Ok(Json(serde_json::json!({
        "area": resultado.area,
        "productos": resultado.productos,
        "total": resultado.total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": total_pages,
    })))
}

#[derive(Debug, Deserialize)]
struct AlertasParams {
    #[serde(default = "default_page")]
    page: i64,
    #[serde(default = "default_per_page")]
    per_page: i64,
    area_ids: Option<String>,
}

fn default_page() -> i64 {
    1
}
fn default_per_page() -> i64 {
    50
}

/// GET /api/v1/stock/alertas — Productos que necesitan atención
async fn alertas(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<AlertasParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.clamp(1, 100);
    let page = params.page.max(1);
    let offset = (page - 1) * per_page;

    let requested_area_ids = parse_area_ids(params.area_ids.as_deref())?;

    let resultado =
        stock_service::alertas(&state.pool, requested_area_ids, per_page, offset).await?;

    let total_pages = (resultado.total + per_page - 1) / per_page;

    Ok(Json(serde_json::json!({
        "data": resultado.rows,
        "total": resultado.total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "resumen": {
            "sin_stock": resultado.sin_stock_count,
            "vencido": resultado.vencido_count,
            "bajo_minimo": resultado.bajo_minimo_count,
            "vencimiento": resultado.vencimiento_count,
        },
    })))
}

#[derive(Debug, Deserialize)]
struct LotesVencidosQuery {
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    dias_alerta: Option<i32>,
    q: Option<String>,
}

async fn lotes_vencidos(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<LotesVencidosQuery>,
) -> Result<Json<Vec<stock_service::LoteVencidoItem>>, AppError> {
    let items = stock_service::lotes_vencidos(
        &state.pool,
        params.area_id,
        params.proveedor_id,
        params.dias_alerta,
        params.q,
    )
    .await?;
    Ok(Json(items))
}

/// GET /api/v1/stock/balance-check — Verifica integridad del stock contra los movimientos
///
/// An empty `discrepancias` array means the ledger is healthy.
///
/// TODO: add admin role guard once auth middleware extraction is refactored.
pub async fn balance_check(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let resultado = stock_service::balance_check(&state.pool).await?;
    Ok(Json(serde_json::json!({
        "discrepancias": resultado.discrepancias,
        "sano": resultado.sano,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
        .route("/lotes-vencidos", get(lotes_vencidos))
        .route("/balance-check", get(balance_check))
}

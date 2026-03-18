use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::AppState;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct StockQuery {
    area_id: Option<i32>,
    q: Option<String>,
    categoria_id: Option<i32>,
    stock_bajo: Option<bool>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StockItem {
    producto_id: Uuid,
    codigo_interno: String,
    producto_nombre: String,
    categoria: Option<String>,
    unidad: String,
    stock_total: Option<Decimal>,
    stock_minimo: Decimal,
    proximo_vencimiento: Option<NaiveDate>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StockAreaProducto {
    producto_id: Uuid,
    codigo_interno: String,
    nombre: String,
    unidad: String,
    stock: Option<Decimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LoteEnArea {
    lote_id: Uuid,
    numero_lote: String,
    stock: Decimal,
    fecha_vencimiento: NaiveDate,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AlertaBajoMinimo {
    producto_id: Uuid,
    producto: String,
    stock_actual: Option<Decimal>,
    stock_minimo: Decimal,
    unidad: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AlertaVencimiento {
    producto_id: Uuid,
    producto: String,
    numero_lote: String,
    fecha_vencimiento: NaiveDate,
    stock: Decimal,
    area: String,
}

// === Handlers ===

/// GET /api/v1/stock — Vista principal de stock
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pagination = PaginationParams { page: params.page, per_page: params.per_page };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec!["s.cantidad > 0".to_string()];
    let mut param_idx = 0;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("s.area_id = ${}", param_idx));
    }
    if params.q.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "(p.nombre ILIKE ${0} OR p.codigo_interno ILIKE ${0})",
            param_idx
        ));
    }
    if params.categoria_id.is_some() {
        param_idx += 1;
        conditions.push(format!("p.categoria_id = ${}", param_idx));
    }
    if params.stock_bajo == Some(true) {
        conditions.push("p.stock_minimo > 0".to_string());
    }

    let where_clause = conditions.join(" AND ");

    let base_from = r#"FROM stock s
        JOIN lotes l ON l.id = s.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN unidades_basicas um ON um.id = p.unidad_base_id
        LEFT JOIN categorias c ON c.id = p.categoria_id"#;

    let count_sql = format!(
        "SELECT COUNT(DISTINCT p.id) {} WHERE {}",
        base_from, where_clause
    );
    let data_sql = format!(
        r#"SELECT p.id as producto_id, p.codigo_interno, p.nombre as producto_nombre,
                  c.nombre as categoria, um.nombre as unidad,
                  SUM(s.cantidad) as stock_total, p.stock_minimo,
                  MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) as proximo_vencimiento
           {} WHERE {}
           GROUP BY p.id, p.codigo_interno, p.nombre, c.nombre, um.nombre, p.stock_minimo
           {}
           ORDER BY p.nombre
           LIMIT ${} OFFSET ${}"#,
        base_from,
        where_clause,
        if params.stock_bajo == Some(true) {
            "HAVING SUM(s.cantidad) < p.stock_minimo"
        } else {
            ""
        },
        param_idx + 1,
        param_idx + 2
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    let mut data_query = sqlx::query_as::<_, StockItem>(&data_sql);

    if let Some(area_id) = params.area_id {
        count_query = count_query.bind(area_id);
        data_query = data_query.bind(area_id);
    }
    if let Some(q) = &params.q {
        let pattern = format!("%{}%", q);
        count_query = count_query.bind(pattern.clone());
        data_query = data_query.bind(pattern);
    }
    if let Some(cat_id) = params.categoria_id {
        count_query = count_query.bind(cat_id);
        data_query = data_query.bind(cat_id);
    }

    data_query = data_query.bind(limit).bind(offset);

    let total = count_query.fetch_one(&state.pool).await?;
    let data = data_query.fetch_all(&state.pool).await?;

    // Resumen
    let resumen_total: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT l.producto_id) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE s.cantidad > 0",
    )
    .fetch_one(&state.pool)
    .await?;

    let bajo_minimo: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM (
            SELECT l.producto_id FROM stock s
            JOIN lotes l ON l.id = s.lote_id
            JOIN productos p ON p.id = l.producto_id
            WHERE s.cantidad > 0 AND p.stock_minimo > 0
            GROUP BY l.producto_id, p.stock_minimo
            HAVING SUM(s.cantidad) < p.stock_minimo
        ) sub"#,
    )
    .fetch_one(&state.pool)
    .await?;

    let por_vencer: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(DISTINCT l.producto_id) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE s.cantidad > 0 AND l.fecha_vencimiento <= CURRENT_DATE + INTERVAL '90 days'"#,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "data": data,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
        "resumen": {
            "total_productos_con_stock": resumen_total.0,
            "productos_bajo_minimo": bajo_minimo.0,
            "productos_por_vencer_90d": por_vencer.0,
        }
    })))
}

/// GET /api/v1/stock/area/:area_id — Stock de un área específica
async fn stock_por_area(
    State(state): State<AppState>,
    Path(area_id): Path<i32>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let area = sqlx::query_as::<_, AreaRef>(
        "SELECT id, nombre FROM areas WHERE id = $1",
    )
    .bind(area_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let pagination = PaginationParams { page: params.page, per_page: params.per_page };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec![
        "s.cantidad > 0".to_string(),
        "s.area_id = $1".to_string(),
    ];

    if params.q.is_some() {
        conditions.push("(p.nombre ILIKE $2 OR p.codigo_interno ILIKE $2)".to_string());
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
        r#"SELECT p.id as producto_id, p.codigo_interno, p.nombre,
                  um.nombre as unidad, SUM(s.cantidad) as stock
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE {}
           GROUP BY p.id, p.codigo_interno, p.nombre, um.nombre
           ORDER BY p.nombre
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        if params.q.is_some() { 3 } else { 2 },
        if params.q.is_some() { 4 } else { 3 },
    );

    let mut query = sqlx::query_as::<_, StockAreaProducto>(&sql).bind(area_id);
    if let Some(q) = &params.q {
        query = query.bind(format!("%{}%", q));
    }
    query = query.bind(limit).bind(offset);

    let productos = query.fetch_all(&state.pool).await?;

    // Para cada producto, obtener sus lotes en esta área
    let mut productos_con_lotes = Vec::new();
    for prod in &productos {
        let lotes = sqlx::query_as::<_, LoteEnArea>(
            r#"SELECT s.lote_id, l.numero_lote, s.cantidad as stock, l.fecha_vencimiento
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               WHERE l.producto_id = $1 AND s.area_id = $2 AND s.cantidad > 0
               ORDER BY l.fecha_vencimiento ASC"#,
        )
        .bind(prod.producto_id)
        .bind(area_id)
        .fetch_all(&state.pool)
        .await?;

        productos_con_lotes.push(serde_json::json!({
            "producto_id": prod.producto_id,
            "codigo_interno": prod.codigo_interno,
            "nombre": prod.nombre,
            "unidad": prod.unidad,
            "stock": prod.stock,
            "lotes": lotes,
        }));
    }

    Ok(Json(serde_json::json!({
        "area": area,
        "productos": productos_con_lotes,
    })))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AreaRef {
    id: i32,
    nombre: String,
}

/// GET /api/v1/stock/alertas — Productos que necesitan atención
async fn alertas(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let bajo_minimo = sqlx::query_as::<_, AlertaBajoMinimo>(
        r#"SELECT p.id as producto_id, p.nombre as producto, SUM(s.cantidad) as stock_actual,
                  p.stock_minimo, um.nombre as unidad
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE s.cantidad > 0 AND p.stock_minimo > 0 AND p.activo = true
           GROUP BY p.id, p.nombre, p.stock_minimo, um.nombre
           HAVING SUM(s.cantidad) < p.stock_minimo
           ORDER BY SUM(s.cantidad) / p.stock_minimo ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    let por_vencer_30d = sqlx::query_as::<_, AlertaVencimiento>(
        r#"SELECT p.id as producto_id, p.nombre as producto, l.numero_lote,
                  l.fecha_vencimiento, s.cantidad as stock, a.nombre as area
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = s.area_id
           WHERE s.cantidad > 0
             AND l.fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days'
             AND l.fecha_vencimiento > CURRENT_DATE
           ORDER BY l.fecha_vencimiento ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    let por_vencer_90d = sqlx::query_as::<_, AlertaVencimiento>(
        r#"SELECT p.id as producto_id, p.nombre as producto, l.numero_lote,
                  l.fecha_vencimiento, s.cantidad as stock, a.nombre as area
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = s.area_id
           WHERE s.cantidad > 0
             AND l.fecha_vencimiento > CURRENT_DATE + INTERVAL '30 days'
             AND l.fecha_vencimiento <= CURRENT_DATE + INTERVAL '90 days'
           ORDER BY l.fecha_vencimiento ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    let vencidos = sqlx::query_as::<_, AlertaVencimiento>(
        r#"SELECT p.id as producto_id, p.nombre as producto, l.numero_lote,
                  l.fecha_vencimiento, s.cantidad as stock, a.nombre as area
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = s.area_id
           WHERE s.cantidad > 0 AND l.fecha_vencimiento <= CURRENT_DATE
           ORDER BY l.fecha_vencimiento ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "bajo_minimo": bajo_minimo,
        "por_vencer_30d": por_vencer_30d,
        "por_vencer_90d": por_vencer_90d,
        "vencidos": vencidos,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
}

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use axum::Extension;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;
use crate::services::stock_ops;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct StockQuery {
    area_id: Option<i32>,
    q: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
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
    unidad_plural: Option<String>,
    stock_total: Option<Decimal>,
    stock_minimo: Decimal,
    proximo_vencimiento: Option<NaiveDate>,
    proveedor_nombre: Option<String>,
    proveedor_icono: Option<String>,
}

// === Handlers ===

/// GET /api/v1/stock — Vista principal de stock
async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Si se filtra por área, validar acceso
    if let Some(aid) = params.area_id {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, aid, &claims.rol).await?;
    }

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    }
    .validated()?;

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
    if params.proveedor_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.proveedor_id = ${}", param_idx));
    }
    if params.stock_bajo == Some(true) {
        conditions.push("p.stock_minimo > 0".to_string());
    }

    let where_clause = conditions.join(" AND ");

    let base_from = r#"FROM stock s
        JOIN lotes l ON l.id = s.lote_id
        JOIN productos p ON p.id = l.producto_id
        JOIN unidades_basicas um ON um.id = p.unidad_base_id
        LEFT JOIN categorias c ON c.id = p.categoria_id
        LEFT JOIN LATERAL (
            SELECT pv.nombre, pv.icono
            FROM lotes l2
            JOIN stock s2 ON s2.lote_id = l2.id
            JOIN proveedores pv ON pv.id = l2.proveedor_id
            WHERE l2.producto_id = p.id AND s2.cantidad > 0
            ORDER BY l2.fecha_vencimiento ASC
            LIMIT 1
        ) fefo_prov ON true"#;

    let count_sql = format!(
        "SELECT COUNT(DISTINCT p.id) {} WHERE {}",
        base_from, where_clause
    );
    let data_sql = format!(
        r#"SELECT p.id as producto_id, p.codigo_interno, p.nombre as producto_nombre,
                  c.nombre as categoria, um.nombre as unidad, um.nombre_plural as unidad_plural,
                  SUM(s.cantidad) as stock_total, p.stock_minimo,
                  MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) as proximo_vencimiento,
                  fefo_prov.nombre as proveedor_nombre, fefo_prov.icono as proveedor_icono
           {} WHERE {}
           GROUP BY p.id, p.codigo_interno, p.nombre, c.nombre, um.nombre, um.nombre_plural, p.stock_minimo, fefo_prov.nombre, fefo_prov.icono
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
    if let Some(prov_id) = params.proveedor_id {
        count_query = count_query.bind(prov_id);
        data_query = data_query.bind(prov_id);
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

    let total_pages = if limit > 0 { (total + limit - 1) / limit } else { 1 };

    Ok(Json(serde_json::json!({
        "data": data,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": total_pages,
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
    Extension(claims): Extension<Claims>,
    Path(area_id): Path<i32>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    stock_ops::validar_acceso_area(&state.pool, claims.sub, area_id, &claims.rol).await?;
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

    // Query unificada: productos + lotes en una sola round-trip con JSON aggregation
    let data_sql = format!(
        r#"SELECT
               p.id as producto_id,
               p.codigo_interno,
               p.nombre,
               um.nombre as unidad,
               um.nombre_plural as unidad_plural,
               p.stock_minimo,
               COALESCE(SUM(s.cantidad), 0) AS stock,
               JSON_AGG(
                   JSON_BUILD_OBJECT(
                       'lote_id',          s.lote_id,
                       'numero_lote',      l.numero_lote,
                       'stock',            s.cantidad,
                       'fecha_vencimiento', l.fecha_vencimiento
                   ) ORDER BY l.fecha_vencimiento ASC NULLS LAST
               ) FILTER (WHERE s.cantidad > 0) AS lotes
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE s.area_id = $1 AND s.cantidad > 0
           {}
           GROUP BY p.id, p.codigo_interno, p.nombre, um.nombre, um.nombre_plural, p.stock_minimo
           ORDER BY p.nombre
           LIMIT ${} OFFSET ${}"#,
        if params.q.is_some() {
            "AND (p.nombre ILIKE $2 OR p.codigo_interno ILIKE $2)"
        } else {
            ""
        },
        if params.q.is_some() { 3 } else { 2 },
        if params.q.is_some() { 4 } else { 3 },
    );

    #[derive(sqlx::FromRow)]
    struct StockAreaRow {
        producto_id: Uuid,
        codigo_interno: String,
        nombre: String,
        unidad: String,
        unidad_plural: String,
        stock_minimo: Option<Decimal>,
        stock: Decimal,
        lotes: Option<serde_json::Value>,
    }

    let mut query = sqlx::query_as::<_, StockAreaRow>(&data_sql).bind(area_id);
    if let Some(q) = &params.q {
        query = query.bind(format!("%{}%", q));
    }
    query = query.bind(limit).bind(offset);

    let filas = query.fetch_all(&state.pool).await?;

    let productos_con_lotes: Vec<serde_json::Value> = filas
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "producto_id": row.producto_id,
                "codigo_interno": row.codigo_interno,
                "nombre": row.nombre,
                "unidad": row.unidad,
                "unidad_plural": row.unidad_plural,
                "stock_minimo": row.stock_minimo,
                "stock": row.stock,
                "lotes": row.lotes.unwrap_or(serde_json::json!([])),
            })
        })
        .collect();

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

#[derive(Debug, Deserialize)]
struct AlertasParams {
    #[serde(default = "default_page")]
    page: i64,
    #[serde(default = "default_per_page")]
    per_page: i64,
}

fn default_page() -> i64 { 1 }
fn default_per_page() -> i64 { 50 }

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AlertaRow {
    producto_id: Uuid,
    nombre: String,
    total: Decimal,
    unidad: String,
    unidad_plural: String,
    proxima_fecha_venc: Option<NaiveDate>,
    stock_minimo: Option<Decimal>,
    tipo_alerta: Option<String>,
}

/// GET /api/v1/stock/alertas — Productos que necesitan atención
async fn alertas(
    State(state): State<AppState>,
    Query(params): Query<AlertasParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.clamp(1, 100);
    let page = params.page.max(1);
    let offset = (page - 1) * per_page;

    let total: i64 = sqlx::query_scalar(
        r#"WITH stock_producto AS (
               SELECT l.producto_id, p.stock_minimo,
                   SUM(s.cantidad) AS total,
                   MIN(CASE WHEN l.fecha_vencimiento IS NOT NULL THEN l.fecha_vencimiento END) AS proxima_fecha_venc
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               JOIN productos p ON p.id = l.producto_id
               WHERE s.cantidad > 0 AND p.activo = true
               GROUP BY l.producto_id, p.stock_minimo
           )
           SELECT COUNT(*) FROM stock_producto
           WHERE (stock_minimo > 0 AND total < stock_minimo)
              OR proxima_fecha_venc <= CURRENT_DATE + 90"#,
    )
    .fetch_one(&state.pool)
    .await?;

    let alertas = sqlx::query_as::<_, AlertaRow>(
        r#"WITH stock_producto AS (
               SELECT
                   l.producto_id,
                   p.nombre,
                   p.stock_minimo,
                   ub.nombre AS unidad,
                   ub.nombre_plural AS unidad_plural,
                   SUM(s.cantidad) AS total,
                   MIN(CASE WHEN l.fecha_vencimiento IS NOT NULL
                       THEN l.fecha_vencimiento END) AS proxima_fecha_venc
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               JOIN productos p ON p.id = l.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE s.cantidad > 0 AND p.activo = true
               GROUP BY l.producto_id, p.nombre, p.stock_minimo, ub.nombre, ub.nombre_plural
           )
           SELECT
               producto_id,
               nombre,
               total,
               unidad,
               unidad_plural,
               proxima_fecha_venc,
               stock_minimo,
               CASE
                   WHEN proxima_fecha_venc < CURRENT_DATE THEN 'vencido'
                   WHEN proxima_fecha_venc <= CURRENT_DATE + 30 THEN 'vence_30d'
                   WHEN proxima_fecha_venc <= CURRENT_DATE + 90 THEN 'vence_90d'
                   WHEN stock_minimo > 0 AND total < stock_minimo THEN 'bajo_minimo'
               END AS tipo_alerta
           FROM stock_producto
           WHERE (stock_minimo > 0 AND total < stock_minimo)
              OR proxima_fecha_venc <= CURRENT_DATE + 90
           ORDER BY
               CASE WHEN proxima_fecha_venc < CURRENT_DATE THEN 0
                    WHEN proxima_fecha_venc <= CURRENT_DATE + 30 THEN 1
                    WHEN stock_minimo > 0 AND total < stock_minimo THEN 2
                    ELSE 3 END,
               proxima_fecha_venc ASC NULLS LAST,
               nombre ASC
           LIMIT $1 OFFSET $2"#,
    )
    .bind(per_page)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let total_pages = (total + per_page - 1) / per_page;

    Ok(Json(serde_json::json!({
        "data": alertas,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
}

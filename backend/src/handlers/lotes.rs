use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::AppState;
use crate::errors::AppError;
use crate::models::lote::Lote;

#[derive(Debug, Deserialize)]
struct LoteQuery {
    producto_id: Option<Uuid>,
    con_stock: Option<bool>,
    vencido: Option<bool>,
    area_id: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LoteListItem {
    id: Uuid,
    producto_id: Uuid,
    producto_nombre: String,
    codigo_interno: String,
    numero_lote: String,
    fecha_vencimiento: NaiveDate,
    proveedor_nombre: Option<String>,
    costo_unitario: Option<Decimal>,
    stock_total: Option<Decimal>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StockPorArea {
    area_id: i32,
    area_nombre: String,
    cantidad: Decimal,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MovimientoLote {
    id: Uuid,
    numero_documento: String,
    tipo: String,
    cantidad: Decimal,
    cantidad_resultante: Decimal,
    area_nombre: String,
    usuario_nombre: String,
    nota: Option<String>,
    created_at: DateTime<Utc>,
}

/// GET /api/v1/lotes
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<LoteQuery>,
) -> Result<Json<Vec<LoteListItem>>, AppError> {
    let mut conditions = Vec::new();
    let mut param_idx = 0u32;

    if params.producto_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.producto_id = ${}", param_idx));
    }
    if params.vencido == Some(true) {
        conditions.push("l.fecha_vencimiento <= CURRENT_DATE".to_string());
    } else if params.vencido == Some(false) {
        conditions.push("l.fecha_vencimiento > CURRENT_DATE".to_string());
    }
    if params.con_stock == Some(true) {
        if params.area_id.is_some() {
            param_idx += 1;
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM stock s WHERE s.lote_id = l.id AND s.cantidad > 0 AND s.area_id = ${})",
                param_idx
            ));
        } else {
            conditions.push(
                "EXISTS (SELECT 1 FROM stock s WHERE s.lote_id = l.id AND s.cantidad > 0)"
                    .to_string(),
            );
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        r#"SELECT l.id, l.producto_id, p.nombre as producto_nombre, l.codigo_interno,
                  l.numero_lote, l.fecha_vencimiento, prov.nombre as proveedor_nombre,
                  l.costo_unitario,
                  (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id = l.id AND s.cantidad > 0) as stock_total,
                  l.created_at
           FROM lotes l
           JOIN productos p ON p.id = l.producto_id
           LEFT JOIN proveedores prov ON prov.id = l.proveedor_id
           {}
           ORDER BY l.fecha_vencimiento ASC
           LIMIT 100"#,
        where_clause
    );

    let mut query = sqlx::query_as::<_, LoteListItem>(&sql);

    if let Some(producto_id) = params.producto_id {
        query = query.bind(producto_id);
    }
    if params.con_stock == Some(true) {
        if let Some(area_id) = params.area_id {
            query = query.bind(area_id);
        }
    }

    let lotes = query.fetch_all(&state.pool).await?;
    Ok(Json(lotes))
}

/// GET /api/v1/lotes/:id
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let lote = sqlx::query_as::<_, Lote>("SELECT * FROM lotes WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Lote no encontrado".into()))?;

    let producto_nombre: String =
        sqlx::query_scalar("SELECT nombre FROM productos WHERE id = $1")
            .bind(lote.producto_id)
            .fetch_one(&state.pool)
            .await?;

    let stock_por_area = sqlx::query_as::<_, StockPorArea>(
        r#"SELECT s.area_id, a.nombre as area_nombre, s.cantidad
           FROM stock s
           JOIN areas a ON a.id = s.area_id
           WHERE s.lote_id = $1 AND s.cantidad > 0
           ORDER BY a.nombre"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    let movimientos = sqlx::query_as::<_, MovimientoLote>(
        r#"SELECT m.id, m.numero_documento, m.tipo, m.cantidad, m.cantidad_resultante,
                  a.nombre as area_nombre, u.nombre as usuario_nombre, m.nota, m.created_at
           FROM movimientos m
           JOIN areas a ON a.id = m.area_id
           JOIN usuarios u ON u.id = m.usuario_id
           WHERE m.lote_id = $1
           ORDER BY m.created_at DESC
           LIMIT 50"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "id": lote.id,
        "producto_id": lote.producto_id,
        "producto_nombre": producto_nombre,
        "numero_lote": lote.numero_lote,
        "codigo_interno": lote.codigo_interno,
        "fecha_vencimiento": lote.fecha_vencimiento,
        "costo_unitario": lote.costo_unitario,
        "created_at": lote.created_at,
        "stock_por_area": stock_por_area,
        "movimientos": movimientos,
    })))
}

/// GET /api/v1/lotes/buscar-codigo/:codigo
async fn buscar_por_codigo(
    State(state): State<AppState>,
    Path(codigo): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Buscar por codigo_interno de lote
    let lote_result = sqlx::query_as::<_, LoteBusqueda>(
        r#"SELECT l.id, l.numero_lote, p.nombre as producto_nombre, l.codigo_interno
           FROM lotes l
           JOIN productos p ON p.id = l.producto_id
           WHERE l.codigo_interno = $1"#,
    )
    .bind(&codigo)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(lote) = lote_result {
        return Ok(Json(serde_json::json!({
            "resultados": [{
                "tipo": "lote_interno",
                "lote": lote,
            }]
        })));
    }

    // Buscar por codigo_barras de presentación
    let presentaciones = sqlx::query_as::<_, PresentacionBusqueda>(
        r#"SELECT pr.id as presentacion_id, pr.nombre as presentacion_nombre,
                  p.id as producto_id, p.nombre as producto_nombre, p.codigo_interno
           FROM presentaciones pr
           JOIN productos p ON p.id = pr.producto_id
           WHERE pr.codigo_barras = $1 AND pr.activa = true AND p.activo = true"#,
    )
    .bind(&codigo)
    .fetch_all(&state.pool)
    .await?;

    if !presentaciones.is_empty() {
        let resultados: Vec<serde_json::Value> = presentaciones
            .iter()
            .map(|p| {
                serde_json::json!({
                    "tipo": "codigo_barras",
                    "producto_id": p.producto_id,
                    "producto_nombre": p.producto_nombre,
                    "codigo_interno": p.codigo_interno,
                    "presentacion_id": p.presentacion_id,
                    "presentacion_nombre": p.presentacion_nombre,
                })
            })
            .collect();
        return Ok(Json(serde_json::json!({ "resultados": resultados })));
    }

    Ok(Json(serde_json::json!({ "resultados": [] })))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LoteBusqueda {
    id: Uuid,
    numero_lote: String,
    producto_nombre: String,
    codigo_interno: String,
}

#[derive(Debug, sqlx::FromRow)]
struct PresentacionBusqueda {
    presentacion_id: i32,
    presentacion_nombre: String,
    producto_id: Uuid,
    producto_nombre: String,
    codigo_interno: String,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/buscar-codigo/{codigo}", get(buscar_por_codigo))
        .route("/{id}", get(obtener))
}

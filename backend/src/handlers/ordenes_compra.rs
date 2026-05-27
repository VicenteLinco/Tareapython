use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;

// === DTOs ===

#[derive(Debug, Deserialize)]
pub struct CreateOrdenCompraRequest {
    pub solicitud_id: Option<Uuid>,
    pub proveedor_id: i32,
    pub fecha_entrega_esperada: Option<NaiveDate>,
    pub nota: Option<String>,
    pub items: Vec<CreateOCItem>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOCItem {
    pub producto_id: Uuid,
    pub presentacion_id: Option<i32>,
    pub cantidad_solicitada: Decimal,
    pub precio_unitario: Option<Decimal>,
    pub unidad: String,
    pub area_destino_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct OCQuery {
    pub proveedor_id: Option<i32>,
    pub estado: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

// === Row types for sqlx ===

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OrdenCompraResumen {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_nombre: String,
    pub estado: String,
    pub fecha_emision: DateTime<Utc>,
    pub fecha_entrega_esperada: Option<NaiveDate>,
    pub items_count: i64,
    pub solicitud_numero: Option<String>,
    pub usuario_nombre: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OCDetalleItemRow {
    pub id: i32,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub presentacion_nombre: Option<String>,
    pub cantidad_solicitada: Decimal,
    pub cantidad_recibida: Decimal,
    pub precio_unitario: Option<Decimal>,
    pub unidad: String,
    pub area_destino_nombre: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecepcionVinculadaRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub estado: String,
    pub fecha_recepcion: DateTime<Utc>,
    pub usuario_nombre: String,
    pub guia_despacho: Option<String>,
    pub guia_despacho_archivo: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OCCabeceraRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub estado: String,
    pub fecha_emision: DateTime<Utc>,
    pub fecha_entrega_esperada: Option<NaiveDate>,
    pub nota: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub solicitud_numero: Option<String>,
    pub usuario_nombre: String,
}

// === Handlers ===

/// POST /api/v1/ordenes-compra — Crear orden de compra (admin only)
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateOrdenCompraRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if payload.items.is_empty() {
        return Err(AppError::Validation(
            "La orden debe tener al menos un ítem".into(),
        ));
    }

    for item in &payload.items {
        if item.cantidad_solicitada <= Decimal::ZERO {
            return Err(AppError::Validation(
                "La cantidad_solicitada debe ser mayor a 0".into(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;

    // If linked to a solicitud, verify it's in a state that allows creating an OC
    if let Some(sid) = payload.solicitud_id {
        let estado_sol: Option<String> =
            sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1")
                .bind(sid)
                .fetch_optional(&mut *tx)
                .await?;

        match estado_sol.as_deref() {
            None => {
                return Err(AppError::NotFound(
                    "Solicitud de compra no encontrada".into(),
                ));
            }
            Some("guardada")
            | Some("parcialmente_enviada")
            | Some("enviada")
            | Some("parcialmente_recibida") => {}
            Some(e) => {
                return Err(AppError::BusinessLogic(
                    format!(
                        "No se puede crear una orden de compra desde una solicitud en estado '{}'",
                        e
                    ),
                    "SOLICITUD_ESTADO_INVALIDO".into(),
                ));
            }
        }
    }

    // Insert cabecera
    let orden_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO ordenes_compra (solicitud_id, proveedor_id, fecha_entrega_esperada, nota, usuario_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id"#,
    )
    .bind(payload.solicitud_id)
    .bind(payload.proveedor_id)
    .bind(payload.fecha_entrega_esperada)
    .bind(&payload.nota)
    .bind(claims.sub)
    .fetch_one(&mut *tx)
    .await?;

    // Insert items
    for item in &payload.items {
        sqlx::query(
            r#"INSERT INTO orden_compra_detalle
               (orden_compra_id, producto_id, presentacion_id, cantidad_solicitada, precio_unitario, unidad, area_destino_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        )
        .bind(orden_id)
        .bind(item.producto_id)
        .bind(item.presentacion_id)
        .bind(item.cantidad_solicitada)
        .bind(item.precio_unitario)
        .bind(&item.unidad)
        .bind(item.area_destino_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let numero: String =
        sqlx::query_scalar("SELECT numero_documento FROM ordenes_compra WHERE id = $1")
            .bind(orden_id)
            .fetch_one(&state.pool)
            .await?;

    Ok(Json(serde_json::json!({
        "id": orden_id,
        "numero_documento": numero,
        "status": "success"
    })))
}

/// GET /api/v1/ordenes-compra — Listar órdenes de compra (paginado, filtros opcionales)
async fn listar(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Query(params): Query<OCQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.unwrap_or(15).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let mut conditions = Vec::new();
    let mut param_idx = 0u32;

    if params.proveedor_id.is_some() {
        param_idx += 1;
        conditions.push(format!("oc.proveedor_id = ${}", param_idx));
    }
    if params.estado.is_some() {
        param_idx += 1;
        conditions.push(format!("oc.estado = ${}", param_idx));
    }
    if params.solicitud_id.is_some() {
        param_idx += 1;
        conditions.push(format!("oc.solicitud_id = ${}", param_idx));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        r#"SELECT COUNT(*)
           FROM ordenes_compra oc
           JOIN proveedores prov ON prov.id = oc.proveedor_id
           JOIN usuarios u ON u.id = oc.usuario_id
           LEFT JOIN solicitudes_compra sc ON sc.id = oc.solicitud_id
           {}"#,
        where_clause
    );

    // Add per_page and offset as the LAST two bound params (after filter params)
    let next_param = param_idx + 1;
    let data_sql = format!(
        r#"SELECT oc.id, oc.numero_documento, prov.nombre as proveedor_nombre,
                  oc.estado, oc.fecha_emision, oc.fecha_entrega_esperada,
                  (SELECT COUNT(*) FROM orden_compra_detalle WHERE orden_compra_id = oc.id) as items_count,
                  sc.numero_documento as solicitud_numero,
                  u.nombre as usuario_nombre
           FROM ordenes_compra oc
           JOIN proveedores prov ON prov.id = oc.proveedor_id
           JOIN usuarios u ON u.id = oc.usuario_id
           LEFT JOIN solicitudes_compra sc ON sc.id = oc.solicitud_id
           {}
           ORDER BY oc.fecha_emision DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        next_param,
        next_param + 1
    );

    macro_rules! bind_params {
        ($q:expr) => {{
            let mut q = $q;
            if let Some(v) = params.proveedor_id {
                q = q.bind(v);
            }
            if let Some(ref v) = params.estado {
                q = q.bind(v.clone());
            }
            if let Some(v) = params.solicitud_id {
                q = q.bind(v);
            }
            q
        }};
    }

    let total: i64 = bind_params!(sqlx::query_scalar::<_, i64>(&count_sql))
        .fetch_one(&state.pool)
        .await?;

    // For data query: bind filter params THEN pagination params
    let data = {
        let mut q = sqlx::query_as::<_, OrdenCompraResumen>(&data_sql);
        if let Some(v) = params.proveedor_id {
            q = q.bind(v);
        }
        if let Some(ref v) = params.estado {
            q = q.bind(v.clone());
        }
        if let Some(v) = params.solicitud_id {
            q = q.bind(v);
        }
        q.bind(per_page).bind(offset).fetch_all(&state.pool).await?
    };

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    Ok(Json(serde_json::json!({
        "data": data,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages
    })))
}

/// GET /api/v1/ordenes-compra/:id — Detalle de una orden de compra
async fn obtener(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cabecera = sqlx::query_as::<_, OCCabeceraRow>(
        r#"SELECT
               oc.id,
               oc.numero_documento,
               oc.proveedor_id,
               prov.nombre AS proveedor_nombre,
               oc.estado,
               oc.fecha_emision,
               oc.fecha_entrega_esperada,
               oc.nota,
               oc.solicitud_id,
               sc.numero_documento AS solicitud_numero,
               u.nombre AS usuario_nombre
           FROM ordenes_compra oc
           JOIN proveedores prov ON prov.id = oc.proveedor_id
           JOIN usuarios u ON u.id = oc.usuario_id
           LEFT JOIN solicitudes_compra sc ON sc.id = oc.solicitud_id
           WHERE oc.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Orden de compra no encontrada".into()))?;

    let items = sqlx::query_as::<_, OCDetalleItemRow>(
        r#"SELECT
               d.id,
               d.producto_id,
               p.nombre AS producto_nombre,
               pres.nombre AS presentacion_nombre,
               d.cantidad_solicitada,
               d.cantidad_recibida,
               d.precio_unitario,
               d.unidad,
               a.nombre AS area_destino_nombre
           FROM orden_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN presentaciones pres ON pres.id = d.presentacion_id
           LEFT JOIN areas a ON a.id = d.area_destino_id
           WHERE d.orden_compra_id = $1
           ORDER BY d.id"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    let recepciones = sqlx::query_as::<_, RecepcionVinculadaRow>(
        r#"SELECT
               r.id,
               r.numero_documento,
               r.estado,
               r.fecha_recepcion,
               u.nombre AS usuario_nombre,
               r.guia_despacho,
               r.guia_despacho_archivo
           FROM recepciones r
           JOIN usuarios u ON u.id = r.usuario_id
           WHERE r.orden_compra_id = $1
           ORDER BY r.fecha_recepcion DESC"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "orden_compra": cabecera,
        "items": items,
        "recepciones": recepciones
    })))
}

/// POST /api/v1/ordenes-compra/:id/enviar — Marcar como enviada (admin only)
async fn marcar_enviada(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Check existence and current state
    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM ordenes_compra WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    match estado.as_deref() {
        None => return Err(AppError::NotFound("Orden de compra no encontrada".into())),
        Some(e) if e != "borrador" => {
            return Err(AppError::BusinessLogic(
                format!(
                    "Solo se pueden enviar órdenes en estado 'borrador', está en '{}'",
                    e
                ),
                "ESTADO_INVALIDO".into(),
            ));
        }
        _ => {}
    }

    sqlx::query("UPDATE ordenes_compra SET estado = 'enviada', updated_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(
        serde_json::json!({ "status": "success", "estado": "enviada" }),
    ))
}

/// POST /api/v1/ordenes-compra/:id/cancelar — Cancelar orden (admin only)
async fn cancelar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM ordenes_compra WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    match estado.as_deref() {
        None => return Err(AppError::NotFound("Orden de compra no encontrada".into())),
        Some(e) if e != "borrador" && e != "enviada" => {
            return Err(AppError::BusinessLogic(
                format!(
                    "Solo se pueden cancelar órdenes en estado 'borrador' o 'enviada', está en '{}'",
                    e
                ),
                "ESTADO_INVALIDO".into(),
            ));
        }
        _ => {}
    }

    sqlx::query("UPDATE ordenes_compra SET estado = 'cancelada', updated_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(
        serde_json::json!({ "status": "success", "estado": "cancelada" }),
    ))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener))
        .route("/{id}/enviar", post(marcar_enviada))
        .route("/{id}/cancelar", post(cancelar))
}

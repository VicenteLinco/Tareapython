use axum::extract::{Path, State, Query};
use axum::{Json, Router, Extension};
use axum::routing::{get, post};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
pub struct CreateSolicitudRequest {
    pub nota: Option<String>,
    pub items: Vec<CreateSolicitudItem>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSolicitudItem {
    pub producto_id: Uuid,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SolicitudResumen {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub items_count: i64,
    pub nota_revision: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SolicitudDetalle {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub nota_revision: Option<String>,
    pub fecha_revision: Option<DateTime<Utc>>,
    pub revisado_por_nombre: Option<String>,
    pub items: Vec<SolicitudDetalleItem>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SolicitudDetalleItem {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_nombre: Option<String>,
    pub presentacion_nombre: Option<String>,
    pub factor_conversion: Option<Decimal>,
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    let solicitud_id: Uuid = sqlx::query_scalar(
        "INSERT INTO solicitudes_compra (usuario_id, nota) VALUES ($1, $2) RETURNING id"
    )
    .bind(claims.sub)
    .bind(&payload.nota)
    .fetch_one(&mut *tx)
    .await?;

    for item in payload.items {
        sqlx::query(
            "INSERT INTO solicitud_compra_detalle (solicitud_id, producto_id, cantidad_sugerida, unidad)
             VALUES ($1, $2, $3, $4)"
        )
        .bind(solicitud_id)
        .bind(item.producto_id)
        .bind(item.cantidad_sugerida)
        .bind(item.unidad)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let numero: String = sqlx::query_scalar("SELECT numero_documento FROM solicitudes_compra WHERE id = $1")
        .bind(solicitud_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({
        "id": solicitud_id,
        "numero_documento": numero,
        "status": "success"
    })))
}

#[derive(Debug, Deserialize)]
pub struct RevisionSolicitudRequest {
    pub estado: String, // 'aprobada' o 'rechazada'
    pub nota_revision: Option<String>,
}

async fn revisar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<RevisionSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Solo admin puede revisar
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if payload.estado != "aprobada" && payload.estado != "rechazada" {
        return Err(AppError::Validation("Estado inválido para revisión (usar 'aprobada' o 'rechazada')".into()));
    }

    let filas = sqlx::query(
        "UPDATE solicitudes_compra 
         SET estado = $1, nota_revision = $2, fecha_revision = NOW(), revisado_por = $3
         WHERE id = $4 AND estado = 'pendiente'"
    )
    .bind(&payload.estado)
    .bind(&payload.nota_revision)
    .bind(claims.sub)
    .bind(id)
    .execute(&state.pool)
    .await?;

    if filas.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se pueden revisar solicitudes en estado 'pendiente'".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    Ok(Json(serde_json::json!({ "status": "success", "estado": payload.estado })))
}

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pagination = params.validated()?;
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM solicitudes_compra")
        .fetch_one(&state.pool)
        .await?;

    let solicitudes = sqlx::query_as::<_, SolicitudResumen>(
        r#"SELECT 
            s.id, s.numero_documento, s.fecha_creacion, s.estado,
            u.nombre as usuario_nombre,
            (SELECT COUNT(*) FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count,
            s.nota_revision
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           ORDER BY s.fecha_creacion DESC
           LIMIT $1 OFFSET $2"#
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "data": solicitudes,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": (total + limit - 1) / limit
    })))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    let solicitud = sqlx::query_as::<_, SolicitudDetalleRow>(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado, s.nota, 
                  s.nota_revision, s.fecha_revision,
                  u.nombre as usuario_nombre,
                  ur.nombre as revisado_por_nombre
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           LEFT JOIN usuarios ur ON ur.id = s.revisado_por
           WHERE s.id = $1"#
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Solicitud no encontrada".into()))?;

    let items = sqlx::query_as::<_, SolicitudDetalleItem>(
        r#"SELECT 
            d.producto_id, 
            p.nombre as producto_nombre, 
            d.cantidad_sugerida, 
            d.unidad,
            p.codigo_proveedor,
            p.codigo_maestro,
            prov.nombre as proveedor_nombre,
            pres.nombre as presentacion_nombre,
            pres.factor_conversion
           FROM solicitud_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
           LEFT JOIN LATERAL (
               SELECT nombre, factor_conversion 
               FROM presentaciones 
               WHERE producto_id = p.id AND activa = true 
               ORDER BY factor_conversion DESC, created_at ASC 
               LIMIT 1
           ) pres ON true
           WHERE d.solicitud_id = $1
           ORDER BY p.nombre"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(SolicitudDetalle {
        id: solicitud.id,
        numero_documento: solicitud.numero_documento,
        fecha_creacion: solicitud.fecha_creacion,
        estado: solicitud.estado,
        usuario_nombre: solicitud.usuario_nombre,
        nota: solicitud.nota,
        nota_revision: solicitud.nota_revision,
        fecha_revision: solicitud.fecha_revision,
        revisado_por_nombre: solicitud.revisado_por_nombre,
        items,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SolicitudDetalleRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub nota: Option<String>,
    pub nota_revision: Option<String>,
    pub fecha_revision: Option<DateTime<Utc>>,
    pub usuario_nombre: String,
    pub revisado_por_nombre: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener))
        .route("/{id}/revisar", post(revisar))
}

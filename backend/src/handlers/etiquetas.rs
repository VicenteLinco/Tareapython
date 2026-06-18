use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use uuid::Uuid;

use crate::db::AppState;
use crate::dto::etiqueta::{EtiquetaLote, EtiquetaPresentacion};
use crate::errors::AppError;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/presentacion/:id", get(get_etiqueta_presentacion))
        .route("/lote/:id", get(get_etiqueta_lote))
}

async fn get_etiqueta_presentacion(
    State(state): State<AppState>,
    Path(presentacion_id): Path<i32>,
) -> Result<Json<EtiquetaPresentacion>, AppError> {
    let row = sqlx::query_as!(
        EtiquetaPresentacion,
        r#"SELECT
            pr.id AS presentacion_id,
            pr.gtin,
            pr.nombre,
            pr.nombre_plural,
            pr.sku,
            p.nombre AS producto_nombre,
            pr.codigo_barras
           FROM presentaciones pr
           JOIN productos p ON p.id = pr.producto_id
           WHERE pr.id = $1 AND pr.activa = true"#,
        presentacion_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Presentación no encontrada".to_string()))?;
    Ok(Json(row))
}

async fn get_etiqueta_lote(
    State(state): State<AppState>,
    Path(lote_id): Path<Uuid>,
) -> Result<Json<EtiquetaLote>, AppError> {
    let row = sqlx::query_as!(
        EtiquetaLote,
        r#"SELECT
            l.id AS lote_id,
            pr.gtin,
            l.numero_lote,
            l.fecha_vencimiento,
            l.fecha_fabricacion,
            p.nombre AS producto_nombre,
            pr.nombre AS "presentacion_nombre?",
            prov.nombre AS "proveedor_nombre?"
           FROM lotes l
           JOIN productos p ON p.id = l.producto_id
           LEFT JOIN presentaciones pr ON pr.id = l.presentacion_id
           LEFT JOIN proveedores prov ON prov.id = l.proveedor_id
           WHERE l.id = $1"#,
        lote_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Lote no encontrado".to_string()))?;
    Ok(Json(row))
}

use axum::extract::{Path, State, Query};
use axum::{Json, Router, Extension};
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Deserialize)]
struct SolicitudListParams {
    page: Option<i64>,
    per_page: Option<i64>,
    q: Option<String>,
    estado: Option<String>,
    proveedor_id: Option<i32>,
}

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::solicitud::{
    CreateSolicitudItem, ItemRecomendado, SolicitudDetalle, SolicitudDetalleItem,
    SolicitudResumen, UpdateSolicitudRequest,
};
use crate::errors::AppError;

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

async fn obtener_solicitud_por_id(
    id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<SolicitudDetalle, AppError> {
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
    .fetch_optional(pool)
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
            pres.nombre_plural as presentacion_nombre_plural,
            pres.factor_conversion,
            d.precio_unitario,
            d.presentacion_id,
            d.cantidad_presentaciones,
            p.imagen_url
           FROM solicitud_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
           LEFT JOIN presentaciones pres ON pres.id = d.presentacion_id
           WHERE d.solicitud_id = $1
           ORDER BY p.nombre"#,
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    Ok(SolicitudDetalle {
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
    })
}

async fn insertar_item(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    solicitud_id: Uuid,
    item: &CreateSolicitudItem,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO solicitud_compra_detalle
         (solicitud_id, producto_id, cantidad_sugerida, unidad,
          precio_unitario, presentacion_id, cantidad_presentaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(solicitud_id)
    .bind(item.producto_id)
    .bind(item.cantidad_sugerida)
    .bind(&item.unidad)
    .bind(item.precio_unitario)
    .bind(item.presentacion_id)
    .bind(item.cantidad_presentaciones)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Si ya existe un borrador para este usuario, actualizarlo en lugar de crear uno nuevo
    let borrador_existente: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM solicitudes_compra
         WHERE usuario_id = $1 AND estado = 'borrador'
         LIMIT 1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(id) = borrador_existente {
        let mut tx = state.pool.begin().await?;
        sqlx::query("DELETE FROM solicitud_compra_detalle WHERE solicitud_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE solicitudes_compra SET nota = $1 WHERE id = $2")
            .bind(&payload.nota)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for item in &payload.items {
            insertar_item(&mut tx, id, item).await?;
        }
        tx.commit().await?;
        return Ok(Json(serde_json::json!({ "id": id })));
    }

    let mut tx = state.pool.begin().await?;

    let (solicitud_id, _numero): (Uuid, String) = sqlx::query_as(
        "INSERT INTO solicitudes_compra (usuario_id, nota, estado)
         VALUES ($1, $2, 'borrador') RETURNING id, numero_documento"
    )
    .bind(claims.sub)
    .bind(&payload.nota)
    .fetch_one(&mut *tx)
    .await?;

    for item in &payload.items {
        insertar_item(&mut tx, solicitud_id, item).await?;
    }

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": solicitud_id })))
}

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<SolicitudListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.unwrap_or(20).max(1);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let mut where_clauses: Vec<String> = Vec::new();
    let mut bind_idx: i32 = 1;

    if params.q.is_some() {
        where_clauses.push(format!(
            "(s.numero_documento ILIKE ${} OR u.nombre ILIKE ${})",
            bind_idx, bind_idx + 1
        ));
        bind_idx += 2;
    }
    if params.estado.is_some() {
        where_clauses.push(format!("s.estado = ${}", bind_idx));
        bind_idx += 1;
    }
    if params.proveedor_id.is_some() {
        where_clauses.push(format!(
            "EXISTS (SELECT 1 FROM solicitud_compra_detalle scd JOIN productos p ON p.id = scd.producto_id WHERE scd.solicitud_id = s.id AND p.proveedor_id = ${})",
            bind_idx
        ));
        bind_idx += 1;
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM solicitudes_compra s JOIN usuarios u ON u.id = s.usuario_id {}",
        where_sql
    );
    let list_sql = format!(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado,
                u.nombre as usuario_nombre,
                (SELECT COUNT(*)::integer FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count,
                s.nota_revision
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           {} ORDER BY s.fecha_creacion DESC
           LIMIT ${} OFFSET ${}"#,
        where_sql, bind_idx, bind_idx + 1
    );

    let q_pattern = params.q.as_ref().map(|q| format!("%{}%", q));

    // Bind helpers — we build both queries with the same bind sequence
    macro_rules! bind_filters {
        ($query:expr) => {{
            let mut q = $query;
            if let Some(ref pat) = q_pattern {
                q = q.bind(pat).bind(pat);
            }
            if let Some(ref estado) = params.estado {
                q = q.bind(estado);
            }
            if let Some(proveedor_id) = params.proveedor_id {
                q = q.bind(proveedor_id);
            }
            q
        }};
    }

    let total: i64 = bind_filters!(sqlx::query_scalar::<_, i64>(&count_sql))
        .fetch_one(&state.pool)
        .await?;

    let solicitudes = bind_filters!(sqlx::query_as::<_, SolicitudResumen>(&list_sql))
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    Ok(Json(serde_json::json!({
        "data": solicitudes,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages
    })))
}

pub async fn recomendaciones(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, ItemRecomendado>(
        r#"WITH consumo AS (
            SELECT
                l.producto_id,
                (SUM(m.cantidad) / 30.0)::DECIMAL(15,4) AS consumo_diario_30d
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE m.tipo = 'CONSUMO'
              AND m.created_at >= NOW() - INTERVAL '30 days'
            GROUP BY l.producto_id
        ),
        stock_total AS (
            SELECT producto_id, SUM(cantidad) AS stock_actual
            FROM stock
            GROUP BY producto_id
        ),
        ultimo_precio AS (
            SELECT DISTINCT ON (rd.producto_id)
                rd.producto_id,
                rd.precio_unitario
            FROM recepcion_detalle rd
            JOIN recepciones r ON r.id = rd.recepcion_id
            WHERE rd.precio_unitario IS NOT NULL
              AND r.estado IN ('completa', 'parcial')
            ORDER BY rd.producto_id, r.fecha_recepcion DESC
        ),
        pres AS (
            SELECT DISTINCT ON (producto_id)
                producto_id, id, nombre, nombre_plural, factor_conversion
            FROM presentaciones
            WHERE activa = true
            ORDER BY producto_id, factor_conversion DESC
        ),
        pendientes AS (
            SELECT scd.producto_id, COUNT(*)::i32 as count
            FROM solicitud_compra_detalle scd
            JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
            WHERE sc.estado IN ('pendiente', 'aprobada', 'enviada')
            GROUP BY scd.producto_id
        ),
        base AS (
            SELECT
                p.id                                                              AS producto_id,
                p.nombre                                                          AS producto_nombre,
                p.codigo_proveedor,
                p.codigo_maestro,
                prov.id                                                           AS proveedor_id,
                prov.nombre                                                       AS proveedor_nombre,
                COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)::INT
                                                                                  AS lead_time,
                CASE
                    WHEN COALESCE(c.consumo_diario_30d, 0) > 0
                    THEN (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)::FLOAT
                    ELSE NULL
                END                                                               AS autonomia_dias,
                CASE
                    WHEN COALESCE(c.consumo_diario_30d, 0) <= 0
                         AND COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0)
                        THEN 'critico'
                    WHEN COALESCE(c.consumo_diario_30d, 0) > 0
                         AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                             < COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                        THEN 'critico'
                    WHEN COALESCE(c.consumo_diario_30d, 0) > 0
                         AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                             < COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 1.5
                        THEN 'urgente'
                    WHEN COALESCE(c.consumo_diario_30d, 0) > 0
                         AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                             < COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 2.5
                        THEN 'planificar'
                    ELSE NULL
                END                                                               AS nivel_urgencia,
                COALESCE(st.stock_actual, 0)                                      AS stock_actual,
                COALESCE(p.stock_minimo, 0)                                       AS stock_minimo,
                COALESCE(c.consumo_diario_30d, 0)                                 AS consumo_diario_30d,
                GREATEST(0, CEIL(
                    COALESCE(p.stock_minimo, 0) * 2
                    + COALESCE(c.consumo_diario_30d, 0)
                      * COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                    - COALESCE(st.stock_actual, 0)
                ))                                                                AS cantidad_sugerida_base,
                pres.id                                                           AS presentacion_id,
                pres.nombre                                                       AS presentacion_nombre,
                pres.nombre_plural                                                AS presentacion_nombre_plural,
                pres.factor_conversion,
                CASE
                    WHEN pres.factor_conversion IS NOT NULL AND pres.factor_conversion > 0
                    THEN CEIL(
                        GREATEST(0,
                            COALESCE(p.stock_minimo, 0) * 2
                            + COALESCE(c.consumo_diario_30d, 0)
                              * COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                            - COALESCE(st.stock_actual, 0)
                        ) / pres.factor_conversion
                    )
                    ELSE NULL
                END                                                               AS cantidad_sugerida_presentacion,
                COALESCE(up.precio_unitario, p.precio_unidad)                      AS precio_ultima_recepcion,
                ub.nombre                                                         AS unidad_base,
                ub.nombre_plural                                                  AS unidad_base_plural,
                COALESCE(pend.count, 0)                                           AS solicitudes_pendientes,
                p.imagen_url                                                      AS imagen_url
            FROM productos p
            LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
            LEFT JOIN consumo c ON c.producto_id = p.id
            LEFT JOIN stock_total st ON st.producto_id = p.id
            LEFT JOIN ultimo_precio up ON up.producto_id = p.id
            LEFT JOIN pres ON pres.producto_id = p.id
            LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
            LEFT JOIN pendientes pend ON pend.producto_id = p.id
            WHERE p.activo = true
        )
        SELECT *
        FROM base
        WHERE nivel_urgencia IS NOT NULL
        ORDER BY
            CASE nivel_urgencia
                WHEN 'critico'    THEN 1
                WHEN 'urgente'    THEN 2
                WHEN 'planificar' THEN 3
                ELSE 4
            END,
            COALESCE(autonomia_dias, 0)
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "data": items })))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    Ok(Json(obtener_solicitud_por_id(id, &state.pool).await?))
}

async fn actualizar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT estado FROM solicitudes_compra WHERE id = $1"
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;

    match exists.as_deref() {
        None => return Err(AppError::NotFound("Solicitud no encontrada".into())),
        Some("borrador") => {}
        Some(_) => return Err(AppError::BusinessLogic(
            "Solo se puede editar una solicitud en borrador".into(),
            "ESTADO_INVALIDO".into(),
        )),
    }

    let mut tx = state.pool.begin().await?;

    sqlx::query("DELETE FROM solicitud_compra_detalle WHERE solicitud_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE solicitudes_compra SET nota = $1 WHERE id = $2")
        .bind(&req.nota)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    for item in &req.items {
        insertar_item(&mut tx, id, item).await?;
    }

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn enviar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "UPDATE solicitudes_compra SET estado = 'aprobada' WHERE id = $1 AND estado = 'borrador'"
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se puede generar una solicitud en borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_borrador(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let borrador_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM solicitudes_compra WHERE usuario_id = $1 AND estado = 'borrador' LIMIT 1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    match borrador_id {
        None => Ok(Json(serde_json::json!({ "borrador": null }))),
        Some(id) => {
            let detalle = obtener_solicitud_por_id(id, &state.pool).await?;
            Ok(Json(serde_json::json!({ "borrador": detalle })))
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/borrador", get(get_borrador))
        .route("/recomendaciones", get(recomendaciones))
        .route("/{id}", get(obtener).put(actualizar))
        .route("/{id}/enviar", post(enviar))
}

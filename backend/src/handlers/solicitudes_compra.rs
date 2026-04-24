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

#[derive(Debug, Deserialize)]
struct HorizonteParams {
    producto_id: Uuid,
    proveedor_id: i32,
}

#[derive(Debug, Serialize)]
struct HorizonteFactores {
    ciclo_historico_dias: Option<i32>,
    n_pedidos_historico: i32,
    coeficiente_variacion: f64,
    multiplicador_variabilidad: f64,
    lead_time: i32,
}

#[derive(Debug, Serialize)]
struct HorizonteResponse {
    horizonte_sugerido: i32,
    razon: String,
    consumo_diario: f64,
    stock_actual: f64,
    stock_minimo: f64,
    factores: HorizonteFactores,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SolicitudDetalleRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: String,
    pub nota: Option<String>,
    pub usuario_nombre: String,
}

async fn obtener_solicitud_por_id(
    id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<SolicitudDetalle, AppError> {
    let solicitud = sqlx::query_as::<_, SolicitudDetalleRow>(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado, s.nota,
                  u.nombre as usuario_nombre
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
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
            ub.nombre_plural as unidad_plural,
            p.codigo_proveedor,
            p.codigo_maestro,
            prov.nombre as proveedor_nombre,
            pres.nombre as presentacion_nombre,
            pres.nombre_plural as presentacion_nombre_plural,
            pres.factor_conversion,
            d.precio_unitario,
            d.presentacion_id,
            d.cantidad_presentaciones,
            p.imagen_url,
            d.horizonte_dias,
            d.horizonte_sugerido,
            d.horizonte_razon
           FROM solicitud_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
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
          precio_unitario, presentacion_id, cantidad_presentaciones,
          horizonte_dias, horizonte_sugerido, horizonte_razon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    )
    .bind(solicitud_id)
    .bind(item.producto_id)
    .bind(item.cantidad_sugerida)
    .bind(&item.unidad)
    .bind(item.precio_unitario)
    .bind(item.presentacion_id)
    .bind(item.cantidad_presentaciones)
    .bind(item.horizonte_dias)
    .bind(item.horizonte_sugerido)
    .bind(&item.horizonte_razon)
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

    let insert_result = sqlx::query_as::<_, (Uuid, String)>(
        "INSERT INTO solicitudes_compra (usuario_id, nota, estado)
         VALUES ($1, $2, 'borrador') RETURNING id, numero_documento"
    )
    .bind(claims.sub)
    .bind(&payload.nota)
    .fetch_one(&mut *tx)
    .await;

    let solicitud_id = match insert_result {
        Ok((id, _)) => id,
        Err(sqlx::Error::Database(ref db_err)) if db_err.is_unique_violation() => {
            // Race condition: another request inserted a draft between our SELECT and this INSERT.
            // Roll back and return the existing draft id.
            tx.rollback().await.ok();
            let existing_id: Uuid = sqlx::query_scalar(
                "SELECT id FROM solicitudes_compra WHERE usuario_id = $1 AND estado = 'borrador' LIMIT 1"
            )
            .bind(claims.sub)
            .fetch_one(&state.pool)
            .await?;
            return Ok(Json(serde_json::json!({ "id": existing_id })));
        }
        Err(e) => return Err(e.into()),
    };

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
    let per_page = params.per_page.unwrap_or(20).max(1).min(100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let q_pattern = params.q.as_ref().map(|q| format!("%{}%", q));

    // ── COUNT ────────────────────────────────────────────────────────────────
    let mut count_builder: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
        "SELECT COUNT(*) FROM solicitudes_compra s JOIN usuarios u ON u.id = s.usuario_id WHERE 1=1"
    );
    if let Some(ref pat) = q_pattern {
        count_builder.push(" AND (s.numero_documento ILIKE ");
        count_builder.push_bind(pat);
        count_builder.push(" OR u.nombre ILIKE ");
        count_builder.push_bind(pat);
        count_builder.push(")");
    }
    if let Some(ref estado) = params.estado {
        count_builder.push(" AND s.estado = ");
        count_builder.push_bind(estado);
    }
    if let Some(proveedor_id) = params.proveedor_id {
        count_builder.push(
            " AND EXISTS (SELECT 1 FROM solicitud_compra_detalle scd \
             JOIN productos p ON p.id = scd.producto_id \
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = "
        );
        count_builder.push_bind(proveedor_id);
        count_builder.push(")");
    }
    let total: i64 = count_builder
        .build_query_scalar()
        .fetch_one(&state.pool)
        .await?;

    // ── LIST ─────────────────────────────────────────────────────────────────
    let mut list_builder: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado,
                  u.nombre as usuario_nombre,
                  (SELECT COUNT(*)::integer FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           WHERE 1=1"#
    );
    if let Some(ref pat) = q_pattern {
        list_builder.push(" AND (s.numero_documento ILIKE ");
        list_builder.push_bind(pat);
        list_builder.push(" OR u.nombre ILIKE ");
        list_builder.push_bind(pat);
        list_builder.push(")");
    }
    if let Some(ref estado) = params.estado {
        list_builder.push(" AND s.estado = ");
        list_builder.push_bind(estado);
    }
    if let Some(proveedor_id) = params.proveedor_id {
        list_builder.push(
            " AND EXISTS (SELECT 1 FROM solicitud_compra_detalle scd \
             JOIN productos p ON p.id = scd.producto_id \
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = "
        );
        list_builder.push_bind(proveedor_id);
        list_builder.push(")");
    }
    list_builder.push(" ORDER BY s.fecha_creacion DESC LIMIT ");
    list_builder.push_bind(per_page);
    list_builder.push(" OFFSET ");
    list_builder.push_bind(offset);

    let solicitudes = list_builder
        .build_query_as::<SolicitudResumen>()
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
        r#"WITH
cfg AS (
    SELECT
        COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_consumo_dias'), 30)  AS ventana_dias,
        COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30) AS revision_dias
),
consumo AS (
    SELECT
        l.producto_id,
        (SUM(m.cantidad)::float
            / GREATEST(DATE_PART('day', NOW() - MIN(m.created_at)), 1)
        )::DECIMAL(15,6)                                              AS consumo_diario,
        DATE_PART('day', NOW() - MIN(m.created_at))::INT              AS dias_historia
    FROM movimientos m
    JOIN lotes l ON l.id = m.lote_id
    WHERE m.tipo = 'CONSUMO'
      AND m.created_at >= NOW() - ((SELECT ventana_dias FROM cfg) * INTERVAL '1 day')
    GROUP BY l.producto_id
),
stock_total AS (
    SELECT l.producto_id, SUM(s.cantidad) AS stock_actual
    FROM stock s
    JOIN lotes l ON l.id = s.lote_id
    GROUP BY l.producto_id
),
pedidos_en_vuelo AS (
    SELECT
        scd.producto_id,
        SUM(scd.cantidad_sugerida) AS cantidad_pedida
    FROM solicitud_compra_detalle scd
    JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
    JOIN productos p2 ON p2.id = scd.producto_id
    LEFT JOIN proveedores prov2 ON prov2.id = p2.proveedor_id
    WHERE sc.estado = 'guardada'
      AND sc.fecha_creacion >= NOW() - (
          COALESCE(prov2.dias_despacho_tierra, prov2.dias_despacho_aereo, 7)::int
          * 2 * INTERVAL '1 day'
      )
    GROUP BY scd.producto_id
),
ultimo_precio AS (
    SELECT DISTINCT ON (rd.producto_id)
        rd.producto_id,
        CASE
            WHEN rd.factor_conversion_usado IS NOT NULL AND rd.factor_conversion_usado > 0
            THEN rd.precio_unitario / rd.factor_conversion_usado
            ELSE rd.precio_unitario
        END AS precio_unitario
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
base AS (
    SELECT
        p.id                                                                    AS producto_id,
        p.nombre                                                                AS producto_nombre,
        p.codigo_proveedor,
        p.codigo_maestro,
        prov.id                                                                 AS proveedor_id,
        prov.nombre                                                             AS proveedor_nombre,
        COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)::INT  AS lead_time,
        COALESCE(st.stock_actual, 0)                                            AS stock_actual,
        COALESCE(p.stock_minimo, 0)                                             AS stock_seguridad,
        COALESCE(c.consumo_diario, 0)                                           AS consumo_diario,
        COALESCE(c.dias_historia, 0)::INT                                       AS dias_historia,
        CASE
            WHEN COALESCE(c.consumo_diario, 0) > 0
            THEN (COALESCE(st.stock_actual, 0)::float / c.consumo_diario::float)
            ELSE NULL
        END                                                                     AS autonomia_dias,
        CASE
            WHEN COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0)
                THEN 'critica'
            WHEN COALESCE(c.consumo_diario, 0) > 0
              AND COALESCE(st.stock_actual, 0) < (
                  COALESCE(p.stock_minimo, 0)
                  + COALESCE(c.consumo_diario, 0)
                  * COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
              )
                THEN 'alta'
            ELSE NULL
        END                                                                     AS nivel_urgencia,
        GREATEST(0, CEIL(
            COALESCE(p.stock_minimo, 0)
            + COALESCE(c.consumo_diario, 0) * (
                COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                + cfg.revision_dias
            )
            - COALESCE(st.stock_actual, 0)
            - COALESCE(pev.cantidad_pedida, 0)
        ))                                                                      AS cantidad_sugerida_base,
        pres.id                                                                 AS presentacion_id,
        pres.nombre                                                             AS presentacion_nombre,
        pres.nombre_plural                                                      AS presentacion_nombre_plural,
        pres.factor_conversion,
        CASE
            WHEN pres.factor_conversion IS NOT NULL AND pres.factor_conversion > 0
            THEN CEIL(
                GREATEST(0,
                    COALESCE(p.stock_minimo, 0)
                    + COALESCE(c.consumo_diario, 0) * (
                        COALESCE(prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                        + cfg.revision_dias
                    )
                    - COALESCE(st.stock_actual, 0)
                    - COALESCE(pev.cantidad_pedida, 0)
                ) / pres.factor_conversion
            )
            ELSE NULL
        END                                                                     AS cantidad_sugerida_presentacion,
        COALESCE(up.precio_unitario, p.precio_unidad)                           AS precio_ultima_recepcion,
        ub.nombre                                                               AS unidad_base,
        ub.nombre_plural                                                        AS unidad_base_plural,
        p.imagen_url,
        COALESCE(pev.cantidad_pedida, 0)                                        AS ya_pedido_unidades
    FROM productos p
    CROSS JOIN cfg
    LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
    LEFT JOIN consumo c ON c.producto_id = p.id
    LEFT JOIN stock_total st ON st.producto_id = p.id
    LEFT JOIN ultimo_precio up ON up.producto_id = p.id
    LEFT JOIN pres ON pres.producto_id = p.id
    LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
    LEFT JOIN pedidos_en_vuelo pev ON pev.producto_id = p.id
    WHERE p.activo = true
      AND p.deleted_at IS NULL
)
SELECT *
FROM base
WHERE nivel_urgencia IS NOT NULL
ORDER BY
    CASE nivel_urgencia
        WHEN 'critica' THEN 1
        WHEN 'alta'    THEN 2
        ELSE 3
    END,
    COALESCE(autonomia_dias, 0)"#
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

async fn guardar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "UPDATE solicitudes_compra SET estado = 'guardada' WHERE id = $1 AND estado = 'borrador'"
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se puede guardar una solicitud en borrador".into(),
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

async fn horizonte_sugerido(
    State(state): State<AppState>,
    Query(params): Query<HorizonteParams>,
) -> Result<Json<HorizonteResponse>, AppError> {
    // ── 1. Ciclo histórico ──────────────────────────────────────────────────
    let ciclo_row = sqlx::query!(
        r#"
        SELECT
            COUNT(gap_dias)::INT                         AS "n_pedidos!: i32",
            AVG(gap_dias)::INT                           AS "ciclo_dias?: i32"
        FROM (
            SELECT DATE_PART('day',
                LAG(fecha_creacion) OVER (ORDER BY fecha_creacion DESC)
                - fecha_creacion
            )::INT AS gap_dias
            FROM (
                SELECT DISTINCT sc.fecha_creacion
                FROM solicitudes_compra sc
                JOIN solicitud_compra_detalle scd ON scd.solicitud_id = sc.id
                WHERE scd.producto_id = $1
                  AND sc.estado IN ('guardada', 'aprobada')
                ORDER BY sc.fecha_creacion DESC
                LIMIT 5
            ) pedidos
        ) gaps
        WHERE gap_dias IS NOT NULL
        "#,
        params.producto_id
    )
    .fetch_one(&state.pool)
    .await?;

    let n_pedidos = ciclo_row.n_pedidos;
    let ciclo_dias = ciclo_row.ciclo_dias;

    // ── 2. Variabilidad de consumo semanal (últimos 90 días) ───────────────
    let var_row = sqlx::query!(
        r#"
        SELECT
            COALESCE(AVG(consumo_semana), 0)::FLOAT8    AS "media!: f64",
            COALESCE(STDDEV(consumo_semana), 0)::FLOAT8 AS "stddev!: f64"
        FROM (
            SELECT DATE_TRUNC('week', m.created_at),
                   SUM(m.cantidad)::FLOAT8 AS consumo_semana
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE l.producto_id = $1
              AND m.tipo = 'CONSUMO'
              AND m.created_at >= NOW() - INTERVAL '90 days'
            GROUP BY DATE_TRUNC('week', m.created_at)
        ) semanas
        "#,
        params.producto_id
    )
    .fetch_one(&state.pool)
    .await?;

    let media = var_row.media;
    let stddev = var_row.stddev;
    let cv = if media > 0.0 { stddev / media } else { 0.0 };

    // ── 3. Lead time, stock actual, stock mínimo, consumo diario ──────────
    let info_row = sqlx::query!(
        r#"
        SELECT
            COALESCE(p.stock_minimo, 0)::FLOAT8                        AS "stock_minimo!: f64",
            COALESCE(
                (SELECT SUM(s.cantidad)::FLOAT8
                 FROM stock s JOIN lotes l2 ON l2.id = s.lote_id
                 WHERE l2.producto_id = p.id), 0
            )                                                           AS "stock_actual!: f64",
            COALESCE(prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                 AS "lead_time!: i32",
            COALESCE(
                (SELECT (SUM(m.cantidad)::FLOAT8 /
                    GREATEST(DATE_PART('day', NOW() - MIN(m.created_at)), 1))
                 FROM movimientos m JOIN lotes l3 ON l3.id = m.lote_id
                 WHERE l3.producto_id = p.id AND m.tipo = 'CONSUMO'
                   AND m.created_at >= NOW() - INTERVAL '30 days'
                ), 0
            )                                                           AS "consumo_diario!: f64"
        FROM productos p
        LEFT JOIN proveedores prov ON prov.id = $2
        WHERE p.id = $1
        "#,
        params.producto_id,
        params.proveedor_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

    let lead_time = info_row.lead_time;
    let stock_minimo = info_row.stock_minimo;
    let stock_actual = info_row.stock_actual;
    let consumo_diario = info_row.consumo_diario;

    // ── 4. Algoritmo de horizonte ──────────────────────────────────────────
    let (horizonte_base, razon_base) = if n_pedidos >= 2 {
        let dias = ciclo_dias.unwrap_or(30);
        (dias, format!("ciclo histórico ~{}d con este proveedor", dias))
    } else {
        let fallback = ((lead_time as f64 * 3.0) as i32).max(30);
        (fallback, "sin historial — estimación conservadora".to_string())
    };

    let (multiplicador, razon) = if n_pedidos >= 2 {
        if cv < 0.3 {
            (1.0f64, razon_base)
        } else if cv < 0.7 {
            (1.3f64, format!("ciclo histórico ~{}d + buffer por consumo variable",
                ciclo_dias.unwrap_or(30)))
        } else {
            (1.5f64, format!("ciclo histórico ~{}d + buffer por consumo irregular",
                ciclo_dias.unwrap_or(30)))
        }
    } else {
        (1.0f64, razon_base)
    };

    let horizonte_ajustado = (horizonte_base as f64 * multiplicador) as i32;
    let piso = ((lead_time as f64 * 1.5) as i32).max(7);
    let horizonte_sugerido = horizonte_ajustado.max(piso);

    Ok(Json(HorizonteResponse {
        horizonte_sugerido,
        razon,
        consumo_diario,
        stock_actual,
        stock_minimo,
        factores: HorizonteFactores {
            ciclo_historico_dias: ciclo_dias,
            n_pedidos_historico: n_pedidos,
            coeficiente_variacion: (cv * 100.0).round() / 100.0,
            multiplicador_variabilidad: multiplicador,
            lead_time,
        },
    }))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/borrador", get(get_borrador))
        .route("/recomendaciones", get(recomendaciones))
        .route("/horizonte", get(horizonte_sugerido))
        .route("/{id}", get(obtener).put(actualizar))
        .route("/{id}/guardar", post(guardar))
}

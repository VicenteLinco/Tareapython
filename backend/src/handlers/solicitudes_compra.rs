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
    CreateSolicitudItem, SolicitudDetalle, SolicitudDetalleItem,
    SolicitudResumen, UpdateSolicitudRequest,
};
use crate::errors::AppError;
use crate::services::forecast::{self, compute_forecast, ForecastConfig};

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
    // 1. Cargar configuración
    let cfg = load_forecast_config(&state.pool).await?;

    // 2. Una sola query: por producto, devuelve la serie diaria de consumo
    //    de los últimos `ventana_demanda_dias` días + metadata.
    let rows = sqlx::query!(
        r#"
        WITH ventana AS (
            SELECT NOW() - ($1::int * INTERVAL '1 day') AS desde
        ),
        dias AS (
            SELECT generate_series(
                (SELECT desde FROM ventana)::date,
                NOW()::date,
                INTERVAL '1 day'
            )::date AS dia
        ),
        productos_con_movimiento AS (
            SELECT DISTINCT l.producto_id
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
        ),
        consumo_dia AS (
            SELECT
                l.producto_id,
                m.created_at::date AS dia,
                SUM(m.cantidad)::FLOAT8 AS cantidad
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
            GROUP BY l.producto_id, m.created_at::date
        ),
        series AS (
            SELECT
                pcm.producto_id,
                array_agg(COALESCE(cd.cantidad, 0) ORDER BY d.dia)::FLOAT8[] AS serie
            FROM productos_con_movimiento pcm
            CROSS JOIN dias d
            LEFT JOIN consumo_dia cd
              ON cd.producto_id = pcm.producto_id AND cd.dia = d.dia
            GROUP BY pcm.producto_id
        ),
        stock_total AS (
            SELECT l.producto_id, SUM(s.cantidad)::FLOAT8 AS stock_actual
            FROM stock s
            JOIN lotes l ON l.id = s.lote_id
            GROUP BY l.producto_id
        ),
        pedidos_en_vuelo AS (
            SELECT
                scd.producto_id,
                SUM(scd.cantidad_sugerida)::FLOAT8 AS cantidad_pedida
            FROM solicitud_compra_detalle scd
            JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
            JOIN productos p2 ON p2.id = scd.producto_id
            LEFT JOIN proveedores prov2 ON prov2.id = p2.proveedor_id
            WHERE sc.estado = 'guardada'
              AND sc.fecha_creacion >= NOW() - (
                  COALESCE(p2.lead_time_propio,
                           prov2.dias_despacho_tierra,
                           prov2.dias_despacho_aereo, 7)::int
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
        )
        SELECT
            p.id                                                              AS "producto_id!: Uuid",
            p.nombre                                                          AS "producto_nombre!: String",
            p.codigo_proveedor                                                AS "codigo_proveedor: String",
            p.codigo_maestro                                                  AS "codigo_maestro: String",
            prov.id                                                           AS "proveedor_id: i32",
            prov.nombre                                                       AS "proveedor_nombre: String",
            COALESCE(p.lead_time_propio,
                     prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                        AS "lead_time!: i32",
            COALESCE(st.stock_actual, 0)::FLOAT8                              AS "stock_actual!: f64",
            COALESCE(p.stock_minimo, 0)::FLOAT8                               AS "stock_minimo!: f64",
            COALESCE(pev.cantidad_pedida, 0)::FLOAT8                          AS "ya_pedido!: f64",
            s.serie                                                           AS "serie!: Vec<f64>",
            pres.id                                                           AS "presentacion_id: i32",
            pres.nombre                                                       AS "presentacion_nombre: String",
            pres.nombre_plural                                                AS "presentacion_nombre_plural: String",
            pres.factor_conversion::FLOAT8                                    AS "factor_conversion: f64",
            COALESCE(up.precio_unitario, p.precio_unidad)::FLOAT8             AS "precio_ultimo: f64",
            ub.nombre                                                         AS "unidad_base!: String",
            ub.nombre_plural                                                  AS "unidad_base_plural: String",
            p.imagen_url                                                      AS "imagen_url: String"
        FROM productos p
        JOIN series s ON s.producto_id = p.id
        LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
        LEFT JOIN stock_total st ON st.producto_id = p.id
        LEFT JOIN ultimo_precio up ON up.producto_id = p.id
        LEFT JOIN pres ON pres.producto_id = p.id
        LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        LEFT JOIN pedidos_en_vuelo pev ON pev.producto_id = p.id
        WHERE p.activo = true
        "#,
        cfg.ventana_demanda_dias
    )
    .fetch_all(&state.pool)
    .await?;

    // 3. Para cada producto, ejecutar el forecast en Rust
    let mut items: Vec<serde_json::Value> = Vec::new();
    for r in rows {
        let res = compute_forecast(
            &r.serie,
            r.stock_actual,
            r.stock_minimo,
            r.ya_pedido,
            r.lead_time,
            cfg,
        );

        // Solo aparecen en la lista los que tienen alguna urgencia
        let Some(urgencia) = res.urgencia else { continue };

        // Productos con confianza baja sólo se muestran si stock_actual < stock_minimo
        if res.confianza == forecast::Confianza::Baja && res.cantidad_sugerida == 0.0 {
            continue;
        }

        let cantidad_pres: Option<f64> = r.factor_conversion
            .filter(|f| *f > 0.0)
            .map(|f: f64| (res.cantidad_sugerida / f).ceil());

        let autonomia = if res.mu > 0.0 { Some(r.stock_actual / res.mu) } else { None };

        items.push(serde_json::json!({
            "producto_id": r.producto_id,
            "producto_nombre": r.producto_nombre,
            "codigo_proveedor": r.codigo_proveedor,
            "codigo_maestro": r.codigo_maestro,
            "proveedor_id": r.proveedor_id,
            "proveedor_nombre": r.proveedor_nombre,
            "lead_time": r.lead_time,
            "autonomia_dias": autonomia,
            "nivel_urgencia": urgencia.as_str(),
            "stock_actual": r.stock_actual,
            "stock_seguridad": r.stock_minimo,
            "consumo_diario": res.mu,
            "consumo_sigma": res.sigma,
            "dias_historia": r.serie.len() as i32,
            "dias_con_consumo": res.dias_con_consumo,
            "confianza": res.confianza.as_str(),
            "razon": res.razon,
            "safety_stock": res.safety_stock,
            "target_stock": res.target_stock,
            "reorder_point": res.reorder_point,
            "cantidad_sugerida_base": res.cantidad_sugerida.ceil(),
            "presentacion_id": r.presentacion_id,
            "presentacion_nombre": r.presentacion_nombre,
            "presentacion_nombre_plural": r.presentacion_nombre_plural,
            "factor_conversion": r.factor_conversion,
            "cantidad_sugerida_presentacion": cantidad_pres,
            "precio_ultima_recepcion": r.precio_ultimo,
            "unidad_base": r.unidad_base,
            "unidad_base_plural": r.unidad_base_plural,
            "imagen_url": r.imagen_url,
            "ya_pedido_unidades": r.ya_pedido,
        }));
    }

    // 4. Ordenar: críticas primero, luego por menor autonomía
    items.sort_by(|a, b| {
        let rank = |s: &str| match s {
            "critica" => 1, "alta" => 2, _ => 3
        };
        let ra = rank(a["nivel_urgencia"].as_str().unwrap_or(""));
        let rb = rank(b["nivel_urgencia"].as_str().unwrap_or(""));
        ra.cmp(&rb).then_with(|| {
            let aa = a["autonomia_dias"].as_f64().unwrap_or(f64::INFINITY);
            let bb = b["autonomia_dias"].as_f64().unwrap_or(f64::INFINITY);
            aa.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal)
        })
    });

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
    let cfg = load_forecast_config(&state.pool).await?;

    // 1. Serie diaria, stock, ya_pedido, lead time del producto
    let row_opt = sqlx::query!(
        r#"
        WITH ventana AS (SELECT NOW() - ($2::int * INTERVAL '1 day') AS desde),
        dias AS (
            SELECT generate_series((SELECT desde FROM ventana)::date, NOW()::date, INTERVAL '1 day')::date AS dia
        ),
        consumo_dia AS (
            SELECT m.created_at::date AS dia, SUM(m.cantidad)::FLOAT8 AS cantidad
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE l.producto_id = $1
              AND m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
            GROUP BY m.created_at::date
        ),
        serie AS (
            SELECT array_agg(COALESCE(cd.cantidad, 0) ORDER BY d.dia)::FLOAT8[] AS serie
            FROM dias d
            LEFT JOIN consumo_dia cd ON cd.dia = d.dia
        )
        SELECT
            COALESCE(p.stock_minimo, 0)::FLOAT8                              AS "stock_minimo!: f64",
            COALESCE((SELECT SUM(s.cantidad)::FLOAT8 FROM stock s
                      JOIN lotes l2 ON l2.id = s.lote_id WHERE l2.producto_id = p.id), 0)
                                                                              AS "stock_actual!: f64",
            COALESCE(p.lead_time_propio,
                     prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                        AS "lead_time!: i32",
            (SELECT serie FROM serie)                                         AS "serie!: Vec<f64>"
        FROM productos p
        LEFT JOIN proveedores prov ON prov.id = $3
        WHERE p.id = $1
        "#,
        params.producto_id,
        cfg.ventana_demanda_dias,
        params.proveedor_id
    )
    .fetch_optional(&state.pool)
    .await?;

    let row = row_opt.ok_or_else(|| AppError::NotFound("Producto no encontrado".into()))?;

    // 2. Forecast
    let res = compute_forecast(
        &row.serie,
        row.stock_actual,
        row.stock_minimo,
        0.0, // no descuento ya_pedido aquí — el cliente ajusta horizonte sobre el item
        row.lead_time,
        cfg,
    );

    // 3. Horizonte sugerido = lead_time + revisión, clampado a un piso de 7d.
    //    Si la confianza es baja, no inventar horizonte: devolver lead_time × 3.
    let horizonte_sugerido = if res.confianza == forecast::Confianza::Baja {
        ((row.lead_time as f64 * 3.0) as i32).max(30)
    } else {
        let base = row.lead_time + cfg.periodo_revision_dias;
        let cv = if res.mu > 0.0 { res.sigma / res.mu } else { 0.0 };
        let mult = if cv < 0.3 { 1.0 } else if cv < 0.7 { 1.3 } else { 1.5 };
        let ajustado = (base as f64 * mult) as i32;
        let piso = ((row.lead_time as f64 * 1.5) as i32).max(7);
        ajustado.max(piso)
    };

    let cv = if res.mu > 0.0 { res.sigma / res.mu } else { 0.0 };

    Ok(Json(HorizonteResponse {
        horizonte_sugerido,
        razon: res.razon.clone(),
        consumo_diario: res.mu,
        stock_actual: row.stock_actual,
        stock_minimo: row.stock_minimo,
        factores: HorizonteFactores {
            ciclo_historico_dias: None,
            n_pedidos_historico: 0,
            coeficiente_variacion: (cv * 100.0).round() / 100.0,
            multiplicador_variabilidad: 1.0,
            lead_time: row.lead_time,
        },
    }))
}

/// Carga la configuración del forecast desde la tabla `configuracion`.
async fn load_forecast_config(pool: &sqlx::PgPool) -> Result<ForecastConfig, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_demanda_dias'), 60)   AS "ventana!: i32",
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30)  AS "revision!: i32",
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'dias_minimos_historia'), 14)  AS "minimos!: i32",
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'nivel_servicio_z'), 1.65)  AS "z!: f64"
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(ForecastConfig {
        ventana_demanda_dias: row.ventana,
        periodo_revision_dias: row.revision,
        dias_minimos_historia: row.minimos,
        nivel_servicio_z: row.z,
    })
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

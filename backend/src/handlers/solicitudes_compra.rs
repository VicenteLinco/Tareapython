use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
use crate::domain::EstadoSolicitud;
use crate::dto::solicitud::{
    CancelarEnvioInput, CreateSolicitudItem, EnvioProveedorView, ProveedorResumen,
    RegistrarEnvioInput, SolicitudDetalle, SolicitudDetalleItem, SolicitudResumen,
    UpdateSolicitudRequest,
};
use crate::errors::AppError;
use crate::services::forecast::{
    self, ForecastConfig, compute_forecast, estimate_short_history_demand,
};

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
    consumo_diario_forecast: f64,
    consumo_diario_planificacion: f64,
    tipo_estimacion_demanda: String,
    stock_actual: f64,
    stock_minimo: f64,
    factores: HorizonteFactores,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SolicitudDetalleRow {
    pub id: Uuid,
    pub numero_documento: String,
    pub fecha_creacion: DateTime<Utc>,
    pub estado: EstadoSolicitud,
    pub nota: Option<String>,
    pub usuario_nombre: String,
    pub fecha_envio: Option<DateTime<Utc>>,
    pub fecha_cierre: Option<DateTime<Utc>>,
    pub motivo_cierre: Option<String>,
    pub metodo_envio: Option<String>,
}

async fn obtener_solicitud_por_id(
    id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<SolicitudDetalle, AppError> {
    let solicitud = sqlx::query_as::<_, SolicitudDetalleRow>(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado, s.nota,
                  u.nombre as usuario_nombre,
                  s.fecha_envio, s.fecha_cierre, s.motivo_cierre, s.metodo_envio
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           WHERE s.id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Solicitud no encontrada".into()))?;

    let items = sqlx::query_as::<_, SolicitudDetalleItem>(
        r#"SELECT
            d.producto_id,
            p.proveedor_id,
            p.nombre as producto_nombre,
            d.cantidad_sugerida,
            d.unidad_basica_id,
            COALESCE(pres.nombre, ub.nombre) as unidad,
            COALESCE(pres.nombre_plural, ub.nombre_plural) as unidad_plural,
            p.sku as codigo_proveedor,
            NULL::varchar as codigo_maestro,
            prov.nombre as proveedor_nombre,
            pres.nombre as presentacion_nombre,
            pres.nombre_plural as presentacion_nombre_plural,
            pres.factor_conversion,
            d.precio_unitario,
            d.presentacion_id,
            d.cantidad_presentaciones,
            p.imagen_url AS imagen_url,
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

    let envios = sqlx::query_as::<_, EnvioProveedorView>(
        r#"WITH proveedores_solicitud AS (
               SELECT
                   p.proveedor_id,
                   COALESCE(prov.nombre, '[Proveedor eliminado]') AS proveedor_nombre,
                   COUNT(d.id)::integer AS total_items,
                   COALESCE(SUM(
                       COALESCE(d.cantidad_presentaciones, d.cantidad_sugerida)
                       * COALESCE(
                           CASE
                               WHEN d.presentacion_id IS NOT NULL AND pres.factor_conversion IS NOT NULL
                               THEN d.precio_unitario * pres.factor_conversion
                               ELSE d.precio_unitario
                           END,
                           0
                       )
                   ), 0) AS monto_total
               FROM solicitud_compra_detalle d
               JOIN productos p ON p.id = d.producto_id
               LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
               LEFT JOIN presentaciones pres ON pres.id = d.presentacion_id
               WHERE d.solicitud_id = $1 AND p.proveedor_id IS NOT NULL
               GROUP BY p.proveedor_id, prov.nombre
           )
           SELECT
               ps.proveedor_id,
               ps.proveedor_nombre,
               COALESCE(se.estado, 'pendiente') AS estado,
               se.metodo_envio,
               se.fecha_envio,
               se.nota,
               ps.total_items,
               ps.monto_total,
               COALESCE(se.version, 0)::int AS version
           FROM proveedores_solicitud ps
           LEFT JOIN solicitud_envios se
             ON se.solicitud_id = $1 AND se.proveedor_id = ps.proveedor_id
           ORDER BY ps.proveedor_nombre"#,
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    let proveedores_resumen: Vec<ProveedorResumen> = envios
        .iter()
        .map(|e| ProveedorResumen {
            proveedor_id: e.proveedor_id,
            proveedor_nombre: e.proveedor_nombre.clone(),
            total_items: e.total_items,
            monto_total: e.monto_total,
        })
        .collect();

    Ok(SolicitudDetalle {
        id: solicitud.id,
        numero_documento: solicitud.numero_documento,
        fecha_creacion: solicitud.fecha_creacion,
        estado: solicitud.estado,
        usuario_nombre: solicitud.usuario_nombre,
        nota: solicitud.nota,
        fecha_envio: solicitud.fecha_envio,
        fecha_cierre: solicitud.fecha_cierre,
        motivo_cierre: solicitud.motivo_cierre,
        metodo_envio: solicitud.metodo_envio,
        items,
        envios,
        proveedores_resumen,
    })
}

async fn insertar_item(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    solicitud_id: Uuid,
    item: &CreateSolicitudItem,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO solicitud_compra_detalle
         (solicitud_id, producto_id, cantidad_sugerida, unidad_basica_id,
          precio_unitario, presentacion_id, cantidad_presentaciones,
          horizonte_dias, horizonte_sugerido, horizonte_razon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(solicitud_id)
    .bind(item.producto_id)
    .bind(item.cantidad_sugerida)
    .bind(item.unidad_basica_id)
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
         LIMIT 1",
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
         VALUES ($1, $2, 'borrador') RETURNING id, numero_documento",
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
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let q_pattern = params.q.as_ref().map(|q| format!("%{}%", q));

    // ── COUNT ────────────────────────────────────────────────────────────────
    let mut count_builder: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
        "SELECT COUNT(*) FROM solicitudes_compra s JOIN usuarios u ON u.id = s.usuario_id WHERE 1=1",
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
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = ",
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
                  (SELECT COUNT(*)::integer FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count,
                  s.fecha_envio, s.fecha_cierre,
                  COALESCE((
                      SELECT COUNT(DISTINCT p.proveedor_id)::integer
                      FROM solicitud_compra_detalle scd
                      JOIN productos p ON p.id = scd.producto_id
                      WHERE scd.solicitud_id = s.id AND p.proveedor_id IS NOT NULL
                  ), 0) as proveedores_count,
                  (
                      SELECT string_agg(DISTINCT prov.nombre, ', ' ORDER BY prov.nombre)
                      FROM solicitud_compra_detalle scd
                      JOIN productos p ON p.id = scd.producto_id
                      JOIN proveedores prov ON prov.id = p.proveedor_id
                      WHERE scd.solicitud_id = s.id
                  ) as proveedores_nombres
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           WHERE 1=1"#,
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
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = ",
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
    #[derive(sqlx::FromRow)]
    struct RecomendacionRow {
        producto_id: Uuid,
        producto_nombre: String,
        codigo_proveedor: Option<String>,
        codigo_maestro: Option<String>,
        proveedor_id: Option<i32>,
        proveedor_nombre: Option<String>,
        lead_time: i32,
        stock_actual: f64,
        stock_minimo: f64,
        ya_pedido: f64,
        serie: Vec<f64>,
        presentacion_id: Option<i32>,
        presentacion_nombre: Option<String>,
        presentacion_nombre_plural: Option<String>,
        factor_conversion: Option<f64>,
        precio_ultimo: Option<f64>,
        unidad_base: String,
        unidad_base_plural: Option<String>,
        imagen_url: Option<String>,
    }

    let rows = sqlx::query_as::<_, RecomendacionRow>(
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
            WHERE sc.estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')
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
            p.id                                                              AS producto_id,
            p.nombre                                                          AS producto_nombre,
            p.sku                                                             AS codigo_proveedor,
            NULL::varchar                                                     AS codigo_maestro,
            prov.id                                                           AS proveedor_id,
            prov.nombre                                                       AS proveedor_nombre,
            COALESCE(p.lead_time_propio,
                     prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                        AS lead_time,
            COALESCE(st.stock_actual, 0)::FLOAT8                              AS stock_actual,
            COALESCE(p.stock_minimo, 0)::FLOAT8                               AS stock_minimo,
            COALESCE(pev.cantidad_pedida, 0)::FLOAT8                          AS ya_pedido,
            s.serie                                                           AS serie,
            pres.id                                                           AS presentacion_id,
            pres.nombre                                                       AS presentacion_nombre,
            pres.nombre_plural                                                AS presentacion_nombre_plural,
            pres.factor_conversion::FLOAT8                                    AS factor_conversion,
            COALESCE(up.precio_unitario, p.precio_unidad)::FLOAT8             AS precio_ultimo,
            ub.nombre                                                         AS unidad_base,
            ub.nombre_plural                                                  AS unidad_base_plural,
            p.imagen_url                                                      AS imagen_url
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
    )
    .bind(cfg.ventana_demanda_dias)
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
        let Some(urgencia) = res.urgencia else {
            continue;
        };

        // Productos con confianza baja sólo se muestran si stock_actual < stock_minimo
        if res.confianza == forecast::Confianza::Baja && res.cantidad_sugerida == 0.0 {
            continue;
        }

        let cantidad_pres: Option<f64> = r
            .factor_conversion
            .filter(|f| *f > 0.0)
            .map(|f: f64| (res.cantidad_sugerida / f).ceil());

        let autonomia = if res.mu > 0.0 {
            Some(r.stock_actual / res.mu)
        } else {
            None
        };

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
            "critica" => 1,
            "alta" => 2,
            _ => 3,
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
    let exists: Option<String> =
        sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;

    match exists.as_deref() {
        None => return Err(AppError::NotFound("Solicitud no encontrada".into())),
        Some("borrador") => {}
        Some(_) => {
            return Err(AppError::BusinessLogic(
                "Solo se puede editar una solicitud en borrador".into(),
                "ESTADO_INVALIDO".into(),
            ));
        }
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
    let mut tx = state.pool.begin().await?;

    let sin_proveedor: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM solicitud_compra_detalle d
         JOIN productos p ON p.id = d.producto_id
         WHERE d.solicitud_id = $1 AND p.proveedor_id IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;

    if sin_proveedor > 0 {
        return Err(AppError::Validation(
            "Todos los items deben tener proveedor asignado".into(),
        ));
    }

    let rows = sqlx::query(
        "UPDATE solicitudes_compra SET estado = 'guardada' WHERE id = $1 AND estado = 'borrador'",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se puede guardar una solicitud en borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO solicitud_envios (solicitud_id, proveedor_id, estado)
         SELECT DISTINCT $1, p.proveedor_id, 'pendiente'
         FROM solicitud_compra_detalle d
         JOIN productos p ON p.id = d.producto_id
         WHERE d.solicitud_id = $1 AND p.proveedor_id IS NOT NULL
         ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn recalcular_estado_solicitud(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    solicitud_id: Uuid,
) -> Result<(), AppError> {
    let (total_provs, provs_enviados, fecha_max): (i64, i64, Option<DateTime<Utc>>) =
        sqlx::query_as(
            r#"WITH proveedores_items AS (
                   SELECT DISTINCT p.proveedor_id
                   FROM solicitud_compra_detalle d
                   JOIN productos p ON p.id = d.producto_id
                   WHERE d.solicitud_id = $1 AND p.proveedor_id IS NOT NULL
               ),
               envios_ok AS (
                   SELECT proveedor_id
                   FROM solicitud_envios
                   WHERE solicitud_id = $1 AND estado = 'enviado'
               )
               SELECT
                   (SELECT COUNT(*) FROM proveedores_items)::bigint AS total_provs,
                   (SELECT COUNT(*) FROM envios_ok)::bigint AS provs_enviados,
                   (SELECT MAX(fecha_envio) FROM solicitud_envios
                    WHERE solicitud_id = $1 AND estado = 'enviado') AS fecha_max"#,
        )
        .bind(solicitud_id)
        .fetch_one(&mut **tx)
        .await?;

    let nuevo_estado = match (total_provs, provs_enviados) {
        (_, 0) => "guardada",
        (t, e) if e < t => "parcialmente_enviada",
        (t, e) if e >= t && t > 0 => "enviada",
        _ => "guardada",
    };

    sqlx::query(
        "UPDATE solicitudes_compra
         SET estado = $1, fecha_envio = $2
         WHERE id = $3 AND estado NOT IN ('cancelada','completada','parcialmente_recibida')",
    )
    .bind(nuevo_estado)
    .bind(fecha_max)
    .bind(solicitud_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

#[derive(Debug, Deserialize)]
struct EnviarRequest {
    metodo_envio: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CancelarRequest {
    motivo: String,
}

async fn enviar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<EnviarRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    // Acepta guardada O parcialmente_enviada
    let estado_actual: Option<String> =
        sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

    match estado_actual.as_deref() {
        None => return Err(AppError::NotFound("Solicitud no encontrada".into())),
        Some("guardada") | Some("parcialmente_enviada") => {}
        _ => {
            return Err(AppError::BusinessLogic(
                "Solo se puede marcar como enviada una solicitud guardada o parcialmente enviada"
                    .into(),
                "ESTADO_INVALIDO".into(),
            ));
        }
    }

    // Actualizar metodo_envio en la cabecera (el estado lo calcula recalcular_estado_solicitud)
    sqlx::query("UPDATE solicitudes_compra SET metodo_envio = $2 WHERE id = $1")
        .bind(id)
        .bind(req.metodo_envio.as_deref())
        .execute(&mut *tx)
        .await?;

    // Insertar envios solo para proveedores que no los tengan ya
    // ON CONFLICT DO NOTHING preserva los envios granulares ya registrados
    sqlx::query(
        "INSERT INTO solicitud_envios (solicitud_id, proveedor_id, estado, metodo_envio, fecha_envio, usuario_envio_id)
         SELECT DISTINCT $1, p.proveedor_id, 'enviado', COALESCE($2, 'otro'), NOW(), $3
         FROM solicitud_compra_detalle d
         JOIN productos p ON p.id = d.producto_id
         WHERE d.solicitud_id = $1 AND p.proveedor_id IS NOT NULL
         ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING",
    )
    .bind(id)
    .bind(req.metodo_envio.as_deref())
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    recalcular_estado_solicitud(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn registrar_envio(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<RegistrarEnvioInput>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    if !matches!(
        req.metodo_envio.as_str(),
        "email" | "telefono" | "whatsapp" | "presencial" | "otro"
    ) {
        return Err(AppError::Validation("Metodo de envio invalido".into()));
    }

    let mut tx = state.pool.begin().await?;
    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

    match estado.as_deref() {
        None => return Err(AppError::NotFound("Solicitud no encontrada".into())),
        Some("borrador") => {
            return Err(AppError::Validation(
                "La solicitud debe estar guardada para registrar envios".into(),
            ));
        }
        Some("cancelada") | Some("completada") => {
            return Err(AppError::Validation("Solicitud no admite cambios".into()));
        }
        _ => {}
    }

    let proveedor_presente: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM solicitud_compra_detalle d
         JOIN productos p ON p.id = d.producto_id
         WHERE d.solicitud_id = $1 AND p.proveedor_id = $2",
    )
    .bind(id)
    .bind(req.proveedor_id)
    .fetch_one(&mut *tx)
    .await?;

    if proveedor_presente == 0 {
        return Err(AppError::Validation(
            "El proveedor no tiene items en esta solicitud".into(),
        ));
    }

    // Guard: version=0 solo es válido para registros nuevos (INSERT path).
    // Si ya existe un envio para este proveedor y el cliente manda version=0,
    // significa que tiene datos stale — rechazamos para forzar recarga.
    if req.version == 0 {
        let ya_existe: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM solicitud_envios WHERE solicitud_id = $1 AND proveedor_id = $2)",
        )
        .bind(id)
        .bind(req.proveedor_id)
        .fetch_one(&mut *tx)
        .await?;

        if ya_existe {
            return Err(AppError::VersionConflict {
                esperada: req.version as i64,
                actual: 1,
            });
        }
    }

    let updated = sqlx::query(
        "INSERT INTO solicitud_envios
            (solicitud_id, proveedor_id, estado, metodo_envio, fecha_envio, usuario_envio_id, nota)
         VALUES ($1, $2, 'enviado', $3, COALESCE($4, NOW()), $5, $6)
         ON CONFLICT (solicitud_id, proveedor_id) DO UPDATE
         SET estado = 'enviado',
             metodo_envio = EXCLUDED.metodo_envio,
             fecha_envio = EXCLUDED.fecha_envio,
             usuario_envio_id = EXCLUDED.usuario_envio_id,
             nota = EXCLUDED.nota
         WHERE solicitud_envios.version = $7 OR $7 = 0",
    )
    .bind(id)
    .bind(req.proveedor_id)
    .bind(&req.metodo_envio)
    .bind(req.fecha_envio)
    .bind(claims.sub)
    .bind(&req.nota)
    .bind(req.version)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::VersionConflict {
            esperada: req.version as i64,
            actual: req.version as i64 + 1,
        });
    }

    recalcular_estado_solicitud(&mut tx, id).await?;
    tx.commit().await?;

    Ok(Json(obtener_solicitud_por_id(id, &state.pool).await?))
}

async fn cancelar_envio(
    State(state): State<AppState>,
    Path((id, proveedor_id)): Path<(Uuid, i32)>,
    Json(req): Json<CancelarEnvioInput>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    let mut tx = state.pool.begin().await?;
    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM solicitudes_compra WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

    match estado.as_deref() {
        None => return Err(AppError::NotFound("Solicitud no encontrada".into())),
        Some("cancelada") | Some("completada") | Some("borrador") => {
            return Err(AppError::Validation("Solicitud no admite cambios".into()));
        }
        _ => {}
    }

    let updated = sqlx::query(
        "UPDATE solicitud_envios
         SET estado = 'pendiente', metodo_envio = NULL, fecha_envio = NULL, usuario_envio_id = NULL, nota = NULL
         WHERE solicitud_id = $1 AND proveedor_id = $2 AND version = $3",
    )
    .bind(id)
    .bind(proveedor_id)
    .bind(req.version)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::VersionConflict {
            esperada: req.version as i64,
            actual: req.version as i64 + 1,
        });
    }

    recalcular_estado_solicitud(&mut tx, id).await?;
    tx.commit().await?;

    Ok(Json(obtener_solicitud_por_id(id, &state.pool).await?))
}

async fn completar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "UPDATE solicitudes_compra
         SET estado = 'completada', fecha_cierre = NOW()
         WHERE id = $1
           AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')
           AND EXISTS (
               SELECT 1
               FROM recepciones r
               WHERE r.solicitud_id = solicitudes_compra.id
                 AND r.estado = 'completa'
           )",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Para completar una solicitud primero debe existir una recepcion completa vinculada"
                .into(),
            "ESTADO_INVALIDO".into(),
        ));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn cancelar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<CancelarRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let motivo = req.motivo.trim();
    if motivo.is_empty() {
        return Err(AppError::BusinessLogic(
            "Debe indicar un motivo de cancelación".into(),
            "MOTIVO_REQUERIDO".into(),
        ));
    }
    let rows = sqlx::query(
        "UPDATE solicitudes_compra
         SET estado = 'cancelada', fecha_cierre = NOW(), motivo_cierre = $2
         WHERE id = $1 AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')",
    )
    .bind(id)
    .bind(motivo)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "Solo se puede cancelar una solicitud guardada o enviada".into(),
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
        "SELECT id FROM solicitudes_compra WHERE usuario_id = $1 AND estado = 'borrador' LIMIT 1",
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
            (SELECT serie FROM serie)                                         AS "serie!: Vec<f64>",
            COALESCE((
                SELECT SUM(scd.cantidad_sugerida)::FLOAT8
                FROM solicitud_compra_detalle scd
                JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
                WHERE scd.producto_id = p.id
                  AND sc.estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')
            ), 0.0)                                                           AS "ya_pedido!: f64"
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
        row.ya_pedido,
        row.lead_time,
        cfg,
    );

    // 3. Horizonte sugerido = lead_time + revisión, clampado a un piso de 7d.
    //    Si la confianza es baja, no inventar horizonte: devolver lead_time × 3.
    let horizonte_sugerido = if res.confianza == forecast::Confianza::Baja {
        ((row.lead_time as f64 * 3.0) as i32).max(30)
    } else {
        let base = row.lead_time + cfg.periodo_revision_dias;
        let cv = if res.mu > 0.0 {
            res.sigma / res.mu
        } else {
            0.0
        };
        let mult = if cv < 0.3 {
            1.0
        } else if cv < 0.7 {
            1.3
        } else {
            1.5
        };
        let ajustado = (base as f64 * mult) as i32;
        let piso = ((row.lead_time as f64 * 1.5) as i32).max(7);
        ajustado.max(piso)
    };

    let cv = if res.mu > 0.0 {
        res.sigma / res.mu
    } else {
        0.0
    };
    let short_est = estimate_short_history_demand(
        &row.serie,
        cfg.dias_minimos_historia,
        cfg.factor_historial_corto,
    );
    let consumo_diario = short_est.map(|est| est.consumo_diario).unwrap_or(res.mu);
    let tipo_estimacion_demanda = if short_est.is_some() {
        "historial_corto"
    } else if res.mu > 0.0 {
        "forecast"
    } else {
        "sin_historial"
    };
    let razon = match short_est {
        Some(est) => format!(
            "{} Estimacion provisional para horizonte: {:.2} u/dia; max(promedio ventana {:.2}, promedio reciente descontado {:.2}, {} dias desde primer consumo, factor {:.2}).",
            res.razon,
            est.consumo_diario,
            est.promedio_ventana,
            est.promedio_reciente_desc,
            est.dias_desde_primer_consumo,
            est.factor_descuento
        ),
        None => res.razon.clone(),
    };

    Ok(Json(HorizonteResponse {
        horizonte_sugerido,
        razon,
        consumo_diario,
        consumo_diario_forecast: res.mu,
        consumo_diario_planificacion: consumo_diario,
        tipo_estimacion_demanda: tipo_estimacion_demanda.to_string(),
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
    let row: (i32, i32, i32, f64, f64) = sqlx::query_as(
        r#"
        SELECT
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_demanda_dias'), 60),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'dias_minimos_historia'), 14),
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'nivel_servicio_z'), 1.65),
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'factor_historial_corto'), 0.35)
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(ForecastConfig {
        ventana_demanda_dias: row.0,
        periodo_revision_dias: row.1,
        dias_minimos_historia: row.2,
        nivel_servicio_z: row.3,
        factor_historial_corto: row.4.clamp(0.0, 1.0),
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
        .route("/{id}/enviar", post(enviar))
        .route("/{id}/envios", post(registrar_envio))
        .route("/{id}/envios/{proveedor_id}", delete(cancelar_envio))
        .route("/{id}/completar", post(completar))
        .route("/{id}/cancelar", post(cancelar))
}

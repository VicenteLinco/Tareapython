use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use axum::Extension;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::PaginationParams;
use crate::errors::AppError;
use crate::services::forecast::{
    ForecastConfig, consumo_base_adaptivo, consumo_pico_7d, ewma, winsorize_p95,
};
use crate::services::stock_ops;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct StockQuery {
    area_id: Option<i32>,
    area_ids: Option<String>,
    q: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    stock_bajo: Option<bool>,
    con_alertas: Option<bool>,
    filter: Option<String>,
    estado: Option<String>, // nuevo param unificado: todos|normal|bajo|critico|sin_stock
    page: Option<i64>,
    per_page: Option<i64>,
}

fn parse_area_ids(value: Option<&str>) -> Result<Vec<i32>, AppError> {
    value
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<i32>()
                .map_err(|_| AppError::Validation("area_ids debe contener solo enteros".into()))
        })
        .collect()
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

// === Handlers ===

/// GET /api/v1/stock — Vista principal de stock
async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let forecast_cfg = load_forecast_config(&state.pool).await?;

    let requested_area_ids = parse_area_ids(params.area_ids.as_deref())?;

    if params.area_id.is_some() && !requested_area_ids.is_empty() {
        return Err(AppError::Validation(
            "Usa area_id o area_ids, no ambos".into(),
        ));
    }

    let scoped_area_ids = if let Some(aid) = params.area_id {
        vec![aid]
    } else {
        requested_area_ids
    };

    // Si se filtra por área, validar acceso
    if let Some(aid) = params.area_id {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, aid, &claims.rol).await?;
    }
    for aid in &scoped_area_ids {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, *aid, &claims.rol).await?;
    }

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    }
    .validated()?;

    let limit = pagination.per_page();
    let offset = pagination.offset();

    let estado = match params.estado.as_deref().unwrap_or("") {
        "critico" | "bajo_minimo" | "reponer" => "bajo",
        "sin-stock" | "sin_stock" => "agotado",
        "vencidos" => "vencido",
        "vencimiento" | "riesgo_venc" | "por_vencer" => "vence_pronto",
        other => other,
    };
    let filter = params.filter.as_deref().unwrap_or("");
    let tiene_filtro_estado = !estado.is_empty() && estado != "todos";
    let con_alertas = params.con_alertas == Some(true) || tiene_filtro_estado || !filter.is_empty();

    let mut param_idx = 0;
    let mut binds = Vec::new();

    let scoped_area_array = if scoped_area_ids.is_empty() {
        None
    } else {
        Some(
            scoped_area_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(","),
        )
    };

    let area_filter = if let Some(area_ids) = &scoped_area_array {
        format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", area_ids)
    } else if let Some(aid) = params.area_id {
        param_idx += 1;
        binds.push(aid.to_string());
        format!("AND s.area_id = ${}::integer", param_idx)
    } else {
        "".to_string()
    };
    let movement_area_filter = if let Some(area_ids) = &scoped_area_array {
        format!("AND m.area_id = ANY(ARRAY[{}]::integer[])", area_ids)
    } else {
        "".to_string()
    };

    let q_filter = if let Some(q) = &params.q {
        param_idx += 1;
        binds.push(format!("%{}%", escape_like(q)));
        format!(
            "AND (p.nombre ILIKE ${0} ESCAPE '\\' OR p.codigo_interno ILIKE ${0} ESCAPE '\\')",
            param_idx
        )
    } else {
        "".to_string()
    };

    let cat_filter = if let Some(cat_id) = params.categoria_id {
        param_idx += 1;
        binds.push(cat_id.to_string());
        format!("AND p.categoria_id = ${}::integer", param_idx)
    } else {
        "".to_string()
    };

    let prov_filter = if let Some(prov_id) = params.proveedor_id {
        param_idx += 1;
        binds.push(prov_id.to_string());
        format!(
            "AND p.proveedor_id = ${}::integer",
            param_idx
        )
    } else {
        "".to_string()
    };

    let inicializado_expr = if let Some(area_ids) = &scoped_area_array {
        format!(
            "(EXISTS (SELECT 1 FROM movimientos mi JOIN lotes li ON li.id = mi.lote_id WHERE li.producto_id = p.id AND mi.area_id = ANY(ARRAY[{}]::integer[]))
              OR EXISTS (SELECT 1 FROM stock si JOIN lotes lsi ON lsi.id = si.lote_id WHERE lsi.producto_id = p.id AND si.area_id = ANY(ARRAY[{}]::integer[])))",
            area_ids, area_ids
        )
    } else {
        "(EXISTS (SELECT 1 FROM movimientos mi JOIN lotes li ON li.id = mi.lote_id WHERE li.producto_id = p.id)
          OR EXISTS (SELECT 1 FROM stock si JOIN lotes lsi ON lsi.id = si.lote_id WHERE lsi.producto_id = p.id))".to_string()
    };

    let type_filter = match estado {
        "agotado" => "AND estado_alerta = 'agotado'",
        "vencido" => "AND estado_alerta = 'vencido'",
        "bajo" => "AND estado_alerta IN ('critico', 'reponer')",
        "vence_pronto" => "AND estado_alerta IN ('riesgo_venc', 'por_vencer')",
        "sin_datos" => "AND estado_alerta = 'sin_datos'",
        "normal" => "AND estado_alerta = 'normal'",
        _ if params.stock_bajo == Some(true) => "AND estado_alerta IN ('critico', 'reponer')",
        _ if params.con_alertas == Some(true) => {
            "AND estado_alerta IN ('vencido','agotado','critico','reponer','riesgo_venc','por_vencer')"
        }
        _ => match filter {
            "vencimiento" => "AND estado_alerta IN ('riesgo_venc', 'por_vencer')",
            "vencidos" => "AND estado_alerta = 'vencido'",
            "sin-stock" => "AND estado_alerta = 'agotado'",
            "bajo" | "critico" => "AND estado_alerta IN ('critico', 'reponer')",
            _ => "",
        },
    };

    // Base query using the already updated 'stock' table
    let sql = format!(
        r#"WITH ventana AS (
               SELECT NOW() - ({}::int * INTERVAL '1 day') AS desde
           ),
           dias AS (
               SELECT generate_series(
                   (SELECT desde FROM ventana)::date,
                   NOW()::date,
                   INTERVAL '1 day'
               )::date AS dia
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
                 {}
               GROUP BY l.producto_id, m.created_at::date
           ),
           series AS (
               SELECT
                   p.id AS producto_id,
                   array_agg(COALESCE(cd.cantidad, 0) ORDER BY d.dia)::FLOAT8[] AS serie
               FROM productos p
               CROSS JOIN dias d
               LEFT JOIN consumo_dia cd ON cd.producto_id = p.id AND cd.dia = d.dia
               WHERE p.activo = true
               GROUP BY p.id
           ),
           stock_stats AS (
               SELECT
                   l.producto_id,
                   SUM(s.cantidad) AS total,
                   MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proxima_fecha_venc,
                   COUNT(DISTINCT l.id) FILTER (WHERE s.cantidad > 0) AS lotes_con_stock
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               WHERE 1=1 {}
               GROUP BY l.producto_id
           ),
           movimiento_stats AS (
               SELECT
                   l.producto_id,
                   (
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0 * 0.7) +
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 23.0 * 0.3)
                   ) AS consumo_diario_ponderado,
                   COALESCE(SUM(m.cantidad), 0)::FLOAT8 AS total_consumo_ventana,
                   COUNT(DISTINCT CASE WHEN m.tipo = 'CONSUMO' THEN m.created_at::date END) AS dias_con_consumo,
                   EXTRACT(DAY FROM (NOW() - MIN(m.created_at)))::INT + 1 AS dias_vida_sistema
               FROM lotes l
               LEFT JOIN movimientos m ON m.lote_id = l.id AND m.tipo = 'CONSUMO' AND m.created_at >= NOW() - ({}::int * INTERVAL '1 day') {}
               GROUP BY l.producto_id
           ),
           fefo_prov AS (
               SELECT DISTINCT ON (l2.producto_id)
                   l2.producto_id, pv.nombre, pv.icono
               FROM lotes l2
               JOIN stock s2 ON s2.lote_id = l2.id
               JOIN proveedores pv ON pv.id = l2.proveedor_id
               WHERE s2.cantidad > 0
               ORDER BY l2.producto_id, l2.fecha_vencimiento ASC
           ),
           final_stats AS (
               SELECT
                   p.id as producto_id,
                   p.codigo_interno,
                   p.nombre as producto_nombre,
                   c.nombre as categoria,
                   um.nombre as unidad,
                   um.nombre_plural as unidad_plural,
                   COALESCE(ss.total, 0) as stock_total,
                   COALESCE(ss.lotes_con_stock, 0) as lotes_count,
                   {} AS inicializado,
                   p.lead_time_propio,
                   COALESCE(p.lead_time_propio, pv2.dias_despacho_tierra, pv2.dias_despacho_aereo, 7) AS lead_time_efectivo,
                   ss.proxima_fecha_venc as proximo_vencimiento,
                   fp.nombre as proveedor_nombre,
                   fp.icono as proveedor_icono,
                   p.imagen_path AS imagen_url,
                   COALESCE(sr.serie, ARRAY[]::FLOAT8[]) as serie,
                   COALESCE(ms.dias_con_consumo, 0) as dias_con_consumo,
                   CASE
                       WHEN ms.dias_vida_sistema < 30 AND ms.dias_con_consumo >= 3 THEN
                           COALESCE(ms.consumo_diario_ponderado * (30.0 / GREATEST(ms.dias_vida_sistema, 7)), 0)::NUMERIC(15,4)
                       ELSE COALESCE(ms.consumo_diario_ponderado, 0)::NUMERIC(15,4)
                   END AS consumo_diario_ajustado,
                   -- consumo_base_estimado: única base de consumo para estado y autonomía.
                   -- ≥14 días con consumo → ponderado; 1-13 → total/días_reales; <1 → 0
                   CASE
                       WHEN COALESCE(ms.dias_con_consumo, 0) >= 14
                           THEN COALESCE(ms.consumo_diario_ponderado, 0)::FLOAT8
                       WHEN COALESCE(ms.dias_con_consumo, 0) >= 1
                           THEN COALESCE(ms.total_consumo_ventana, 0) / GREATEST(ms.dias_vida_sistema::FLOAT8, 1)
                       ELSE 0.0
                   END AS consumo_base_estimado
               FROM productos p
               JOIN unidades_basicas um ON um.id = p.unidad_base_id
               LEFT JOIN categorias c ON c.id = p.categoria_id
               LEFT JOIN proveedores pv2 ON pv2.id = p.proveedor_id
               LEFT JOIN stock_stats ss ON ss.producto_id = p.id
               LEFT JOIN movimiento_stats ms ON ms.producto_id = p.id
               LEFT JOIN fefo_prov fp ON fp.producto_id = p.id
               LEFT JOIN series sr ON sr.producto_id = p.id
               WHERE p.activo = true {} {} {}
           ),
           enriched AS (
               SELECT
                   final_stats.*,
                   CASE
                       WHEN stock_total > 0 AND consumo_base_estimado > 0.0001 AND dias_con_consumo >= 3
                           THEN LEAST(FLOOR(stock_total / consumo_base_estimado), 999)::INT
                       ELSE NULL
                   END AS dias_autonomia,
                   fn_estado_stock(
                       stock_total,
                       consumo_base_estimado,
                       dias_con_consumo::int,
                       lead_time_efectivo::int,
                       {},   -- dias_objetivo_cobertura
                       proximo_vencimiento,
                       inicializado,
                       3,    -- dias_min_historia para estimar autonomía
                       {},   -- vencimiento_riesgo_dias
                       {}    -- vencimiento_proximo_dias
                   ) AS estado_alerta
               FROM final_stats
           ),
           filtered AS (
               SELECT * FROM enriched WHERE 1=1 {} {}
           ),
           total_count AS (
               SELECT COUNT(*) as full_count FROM filtered
           )
           SELECT f.*, tc.full_count
           FROM filtered f, total_count tc
           ORDER BY f.producto_nombre
           LIMIT ${} OFFSET ${}"#,
        forecast_cfg.ventana_demanda_dias,
        movement_area_filter,
        area_filter,
        forecast_cfg.ventana_demanda_dias,
        movement_area_filter,
        inicializado_expr,
        q_filter,
        cat_filter,
        prov_filter,
        forecast_cfg.dias_objetivo_cobertura,
        forecast_cfg.vencimiento_riesgo_dias,
        forecast_cfg.vencimiento_proximo_dias,
        if !con_alertas
            && params.q.is_none()
            && params.categoria_id.is_none()
            && params.proveedor_id.is_none()
        {
            "AND estado_alerta <> 'no_gestionado'"
        } else {
            ""
        },
        type_filter,
        param_idx + 1,
        param_idx + 2
    );

    let mut query = sqlx::query_as::<_, StockItemRow>(&sql);
    for b in binds {
        query = query.bind(b);
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(&state.pool).await?;
    let rows: Vec<StockItemRow> = rows
        .into_iter()
        .map(|mut row| {
            calcular_pico(&mut row, forecast_cfg);
            row
        })
        .collect();
    let total = rows.first().map(|r| r.full_count).unwrap_or(0);
    let total_pages = if limit > 0 {
        (total + limit - 1) / limit
    } else {
        1
    };

    let resumen_area_filter = scoped_area_array
        .as_ref()
        .map(|area_ids| format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", area_ids))
        .unwrap_or_default();

    // Resumen
    let resumen_total: (i64,) = sqlx::query_as(
        &format!(
            "SELECT COUNT(DISTINCT l.producto_id) FROM stock s JOIN lotes l ON l.id = s.lote_id JOIN productos p ON p.id = l.producto_id WHERE s.cantidad > 0 AND p.activo = true {}",
            resumen_area_filter
        ),
    )
    .fetch_one(&state.pool)
    .await?;

    // "Bajo" = productos que necesitan reposición según fn_estado_stock (critico + reponer).
    // Mismo motor que la lista y el dashboard: imposible que diverja.
    let bajo_minimo: (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*) FROM (
            WITH stock_stats AS (
                SELECT l.producto_id,
                       SUM(s.cantidad) AS total,
                       MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS prox
                FROM stock s JOIN lotes l ON l.id = s.lote_id
                WHERE 1=1 {0}
                GROUP BY l.producto_id
            ),
            mov AS (
                SELECT l.producto_id,
                    ((COALESCE(SUM(CASE WHEN m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0 * 0.7)
                     + (COALESCE(SUM(CASE WHEN m.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 23.0 * 0.3)) AS cdp,
                    COALESCE(SUM(m.cantidad), 0)::FLOAT8 AS total_cons,
                    COUNT(DISTINCT m.created_at::date) AS dcc,
                    EXTRACT(DAY FROM (NOW() - MIN(m.created_at)))::INT + 1 AS dvs
                FROM lotes l
                JOIN movimientos m ON m.lote_id = l.id AND m.tipo = 'CONSUMO'
                    AND m.created_at >= NOW() - ({2}::int * INTERVAL '1 day') {1}
                GROUP BY l.producto_id
            )
            SELECT fn_estado_stock(
                COALESCE(ss.total, 0),
                CASE WHEN COALESCE(mv.dcc, 0) >= 14 THEN COALESCE(mv.cdp, 0)::FLOAT8
                     WHEN COALESCE(mv.dcc, 0) >= 1  THEN COALESCE(mv.total_cons, 0) / GREATEST(mv.dvs::FLOAT8, 1)
                     ELSE 0.0 END,
                COALESCE(mv.dcc, 0)::int,
                COALESCE(p.lead_time_propio, pv.dias_despacho_tierra, pv.dias_despacho_aereo, 7)::int,
                {3}, ss.prox, true, 3, {4}, {5}
            ) AS est
            FROM productos p
            LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
            LEFT JOIN stock_stats ss ON ss.producto_id = p.id
            LEFT JOIN mov mv ON mv.producto_id = p.id
            WHERE p.activo = true
        ) sub WHERE est IN ('critico', 'reponer')"#,
        resumen_area_filter,
        movement_area_filter,
        forecast_cfg.ventana_demanda_dias,
        forecast_cfg.dias_objetivo_cobertura,
        forecast_cfg.vencimiento_riesgo_dias,
        forecast_cfg.vencimiento_proximo_dias,
    ))
    .fetch_one(&state.pool)
    .await?;

    let por_vencer: (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(DISTINCT l.producto_id) FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           WHERE s.cantidad > 0
             AND p.activo = true
             AND l.fecha_vencimiento >= CURRENT_DATE
             AND l.fecha_vencimiento <= CURRENT_DATE + ({1} * INTERVAL '1 day')
             {0}"#,
        resumen_area_filter,
        forecast_cfg.vencimiento_proximo_dias,
    ))
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "data": rows,
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

#[derive(Debug, Serialize, sqlx::FromRow)]
struct StockItemRow {
    producto_id: Uuid,
    codigo_interno: String,
    producto_nombre: String,
    categoria: Option<String>,
    unidad: String,
    unidad_plural: Option<String>,
    stock_total: Option<Decimal>,
    lotes_count: i64,
    #[serde(skip)]
    #[allow(dead_code)]
    inicializado: bool,
    proximo_vencimiento: Option<NaiveDate>,
    proveedor_nombre: Option<String>,
    proveedor_icono: Option<String>,
    imagen_url: Option<String>,
    // estado_alerta proviene exclusivamente de fn_estado_stock (única fuente de verdad).
    estado_alerta: String,
    consumo_diario_ajustado: Decimal,
    dias_con_consumo: i64,
    // dias_autonomia se calcula en SQL con el mismo consumo que el estado.
    dias_autonomia: Option<i32>,
    // dias_autonomia_pico es un escenario aparte; lo calcula Rust desde la serie.
    #[sqlx(default)]
    dias_autonomia_pico: Option<i32>,
    #[allow(dead_code)]
    lead_time_propio: Option<i32>,
    #[serde(skip)]
    serie: Vec<f64>,
    #[serde(skip)]
    full_count: i64,
}

fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

/// Calcula `dias_autonomia_pico`: días de autonomía si el consumo alcanzara el
/// pico de 7 días observado recientemente. Es un escenario informativo aparte y
/// NO toca `estado_alerta` ni `dias_autonomia`, que provienen de `fn_estado_stock`
/// en SQL (única fuente de verdad). Solo se emite si el pico supera la base en ≥30%.
fn calcular_pico(row: &mut StockItemRow, cfg: ForecastConfig) {
    let stock_actual = decimal_to_f64(row.stock_total.unwrap_or(Decimal::ZERO));
    if stock_actual <= 0.0 {
        row.dias_autonomia_pico = None;
        return;
    }

    let dias_con_consumo = row.dias_con_consumo as i32;
    let consumo_base = if dias_con_consumo >= cfg.dias_minimos_historia {
        let serie_w = winsorize_p95(&row.serie);
        ewma(&serie_w, 0.2)
    } else {
        consumo_base_adaptivo(&row.serie)
    };
    let pico = consumo_pico_7d(&row.serie);

    row.dias_autonomia_pico = if consumo_base > 0.0001 && pico > consumo_base * 1.3 {
        Some((stock_actual / pico).floor().min(999.0) as i32)
    } else {
        None
    };
}

/// GET /api/v1/stock/area/:area_id — Stock de un área específica
async fn stock_por_area(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(area_id): Path<i32>,
    Query(params): Query<StockQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    stock_ops::validar_acceso_area(&state.pool, claims.sub, area_id, &claims.rol).await?;
    let area = sqlx::query_as::<_, AreaRef>("SELECT id, nombre FROM areas WHERE id = $1")
        .bind(area_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    }
    .validated()?;
    let limit = pagination.per_page();
    let offset = pagination.offset();
    let q_like = params.q.as_ref().map(|q| format!("%{}%", escape_like(q)));

    // Query unificada: productos + lotes + presentaciones en una sola round-trip con JSON aggregation
    let data_sql = format!(
        r#"SELECT
               p.id as producto_id,
               p.codigo_interno,
               p.nombre,
               um.nombre as unidad,
               um.nombre_plural as unidad_plural,
               COALESCE(SUM(s.cantidad), 0) AS stock,
               (
                   SELECT JSON_AGG(JSON_BUILD_OBJECT(
                       'id', pr.id,
                       'nombre', pr.nombre,
                       'nombre_plural', pr.nombre_plural,
                       'factor_conversion', pr.factor_conversion
                   ))
                   FROM presentaciones pr
                   WHERE pr.producto_id = p.id AND pr.activa = true
               ) AS presentaciones,
               JSON_AGG(
                   JSON_BUILD_OBJECT(
                       'lote_id',          s.lote_id,
                       'numero_lote',      l.numero_lote,
                       'stock',            s.cantidad,
                       'fecha_vencimiento', l.fecha_vencimiento,
                       'presentacion_nombre', lpres.nombre,
                       'presentacion_nombre_plural', lpres.nombre_plural,
                       'presentacion_factor', lpres.factor_conversion,
                       'cantidad_presentaciones_equivalente',
                           CASE
                               WHEN lpres.factor_conversion IS NOT NULL AND lpres.factor_conversion > 0
                               THEN ROUND(s.cantidad / lpres.factor_conversion, 2)
                               ELSE NULL
                           END
                   ) ORDER BY l.fecha_vencimiento ASC NULLS LAST
               ) FILTER (WHERE s.cantidad > 0) AS lotes
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           LEFT JOIN presentaciones lpres ON lpres.id = l.presentacion_id AND lpres.deleted_at IS NULL
           WHERE s.area_id = $1 AND s.cantidad > 0 AND p.activo = true
           {}
           GROUP BY p.id, p.codigo_interno, p.nombre, um.nombre, um.nombre_plural
           ORDER BY p.nombre
           LIMIT ${} OFFSET ${}"#,
        if params.q.is_some() {
            "AND (p.nombre ILIKE $2 ESCAPE '\\' OR p.codigo_interno ILIKE $2 ESCAPE '\\')"
        } else {
            ""
        },
        if params.q.is_some() { 3 } else { 2 },
        if params.q.is_some() { 4 } else { 3 },
    );

    let count_sql = format!(
        r#"SELECT COUNT(DISTINCT p.id)
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           WHERE s.area_id = $1 AND s.cantidad > 0 AND p.activo = true
           {}"#,
        if params.q.is_some() {
            "AND (p.nombre ILIKE $2 ESCAPE '\\' OR p.codigo_interno ILIKE $2 ESCAPE '\\')"
        } else {
            ""
        },
    );

    #[derive(sqlx::FromRow)]
    struct StockAreaRow {
        producto_id: Uuid,
        codigo_interno: String,
        nombre: String,
        unidad: String,
        unidad_plural: String,
        stock: Decimal,
        presentaciones: Option<serde_json::Value>,
        lotes: Option<serde_json::Value>,
    }

    let mut query = sqlx::query_as::<_, StockAreaRow>(&data_sql).bind(area_id);
    if let Some(q) = &q_like {
        query = query.bind(q);
    }
    query = query.bind(limit).bind(offset);

    let mut count_query = sqlx::query_as::<_, (i64,)>(&count_sql).bind(area_id);
    if let Some(q) = &q_like {
        count_query = count_query.bind(q);
    }
    let total = count_query.fetch_one(&state.pool).await?.0;

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
                "stock": row.stock,
                "presentaciones": row.presentaciones.unwrap_or(serde_json::json!([])),
                "lotes": row.lotes.unwrap_or(serde_json::json!([])),
            })
        })
        .collect();
    let total_pages = if limit > 0 {
        (total + limit - 1) / limit
    } else {
        1
    };

    Ok(Json(serde_json::json!({
        "area": area,
        "productos": productos_con_lotes,
        "total": total,
        "page": pagination.page(),
        "per_page": limit,
        "total_pages": total_pages,
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
    area_ids: Option<String>,
}

fn default_page() -> i64 {
    1
}
fn default_per_page() -> i64 {
    50
}

async fn load_forecast_config(pool: &sqlx::PgPool) -> Result<ForecastConfig, AppError> {
    let row: (i32, i32, i32, f64, f64, i32, i32, i32) = sqlx::query_as(
        r#"
        SELECT
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'ventana_demanda_dias'), 60),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'periodo_revision_dias'), 30),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'dias_minimos_historia'), 14),
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'nivel_servicio_z'), 1.65),
            COALESCE((SELECT valor_texto::float8 FROM configuracion WHERE clave = 'factor_historial_corto'), 0.35),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'dias_objetivo_cobertura'), 30),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'vencimiento_riesgo_dias'), 30),
            COALESCE((SELECT valor_texto::int FROM configuracion WHERE clave = 'vencimiento_proximo_dias'), 90)
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
        dias_objetivo_cobertura: row.5,
        vencimiento_riesgo_dias: row.6,
        vencimiento_proximo_dias: row.7,
    })
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AlertaRow {
    producto_id: Uuid,
    nombre: String,
    total: Decimal,
    unidad: String,
    unidad_plural: String,
    proxima_fecha_venc: Option<NaiveDate>,
    tipo_alerta: Option<String>,
    dias_inactivo: Option<i32>,
    consumo_diario_30d: Option<Decimal>,
    dias_autonomia: Option<i32>,
    dias_con_consumo: Option<i64>,
    es_anomalia: Option<bool>,
    proveedor_id: Option<i32>,
    proveedor_nombre: Option<String>,
    dias_despacho: Option<i32>,
    total_en_camino: Option<Decimal>,
    tiene_pedido_pendiente: bool,
    #[serde(skip)]
    total_count: i64,
    #[serde(skip)]
    sin_stock_count: i64,
    #[serde(skip)]
    vencido_count: i64,
    #[serde(skip)]
    bajo_minimo_count: i64,
    #[serde(skip)]
    vencimiento_count: i64,
}

/// GET /api/v1/stock/alertas — Productos que necesitan atención
async fn alertas(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<AlertasParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.clamp(1, 100);
    let page = params.page.max(1);
    let offset = (page - 1) * per_page;

    let requested_area_ids: Option<Vec<i32>> = params
        .area_ids
        .as_deref()
        .map(|ids_str| {
            ids_str
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| {
                    s.parse::<i32>().map_err(|_| {
                        AppError::Validation("area_ids debe contener solo enteros".into())
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;

    let effective_area_ids = if claims.rol == "admin" {
        requested_area_ids.unwrap_or_default()
    } else {
        match requested_area_ids {
            Some(ids) => {
                if ids.iter().any(|id| !claims.area_ids.contains(id)) {
                    return Err(AppError::Forbidden(
                        "Sin acceso a una de las áreas solicitadas".into(),
                    ));
                }
                ids
            }
            None => claims.area_ids.clone(),
        }
    };

    let (stock_area_filter, stock_exists_area_filter, movement_area_filter, product_area_filter) =
        if effective_area_ids.is_empty() {
            if claims.rol == "admin" {
                (String::new(), String::new(), String::new(), String::new())
            } else {
                (
                    String::new(),
                    String::new(),
                    String::new(),
                    "AND FALSE".to_string(),
                )
            }
        } else {
            let arr = effective_area_ids
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            (
                format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", arr),
                format!("AND si.area_id = ANY(ARRAY[{}]::integer[])", arr),
                format!("AND m.area_id = ANY(ARRAY[{}]::integer[])", arr),
                String::new(),
            )
        };

    let forecast_cfg = load_forecast_config(&state.pool).await?;

    let pedidos_cte = r#"pedidos_pendientes AS (
               SELECT
                   producto_id,
                   SUM(cantidad_sugerida) as total_en_camino
               FROM solicitud_compra_detalle scd
               JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
               WHERE sc.estado IN ('guardada', 'enviada')
               GROUP BY producto_id
           ),"#;

    let sql = format!(
        r#"WITH stock_stats AS (
               SELECT
                   p.id as producto_id,
                   COALESCE(SUM(s.cantidad), 0) AS total,
                   MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proxima_fecha_venc,
                   EXISTS (
                       SELECT 1
                       FROM movimientos m
                       JOIN lotes lm ON lm.id = m.lote_id
                       WHERE lm.producto_id = p.id {0}
                   ) OR EXISTS (
                       SELECT 1
                       FROM stock si
                       JOIN lotes lsi ON lsi.id = si.lote_id
                       WHERE lsi.producto_id = p.id {1}
                   ) AS inicializado
               FROM productos p
               LEFT JOIN lotes l ON l.producto_id = p.id
               LEFT JOIN stock s ON s.lote_id = l.id {2}
               WHERE p.activo = true
               GROUP BY p.id
           ),
           movimiento_stats AS (
               SELECT
                   p.id as producto_id,
                   MAX(m.created_at) AS ultimo_movimiento,
                   (
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0 * 0.7) +
                     (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 23.0 * 0.3)
                   )::DECIMAL AS consumo_diario_ponderado,
                   COUNT(DISTINCT CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - ({3}::int * INTERVAL '1 day') THEN m.created_at::date END) AS dias_con_consumo,
                   (EXTRACT(DAY FROM (NOW() - MIN(m.created_at) FILTER (WHERE m.tipo = 'CONSUMO' AND m.created_at >= NOW() - ({3}::int * INTERVAL '1 day'))))::INT + 1) AS dias_vida_sistema,
                   COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - ({3}::int * INTERVAL '1 day') THEN m.cantidad ELSE 0 END), 0)::FLOAT8 AS total_consumo_ventana,
                   (COALESCE(SUM(CASE WHEN m.tipo = 'CONSUMO' AND m.created_at >= NOW() - INTERVAL '7 days' THEN m.cantidad ELSE 0 END), 0) / 7.0)::DECIMAL AS consumo_7d
               FROM productos p
               LEFT JOIN lotes l ON l.producto_id = p.id
               LEFT JOIN movimientos m ON m.lote_id = l.id {0}
               GROUP BY p.id
           ),
           {4}
           stats AS (
               SELECT
                   p.id as producto_id,
                   p.nombre,
                   p.lead_time_propio,
                   p.created_at,
                   p.proveedor_id,
                   pv.nombre AS proveedor_nombre,
                   COALESCE(p.lead_time_propio, pv.dias_despacho_tierra, pv.dias_despacho_aereo, 7) AS dias_despacho,
                   ub.nombre AS unidad,
                   ub.nombre_plural AS unidad_plural,
                   COALESCE(ss.total, 0) AS total,
                   COALESCE(ss.inicializado, false) AS inicializado,
                   COALESCE(pp.total_en_camino, 0) AS total_en_camino,
                   ss.proxima_fecha_venc,
                   ms.ultimo_movimiento,
                   CASE
                       WHEN ms.dias_vida_sistema < 30 AND ms.dias_con_consumo >= 3 THEN
                           COALESCE(ms.consumo_diario_ponderado * (30.0 / GREATEST(ms.dias_vida_sistema, 7)), 0)::NUMERIC(15,4)
                       ELSE COALESCE(ms.consumo_diario_ponderado, 0)::NUMERIC(15,4)
                   END AS consumo_diario_ajustado,
                   -- consumo_base_estimado: idéntico al de /stock listar para que estado y conteos coincidan.
                   CASE
                       WHEN COALESCE(ms.dias_con_consumo, 0) >= 14 THEN COALESCE(ms.consumo_diario_ponderado, 0)::FLOAT8
                       WHEN COALESCE(ms.dias_con_consumo, 0) >= 1  THEN COALESCE(ms.total_consumo_ventana, 0) / GREATEST(ms.dias_vida_sistema::FLOAT8, 1)
                       ELSE 0.0
                   END AS consumo_base_estimado,
                   ms.dias_con_consumo,
                   (ms.consumo_7d > ms.consumo_diario_ponderado * 3 AND ms.dias_con_consumo > 5) AS es_anomalia
               FROM productos p
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
               LEFT JOIN stock_stats ss ON ss.producto_id = p.id
               LEFT JOIN movimiento_stats ms ON ms.producto_id = p.id
               LEFT JOIN pedidos_pendientes pp ON pp.producto_id = p.id
               WHERE p.activo = true
               {5}
           ),
           con_estado AS (
                SELECT
                    s.*,
                    CASE
                        WHEN total > 0 AND consumo_base_estimado > 0.0001 AND dias_con_consumo >= 3 THEN
                            LEAST(FLOOR(total / consumo_base_estimado), 999)::INT
                        ELSE NULL
                    END AS dias_autonomia,
                    fn_estado_stock(
                        total, consumo_base_estimado, dias_con_consumo::int, dias_despacho::int,
                        {6}, proxima_fecha_venc, inicializado, 3, {7}, {8}
                    ) AS estado
                FROM stats s
           ),
           filtered_alertas AS (
               SELECT
                   producto_id,
                   nombre,
                   total,
                   unidad,
                   unidad_plural,
                   proxima_fecha_venc,
                   total_en_camino,
                   (total_en_camino > 0) AS tiene_pedido_pendiente,
                   proveedor_id,
                   proveedor_nombre,
                   dias_despacho,
                   EXTRACT(DAY FROM (NOW() - COALESCE(ultimo_movimiento, NOW() - INTERVAL '365 days')))::INT as dias_inactivo,
                   consumo_diario_ajustado as consumo_diario_30d,
                   dias_con_consumo,
                   es_anomalia,
                   dias_autonomia,
                   estado as tipo_alerta
               FROM con_estado
               WHERE estado IN ('vencido', 'agotado', 'critico', 'reponer', 'riesgo_venc', 'por_vencer')
           ),
           total_count AS (
               SELECT COUNT(*) as full_count FROM filtered_alertas
           ),
           resumen AS (
               SELECT
                   COUNT(*) FILTER (WHERE tipo_alerta = 'agotado') AS sin_stock_count,
                   COUNT(*) FILTER (WHERE tipo_alerta = 'vencido') AS vencido_count,
                   COUNT(*) FILTER (WHERE tipo_alerta IN ('critico', 'reponer')) AS bajo_minimo_count,
                   COUNT(*) FILTER (WHERE tipo_alerta IN ('riesgo_venc', 'por_vencer')) AS vencimiento_count
               FROM filtered_alertas
           )
           SELECT
               fa.*,
               tc.full_count as total_count,
               r.sin_stock_count,
               r.vencido_count,
               r.bajo_minimo_count,
               r.vencimiento_count
           FROM filtered_alertas fa, total_count tc, resumen r
           ORDER BY
               CASE WHEN tipo_alerta = 'vencido' THEN 0
                    WHEN tipo_alerta = 'agotado' THEN 1
                    WHEN tipo_alerta = 'critico' THEN 2
                    WHEN tipo_alerta = 'riesgo_venc' THEN 3
                    WHEN tipo_alerta = 'reponer' THEN 4
                    WHEN tipo_alerta = 'por_vencer' THEN 5
                    ELSE 6 END,
               proxima_fecha_venc ASC NULLS LAST,
               nombre ASC
           LIMIT $1 OFFSET $2"#,
        movement_area_filter,
        stock_exists_area_filter,
        stock_area_filter,
        forecast_cfg.ventana_demanda_dias,
        pedidos_cte,
        product_area_filter,
        forecast_cfg.dias_objetivo_cobertura,
        forecast_cfg.vencimiento_riesgo_dias,
        forecast_cfg.vencimiento_proximo_dias,
    );

    let rows = sqlx::query_as::<_, AlertaRow>(&sql)
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

    let total = rows.first().map(|r| r.total_count).unwrap_or(0);
    let sin_stock_count = rows.first().map(|r| r.sin_stock_count).unwrap_or(0);
    let vencido_count = rows.first().map(|r| r.vencido_count).unwrap_or(0);
    let bajo_minimo_count = rows.first().map(|r| r.bajo_minimo_count).unwrap_or(0);
    let vencimiento_count = rows.first().map(|r| r.vencimiento_count).unwrap_or(0);
    let total_pages = (total + per_page - 1) / per_page;

    Ok(Json(serde_json::json!({
        "data": rows,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "resumen": {
            "sin_stock": sin_stock_count,
            "vencido": vencido_count,
            "bajo_minimo": bajo_minimo_count,
            "vencimiento": vencimiento_count,
        },
    })))
}

#[derive(Debug, Deserialize)]
struct LotesVencidosQuery {
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    dias_alerta: Option<i32>,
    q: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LoteVencidoItem {
    lote_id: Uuid,
    producto_id: Uuid,
    producto_nombre: String,
    codigo_lote: String,
    fecha_vencimiento: NaiveDate,
    area_id: i32,
    area_nombre: String,
    proveedor_id: Option<i32>,
    proveedor_nombre: Option<String>,
    cantidad: Decimal,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
}

async fn lotes_vencidos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<LotesVencidosQuery>,
) -> Result<Json<Vec<LoteVencidoItem>>, AppError> {
    let dias = params.dias_alerta.unwrap_or(0);
    let q = params
        .q
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| s.chars().count() >= 2)
        .map(|s| format!("%{}%", escape_like(&s.to_lowercase())));

    let mut conditions = vec![
        "s.cantidad > 0".to_string(),
        "(
            ($2::TEXT IS NULL AND l.fecha_vencimiento <= CURRENT_DATE + ($1 * INTERVAL '1 day'))
            OR
            ($2::TEXT IS NOT NULL AND (
                LOWER(p.nombre) LIKE $2 ESCAPE '\'
                OR LOWER(l.numero_lote) LIKE $2 ESCAPE '\'
            ))
        )"
        .to_string(),
        "p.activo = true".to_string(),
    ];
    let mut param_idx = 2u32;
    let allowed_area_ids = if claims.rol == "admin" {
        None
    } else if let Some(area_id) = params.area_id {
        if !claims.area_ids.contains(&area_id) {
            return Err(AppError::Forbidden("Sin acceso al area solicitada".into()));
        }
        None
    } else if claims.area_ids.is_empty() {
        conditions.push("FALSE".to_string());
        None
    } else {
        param_idx += 1;
        conditions.push(format!("s.area_id = ANY(${})", param_idx));
        Some(claims.area_ids.clone())
    };

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("s.area_id = ${}", param_idx));
    }
    if params.proveedor_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.proveedor_id = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let sql = format!(
        r#"SELECT
               s.lote_id,
               l.producto_id,
               p.nombre AS producto_nombre,
               l.numero_lote AS codigo_lote,
               l.fecha_vencimiento,
               s.area_id,
               a.nombre AS area_nombre,
               l.proveedor_id,
               pv.nombre AS proveedor_nombre,
               s.cantidad,
               um.nombre AS unidad_base_nombre,
               um.nombre_plural AS unidad_base_nombre_plural
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = s.area_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           LEFT JOIN proveedores pv ON pv.id = l.proveedor_id
           WHERE {}
           ORDER BY l.fecha_vencimiento ASC, p.nombre ASC"#,
        where_clause
    );

    let mut query = sqlx::query_as::<_, LoteVencidoItem>(&sql)
        .bind(dias)
        .bind(q);
    if let Some(ids) = allowed_area_ids {
        query = query.bind(ids);
    }
    if let Some(v) = params.area_id {
        query = query.bind(v);
    }
    if let Some(v) = params.proveedor_id {
        query = query.bind(v);
    }

    let items = query.fetch_all(&state.pool).await?;
    Ok(Json(items))
}

/// GET /api/v1/stock/balance-check — Verifica integridad del stock contra los movimientos
///
/// Compares the materialised stock table against a sum of signed movements per (lote, area).
/// An empty `discrepancias` array means the ledger is healthy.
///
/// TODO: add admin role guard once auth middleware extraction is refactored.
pub async fn balance_check(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = sqlx::query(
        "SELECT lote_id, area_id, stock_calculado, stock_materializado, discrepancia \
         FROM v_stock_balance_check ORDER BY discrepancia DESC",
    )
    .fetch_all(&state.pool)
    .await?;

    let discrepancias: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "lote_id": r.get::<Uuid, _>("lote_id"),
                "area_id": r.get::<i32, _>("area_id"),
                "stock_calculado": r.get::<Decimal, _>("stock_calculado"),
                "stock_materializado": r.get::<Decimal, _>("stock_materializado"),
                "discrepancia": r.get::<Decimal, _>("discrepancia"),
            })
        })
        .collect();

    let sano = discrepancias.is_empty();
    Ok(Json(serde_json::json!({
        "discrepancias": discrepancias,
        "sano": sano,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/area/{area_id}", get(stock_por_area))
        .route("/alertas", get(alertas))
        .route("/lotes-vencidos", get(lotes_vencidos))
        .route("/balance-check", get(balance_check))
}

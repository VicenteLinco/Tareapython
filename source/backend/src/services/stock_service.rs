//! Acceso a datos y reglas de negocio del módulo de stock.
//!
//! Fachada sobre el subsistema SQL de stock: vista principal (`listar`), stock
//! por área, alertas, lotes por vencer y verificación de integridad del ledger.
//! Los handlers (`handlers/stock.rs`) solo parsean el request, llaman a estas
//! funciones y arman la respuesta JSON. El SQL vive acá (convención
//! handler/service del proyecto).

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::errors::AppError;
use crate::services::forecast::{
    ForecastConfig, consumo_base_adaptivo, consumo_pico_7d, ewma, winsorize_p95,
};

// === Helpers ===

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

/// Carga la configuración de forecast desde la tabla `configuracion`, con
/// valores por defecto cuando una clave no está seteada.
pub async fn load_forecast_config(pool: &PgPool) -> Result<ForecastConfig, AppError> {
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

// === Vista principal: listar ===

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StockItemRow {
    pub producto_id: Uuid,
    pub codigo_interno: String,
    // SKU comercial (opcional). Es el código de negocio que el usuario prioriza
    // sobre codigo_interno; puede venir NULL si el producto no lo tiene cargado.
    pub sku: Option<String>,
    pub producto_nombre: String,
    pub categoria: Option<String>,
    pub unidad: String,
    pub unidad_plural: Option<String>,
    pub stock_total: Option<Decimal>,
    pub lotes_count: i64,
    // % del stock total en el/los lote(s) que vencen en la fecha más próxima.
    // Permite distinguir un vencimiento marginal de uno real sin ocultar nada.
    #[sqlx(default)]
    pub pct_por_vencer: Option<i32>,
    #[serde(skip)]
    #[allow(dead_code)]
    pub inicializado: bool,
    pub proximo_vencimiento: Option<NaiveDate>,
    pub proveedor_nombre: Option<String>,
    pub proveedor_icono: Option<String>,
    pub imagen_url: Option<String>,
    // estado_alerta proviene exclusivamente de fn_estado_stock (única fuente de verdad).
    pub estado_alerta: String,
    // Modelo de dos ejes ortogonales (migration 002). estado_cantidad responde
    // "¿comprar?" (sobre stock usable); estado_vencimiento responde "¿descartar?".
    // Nunca se pisan: cascada dentro de cada eje, jamás entre ejes.
    pub estado_cantidad: String,
    pub estado_vencimiento: String,
    // Stock usable (no vencido) vs stock vencido (sólo apto para descarte).
    // stock_usable es lo que el FEFO deja consumir y el titular que muestra la UI.
    pub stock_usable: Decimal,
    pub stock_vencido: Decimal,
    pub consumo_diario_ajustado: Decimal,
    pub dias_con_consumo: i64,
    // dias_autonomia se calcula en SQL con el mismo consumo que el estado.
    pub dias_autonomia: Option<i32>,
    // dias_autonomia_pico es un escenario aparte; lo calcula Rust desde la serie.
    #[sqlx(default)]
    pub dias_autonomia_pico: Option<i32>,
    #[allow(dead_code)]
    pub lead_time_propio: Option<i32>,
    // Valorización: valor del stock del producto = Σ(cantidad × costo del lote).
    // Se calcula en queries aparte y se mergea en Rust; no viene del query principal.
    #[sqlx(default)]
    pub valor_stock: Decimal,
    // Unidades del producto cuyo lote no tiene costo cargado (cuentan como $0).
    #[sqlx(default)]
    pub unidades_sin_costo: Decimal,
    #[serde(skip)]
    pub serie: Vec<f64>,
    #[serde(skip)]
    pub full_count: i64,
}

/// Costo por unidad base de un lote (alias SQL `l`): del setup
/// (`lotes.costo_unitario`, ya en base) o, si no, del precio de su última
/// recepción (que está por presentación) normalizado dividiendo por el factor.
const COSTO_BASE_LATERAL: &str = r#"LEFT JOIN LATERAL (
            SELECT COALESCE(
                l.costo_unitario,
                (SELECT CASE WHEN rd.factor_conversion_usado > 0
                             THEN rd.precio_unitario / rd.factor_conversion_usado
                             ELSE rd.precio_unitario END
                 FROM recepcion_detalle rd
                 JOIN recepciones r ON r.id = rd.recepcion_id
                 WHERE rd.lote_id = l.id AND rd.precio_unitario IS NOT NULL
                 ORDER BY r.created_at DESC, rd.id DESC
                 LIMIT 1)
            ) AS costo_base
        ) cb ON true"#;

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

/// Parámetros (ya parseados desde el request) para la vista principal de stock.
pub struct ListarParams {
    pub area_id: Option<i32>,
    pub area_ids: Vec<i32>,
    pub q: Option<String>,
    pub categoria_id: Option<i32>,
    pub proveedor_id: Option<i32>,
    pub stock_bajo: Option<bool>,
    pub con_alertas: Option<bool>,
    pub filter: Option<String>,
    pub estado: Option<String>,
    pub custom_filters: Option<String>,
    pub incluir_pendientes: bool,
    pub limit: i64,
    pub offset: i64,
}

pub const STOCK_PAGE_ORDER: &str = "f.producto_nombre, f.producto_id";

pub struct ListarResultado {
    pub rows: Vec<StockItemRow>,
    pub total: i64,
    pub total_productos_con_stock: i64,
    pub productos_bajo_minimo: i64,
    pub productos_por_vencer_90d: i64,
    pub valor_total_inventario: Decimal,
    pub unidades_sin_costo: Decimal,
    pub unidades_total_inventario: Decimal,
}

pub async fn listar(pool: &PgPool, params: ListarParams) -> Result<ListarResultado, AppError> {
    let forecast_cfg = load_forecast_config(pool).await?;

    // El área es solo un filtro opcional: cualquier rol puede consultar cualquier área.
    let scoped_area_ids = if let Some(aid) = params.area_id {
        vec![aid]
    } else {
        params.area_ids.clone()
    };

    let limit = params.limit;
    let offset = params.offset;

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
    let catalog_filter = if params.incluir_pendientes {
        ""
    } else {
        "AND p.estado_catalogo = 'aprobado'"
    };

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
    // Manual reorder/ceiling levels are per producto+area. With no area filter we
    // sum across all areas; with an area filter we scope to that exact area.
    let par_area_filter = if let Some(area_ids) = &scoped_area_array {
        format!("AND pl.area_id = ANY(ARRAY[{}]::integer[])", area_ids)
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
            "AND EXISTS (SELECT 1 FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE pres.producto_id = p.id AND op.proveedor_id = ${}::integer)",
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

    // Filtros por los dos ejes ortogonales: "agotado"/"bajo" miran el eje cantidad,
    // "vencido"/"vence_pronto" el eje vencimiento. Un ítem vencido+agotado aparece
    // bajo AMBOS filtros, porque son hechos simultáneos.
    let type_filter = match estado {
        "agotado" => "AND estado_cantidad = 'agotado'",
        "vencido" => "AND estado_vencimiento = 'vencido'",
        "bajo" => "AND estado_cantidad IN ('critico', 'reponer')",
        "vence_pronto" => "AND estado_vencimiento IN ('riesgo_venc', 'por_vencer')",
        "exceso" => "AND estado_cantidad = 'exceso'",
        "sin_datos" => "AND estado_cantidad = 'sin_datos'",
        "normal" => "AND estado_cantidad = 'normal' AND estado_vencimiento = 'ok'",
        _ if params.stock_bajo == Some(true) => "AND estado_cantidad IN ('critico', 'reponer')",
        _ if params.con_alertas == Some(true) => {
            "AND (estado_cantidad IN ('agotado','critico','reponer') OR estado_vencimiento IN ('vencido','riesgo_venc','por_vencer'))"
        }
        _ => match filter {
            "vencimiento" => "AND estado_vencimiento IN ('riesgo_venc', 'por_vencer')",
            "vencidos" => "AND estado_vencimiento = 'vencido'",
            "sin-stock" => "AND estado_cantidad = 'agotado'",
            "bajo" | "critico" => "AND estado_cantidad IN ('critico', 'reponer')",
            _ => "",
        },
    };

    let mut custom_filters_clause = String::new();
    if let Some(cf_map) = params
        .custom_filters
        .as_ref()
        .and_then(|s| serde_json::from_str::<std::collections::HashMap<String, String>>(s).ok())
    {
        for (def_id_str, filter_val) in cf_map {
            if let Ok(def_id) = uuid::Uuid::parse_str(&def_id_str) {
                param_idx += 1;
                binds.push(def_id.to_string());
                let bind_def_id = param_idx;

                param_idx += 1;
                binds.push(filter_val);
                let bind_val = param_idx;

                custom_filters_clause.push_str(&format!(
                    " AND EXISTS (
                        SELECT 1 FROM lab_campo_definicion d
                        LEFT JOIN lab_campo_valor v ON v.definicion_id = d.id
                        WHERE d.id = ${}::uuid AND d.considerar_filtro = true
                        AND (
                            (d.tipo_dato = 'texto' AND COALESCE(v.valor_texto, '') = ${}) OR
                            (d.tipo_dato = 'lista' AND COALESCE(v.valor_texto, '') = ${}) OR
                            (d.tipo_dato = 'entero' AND COALESCE(v.valor_entero::text, '') = ${}) OR
                            (d.tipo_dato = 'booleano' AND COALESCE(v.valor_booleano::text, 'false') = ${}) OR
                            (d.tipo_dato = 'fecha' AND COALESCE(v.valor_fecha::text, '') = ${})
                        )
                    )",
                    bind_def_id, bind_val, bind_val, bind_val, bind_val, bind_val
                ));
            }
        }
    }

    let filtered_clause = format!("{} {}", type_filter, custom_filters_clause);

    let (stock_col, stock_table, area_filter2) = if let Some(area_ids) = &scoped_area_array {
        (
            "s.cantidad",
            "stock",
            format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", area_ids),
        )
    } else {
        ("s.stock_actual", "stock_snapshot", "".to_string())
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
           stock_lotes AS (
               SELECT
                   l.producto_id,
                   l.id AS lote_id,
                   l.fecha_vencimiento,
                   {} AS cantidad,
                   -- Vencimiento más próximo entre el stock USABLE (no vencido).
                   -- Excluir lo vencido es lo que separa "vence pronto" de "ya venció".
                   MIN(l.fecha_vencimiento) FILTER (
                       WHERE {} > 0
                         AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
                   ) OVER (PARTITION BY l.producto_id) AS prox_fecha
               FROM {} s
               JOIN lotes l ON l.id = s.lote_id
               WHERE 1=1 {}
           ),
           stock_stats AS (
               SELECT
                   producto_id,
                   SUM(cantidad) AS total,
                   -- Usable = no vencido (o sin fecha). Es lo que el FEFO realmente
                   -- deja consumir y el número que la UI muestra como titular.
                   COALESCE(SUM(cantidad) FILTER (
                       WHERE cantidad > 0
                         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURRENT_DATE)
                   ), 0) AS stock_usable,
                   -- Vencido = stock físico con fecha pasada, sólo apto para descarte.
                   COALESCE(SUM(cantidad) FILTER (
                       WHERE cantidad > 0
                         AND fecha_vencimiento IS NOT NULL
                         AND fecha_vencimiento < CURRENT_DATE
                   ), 0) AS stock_vencido,
                   MIN(fecha_vencimiento) FILTER (WHERE cantidad > 0) AS proxima_fecha_venc,
                   -- Vencimiento más próximo del stock usable: alimenta riesgo_venc/por_vencer.
                   MIN(fecha_vencimiento) FILTER (
                       WHERE cantidad > 0
                         AND fecha_vencimiento IS NOT NULL
                         AND fecha_vencimiento >= CURRENT_DATE
                   ) AS prox_venc_usable,
                   bool_or(
                       cantidad > 0
                         AND fecha_vencimiento IS NOT NULL
                         AND fecha_vencimiento < CURRENT_DATE
                   ) AS tiene_vencido,
                   -- Stock del/los lote(s) usables que vencen en la fecha MÁS próxima (no toda
                   -- la ventana de 90 días). El porcentaje informado corresponde al vencimiento
                   -- más inmediato, que es lo que el badge alerta junto a "vence en X días".
                   COALESCE(SUM(cantidad) FILTER (
                       WHERE cantidad > 0
                         AND fecha_vencimiento IS NOT NULL
                         AND fecha_vencimiento = prox_fecha
                   ), 0) AS cantidad_por_vencer,
                   COUNT(DISTINCT lote_id) FILTER (WHERE cantidad > 0) AS lotes_con_stock,
                   COALESCE(bool_or(EXISTS (
                       SELECT 1 FROM movimientos m
                       WHERE m.lote_id = stock_lotes.lote_id
                         AND m.tipo = 'DESCARTE_VENCIDO'
                         AND m.created_at >= NOW() - INTERVAL '7 days'
                   )), false) AS recientemente_descartado
               FROM stock_lotes
               GROUP BY producto_id
           ),
           par_levels AS (
               SELECT
                   producto_id,
                   SUM(stock_minimo) AS min_manual,
                   SUM(stock_maximo) AS max_manual
               FROM par_level_config pl
               WHERE 1=1 {}
               GROUP BY producto_id
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
               JOIN {} s ON s.lote_id = l2.id
               JOIN proveedores pv ON pv.id = l2.proveedor_id
               WHERE {} > 0 {}
               ORDER BY l2.producto_id, l2.fecha_vencimiento ASC
           ),
           final_stats AS (
               SELECT
                   p.id as producto_id,
                   p.codigo_interno,
                   (SELECT pres.sku FROM presentaciones pres WHERE pres.producto_id = p.id AND pres.sku IS NOT NULL LIMIT 1) AS sku,
                   p.control_lote,
                   p.nombre as producto_nombre,
                   c.nombre as categoria,
                   COALESCE(um.nombre, 'Sin unidad') as unidad,
                   COALESCE(um.nombre_plural, 'Sin unidades') as unidad_plural,
                   COALESCE(ss.total, 0) as stock_total,
                   COALESCE(ss.lotes_con_stock, 0) as lotes_count,
                   CASE WHEN COALESCE(ss.total, 0) > 0
                        THEN ROUND(COALESCE(ss.cantidad_por_vencer, 0) / ss.total * 100)::int
                        ELSE NULL END AS pct_por_vencer,
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
                   END AS consumo_base_estimado,
                   COALESCE(ss.stock_usable, 0) AS stock_usable,
                   COALESCE(ss.stock_vencido, 0) AS stock_vencido,
                   ss.prox_venc_usable,
                   COALESCE(ss.tiene_vencido, false) AS tiene_vencido,
                   COALESCE(ss.recientemente_descartado, false) AS recientemente_descartado,
                   pl.min_manual,
                   pl.max_manual
               FROM productos p
               LEFT JOIN unidades_basicas um ON um.id = p.unidad_base_id
               LEFT JOIN categorias c ON c.id = p.categoria_id
               LEFT JOIN proveedores pv2 ON pv2.id = (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE pres.producto_id = p.id LIMIT 1)
               LEFT JOIN stock_stats ss ON ss.producto_id = p.id
               LEFT JOIN movimiento_stats ms ON ms.producto_id = p.id
               LEFT JOIN fefo_prov fp ON fp.producto_id = p.id
               LEFT JOIN series sr ON sr.producto_id = p.id
               LEFT JOIN par_levels pl ON pl.producto_id = p.id
               WHERE p.activo = true {} {} {} {}
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
                   ) AS estado_alerta,
                   -- Eje cantidad: sobre stock USABLE; el mínimo manual sólo respalda
                   -- el caso sin historia de consumo.
                   fn_estado_cantidad(
                       stock_usable,
                       consumo_base_estimado,
                       dias_con_consumo::int,
                       lead_time_efectivo::int,
                       {},   -- dias_objetivo_cobertura
                       inicializado,
                       min_manual,
                       max_manual,
                       3     -- dias_min_historia
                   ) AS estado_cantidad,
                   -- Eje vencimiento: cascada interna de urgencia, independiente de cantidad.
                   fn_estado_vencimiento(
                       tiene_vencido,
                       prox_venc_usable,
                       control_lote <> 'simple',   -- 'simple' no rastrea vencimiento
                       {},   -- vencimiento_riesgo_dias
                       {},   -- vencimiento_proximo_dias
                       recientemente_descartado
                   ) AS estado_vencimiento
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
           ORDER BY {}
           LIMIT ${} OFFSET ${}"#,
        forecast_cfg.ventana_demanda_dias,
        movement_area_filter,
        stock_col,
        stock_col,
        stock_table,
        area_filter,
        par_area_filter,
        forecast_cfg.ventana_demanda_dias,
        movement_area_filter,
        stock_table,
        stock_col,
        area_filter2,
        inicializado_expr,
        catalog_filter,
        q_filter,
        cat_filter,
        prov_filter,
        forecast_cfg.dias_objetivo_cobertura,
        forecast_cfg.vencimiento_riesgo_dias,
        forecast_cfg.vencimiento_proximo_dias,
        forecast_cfg.dias_objetivo_cobertura,
        forecast_cfg.vencimiento_riesgo_dias,
        forecast_cfg.vencimiento_proximo_dias,
        if !params.incluir_pendientes
            && !con_alertas
            && params.q.is_none()
            && params.categoria_id.is_none()
            && params.proveedor_id.is_none()
        {
            "AND estado_cantidad <> 'no_gestionado'"
        } else {
            ""
        },
        filtered_clause,
        STOCK_PAGE_ORDER,
        param_idx + 1,
        param_idx + 2
    );

    let mut query = sqlx::query_as::<_, StockItemRow>(&sql);
    for b in &binds {
        query = query.bind(b.as_str());
    }
    query = query.bind(limit).bind(offset);

    let rows = query.fetch_all(pool).await?;
    let mut rows: Vec<StockItemRow> = rows
        .into_iter()
        .map(|mut row| {
            calcular_pico(&mut row, forecast_cfg);
            row
        })
        .collect();
    let total = if let Some(row) = rows.first() {
        row.full_count
    } else if offset > 0 {
        let mut probe = sqlx::query_as::<_, StockItemRow>(&sql);
        for b in &binds {
            probe = probe.bind(b.as_str());
        }
        probe
            .bind(1_i64)
            .bind(0_i64)
            .fetch_optional(pool)
            .await?
            .map(|row| row.full_count)
            .unwrap_or(0)
    } else {
        0
    };

    let resumen_area_filter = scoped_area_array
        .as_ref()
        .map(|area_ids| format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", area_ids))
        .unwrap_or_default();
    let par_resumen_area_filter = scoped_area_array
        .as_ref()
        .map(|area_ids| format!("AND pl.area_id = ANY(ARRAY[{}]::integer[])", area_ids))
        .unwrap_or_default();

    // Valorización por producto para los ítems de la página (query aislada del
    // query principal). Costo por lote vía COSTO_BASE_LATERAL; se mergea en Rust.
    let page_ids: Vec<Uuid> = rows.iter().map(|r| r.producto_id).collect();
    if !page_ids.is_empty() {
        #[derive(sqlx::FromRow)]
        struct ValorRow {
            producto_id: Uuid,
            valor_stock: Decimal,
            unidades_sin_costo: Decimal,
        }
        let valor_sql = format!(
            r#"SELECT l.producto_id,
                   COALESCE(SUM(s.cantidad * cb.costo_base) FILTER (WHERE cb.costo_base IS NOT NULL), 0) AS valor_stock,
                   COALESCE(SUM(s.cantidad) FILTER (WHERE cb.costo_base IS NULL AND s.cantidad > 0), 0) AS unidades_sin_costo
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               {}
               WHERE l.producto_id = ANY($1) AND s.cantidad > 0 {}
               GROUP BY l.producto_id"#,
            COSTO_BASE_LATERAL, resumen_area_filter
        );
        let valores = sqlx::query_as::<_, ValorRow>(&valor_sql)
            .bind(&page_ids)
            .fetch_all(pool)
            .await?;
        let mut by_id: std::collections::HashMap<Uuid, (Decimal, Decimal)> =
            std::collections::HashMap::with_capacity(valores.len());
        for v in valores {
            by_id.insert(v.producto_id, (v.valor_stock, v.unidades_sin_costo));
        }
        for row in &mut rows {
            if let Some((valor, sin_costo)) = by_id.get(&row.producto_id) {
                row.valor_stock = *valor;
                row.unidades_sin_costo = *sin_costo;
            }
        }
    }

    // Valor total del inventario (sobre el área filtrada, igual que el resto del resumen).
    let valor_total: (Decimal, Decimal, Decimal) = sqlx::query_as(&format!(
        r#"SELECT
               COALESCE(SUM(s.cantidad * cb.costo_base) FILTER (WHERE cb.costo_base IS NOT NULL), 0) AS valor_total,
               COALESCE(SUM(s.cantidad) FILTER (WHERE cb.costo_base IS NULL AND s.cantidad > 0), 0) AS unidades_sin_costo,
               COALESCE(SUM(s.cantidad) FILTER (WHERE s.cantidad > 0), 0) AS unidades_total
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           {}
           WHERE s.cantidad > 0 AND p.activo = true {}"#,
        COSTO_BASE_LATERAL, resumen_area_filter
    ))
    .fetch_one(pool)
    .await?;

    // Resumen
    let resumen_total: (i64,) = sqlx::query_as(
        &format!(
            "SELECT COUNT(DISTINCT l.producto_id) FROM stock s JOIN lotes l ON l.id = s.lote_id JOIN productos p ON p.id = l.producto_id WHERE s.cantidad > 0 AND p.activo = true {}",
            resumen_area_filter
        ),
    )
    .fetch_one(pool)
    .await?;

    // "Bajo" = productos que necesitan reposición según fn_estado_stock (critico + reponer).
    // Mismo motor que la lista y el dashboard: imposible que diverja.
    let bajo_minimo: (i64,) = sqlx::query_as(&format!(
        r#"SELECT COUNT(*) FROM (
            WITH stock_stats AS (
                SELECT l.producto_id,
                       -- Mismo motor que la lista/dashboard: el eje cantidad mira lo USABLE.
                       SUM(s.cantidad) FILTER (WHERE s.cantidad > 0 AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)) AS usable
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
            ),
            par AS (
                SELECT producto_id,
                       SUM(stock_minimo) AS min_manual,
                       SUM(stock_maximo) AS max_manual
                FROM par_level_config pl
                WHERE 1=1 {4}
                GROUP BY producto_id
            )
            SELECT fn_estado_cantidad(
                COALESCE(ss.usable, 0),
                CASE WHEN COALESCE(mv.dcc, 0) >= 14 THEN COALESCE(mv.cdp, 0)::FLOAT8
                     WHEN COALESCE(mv.dcc, 0) >= 1  THEN COALESCE(mv.total_cons, 0) / GREATEST(mv.dvs::FLOAT8, 1)
                     ELSE 0.0 END,
                COALESCE(mv.dcc, 0)::int,
                COALESCE(p.lead_time_propio, pv.dias_despacho_tierra, pv.dias_despacho_aereo, 7)::int,
                {3}, true, par.min_manual, par.max_manual, 3
            ) AS est
            FROM productos p
            LEFT JOIN proveedores pv ON pv.id = (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE pres.producto_id = p.id LIMIT 1)
            LEFT JOIN stock_stats ss ON ss.producto_id = p.id
            LEFT JOIN par ON par.producto_id = p.id
            LEFT JOIN mov mv ON mv.producto_id = p.id
            WHERE p.activo = true
        ) sub WHERE est IN ('critico', 'reponer')"#,
        resumen_area_filter,
        movement_area_filter,
        forecast_cfg.ventana_demanda_dias,
        forecast_cfg.dias_objetivo_cobertura,
        par_resumen_area_filter,
    ))
    .fetch_one(pool)
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
        resumen_area_filter, forecast_cfg.vencimiento_proximo_dias,
    ))
    .fetch_one(pool)
    .await?;

    Ok(ListarResultado {
        rows,
        total,
        total_productos_con_stock: resumen_total.0,
        productos_bajo_minimo: bajo_minimo.0,
        productos_por_vencer_90d: por_vencer.0,
        valor_total_inventario: valor_total.0,
        unidades_sin_costo: valor_total.1,
        unidades_total_inventario: valor_total.2,
    })
}

// === Stock por área ===

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AreaRef {
    pub id: i32,
    pub nombre: String,
}

pub struct PorAreaResultado {
    pub area: AreaRef,
    pub productos: Vec<serde_json::Value>,
    pub total: i64,
}

pub async fn por_area(
    pool: &PgPool,
    area_id: i32,
    q: Option<String>,
    limit: i64,
    offset: i64,
) -> Result<PorAreaResultado, AppError> {
    // El área es solo un filtro: cualquier rol puede ver el stock de cualquier área.
    let area = sqlx::query_as::<_, AreaRef>("SELECT id, nombre FROM areas WHERE id = $1")
        .bind(area_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound("Área no encontrada".into()))?;

    let q_like = q.as_ref().map(|q| format!("%{}%", escape_like(q)));

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
        if q.is_some() {
            "AND (p.nombre ILIKE $2 ESCAPE '\\' OR p.codigo_interno ILIKE $2 ESCAPE '\\')"
        } else {
            ""
        },
        if q.is_some() { 3 } else { 2 },
        if q.is_some() { 4 } else { 3 },
    );

    let count_sql = format!(
        r#"SELECT COUNT(DISTINCT p.id)
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           JOIN productos p ON p.id = l.producto_id
           WHERE s.area_id = $1 AND s.cantidad > 0 AND p.activo = true
           {}"#,
        if q.is_some() {
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
    let total = count_query.fetch_one(pool).await?.0;

    let filas = query.fetch_all(pool).await?;

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

    Ok(PorAreaResultado {
        area,
        productos: productos_con_lotes,
        total,
    })
}

// === Alertas ===

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AlertaRow {
    pub producto_id: Uuid,
    pub nombre: String,
    pub total: Decimal,
    pub unidad: String,
    pub unidad_plural: String,
    pub proxima_fecha_venc: Option<NaiveDate>,
    // Días hasta el lote que vence antes (puede ser el más próximo de varios).
    #[sqlx(default)]
    pub dias_para_vencer: Option<i32>,
    // % del stock total en el/los lote(s) que vencen en la fecha más próxima.
    #[sqlx(default)]
    pub pct_por_vencer: Option<i32>,
    pub tipo_alerta: Option<String>,
    pub dias_inactivo: Option<i32>,
    pub consumo_diario_30d: Option<Decimal>,
    pub dias_autonomia: Option<i32>,
    pub dias_con_consumo: Option<i64>,
    pub es_anomalia: Option<bool>,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub dias_despacho: Option<i32>,
    pub total_en_camino: Option<Decimal>,
    pub tiene_pedido_pendiente: bool,
    #[serde(skip)]
    pub total_count: i64,
    #[serde(skip)]
    pub sin_stock_count: i64,
    #[serde(skip)]
    pub vencido_count: i64,
    #[serde(skip)]
    pub bajo_minimo_count: i64,
    #[serde(skip)]
    pub vencimiento_count: i64,
}

pub struct AlertasResultado {
    pub rows: Vec<AlertaRow>,
    pub total: i64,
    pub sin_stock_count: i64,
    pub vencido_count: i64,
    pub bajo_minimo_count: i64,
    pub vencimiento_count: i64,
}

pub async fn alertas(
    pool: &PgPool,
    area_ids: Vec<i32>,
    per_page: i64,
    offset: i64,
) -> Result<AlertasResultado, AppError> {
    // El área es solo un filtro opcional: cualquier rol puede pedir cualquier área (o todas).
    let (
        stock_area_filter,
        stock_exists_area_filter,
        movement_area_filter,
        product_area_filter,
        par_area_filter,
    ) = if area_ids.is_empty() {
        (
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        )
    } else {
        let arr = area_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        (
            format!("AND s.area_id = ANY(ARRAY[{}]::integer[])", arr),
            format!("AND si.area_id = ANY(ARRAY[{}]::integer[])", arr),
            format!("AND m.area_id = ANY(ARRAY[{}]::integer[])", arr),
            String::new(),
            format!("AND pl.area_id = ANY(ARRAY[{}]::integer[])", arr),
        )
    };

    let forecast_cfg = load_forecast_config(pool).await?;

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
                    -- Modelo de dos ejes (migration 002): usable vs vencido, igual que /stock listar.
                    COALESCE(SUM(s.cantidad) FILTER (WHERE s.cantidad > 0 AND p.estado_catalogo = 'aprobado' AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)), 0) AS stock_usable,
                    COALESCE(SUM(s.cantidad) FILTER (WHERE s.cantidad > 0 AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < CURRENT_DATE), 0) AS stock_vencido,
                    MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0 AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento >= CURRENT_DATE) AS prox_venc_usable,
                    COALESCE(bool_or(s.cantidad > 0 AND l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < CURRENT_DATE), false) AS tiene_vencido,
                    MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proxima_fecha_venc,
                    COALESCE(bool_or(EXISTS (
                        SELECT 1 FROM movimientos m
                        WHERE m.lote_id = s.lote_id
                          AND m.tipo = 'DESCARTE_VENCIDO'
                          AND m.created_at >= NOW() - INTERVAL '7 days'
                    )), false) AS recientemente_descartado,
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
                WHERE p.activo = true AND p.estado_catalogo = 'aprobado'
                GROUP BY p.id
            ),
            par_levels AS (
               SELECT producto_id,
                      SUM(stock_minimo) AS min_manual,
                      SUM(stock_maximo) AS max_manual
               FROM par_level_config pl
               WHERE 1=1 {9}
               GROUP BY producto_id
           ),
           prox_venc AS (
               -- Stock del/los lote(s) que vencen en la fecha MÁS próxima (no toda la
               -- ventana de 90 días), para informar el % del vencimiento más inmediato.
               SELECT producto_id,
                      COALESCE(SUM(cantidad) FILTER (
                          WHERE cantidad > 0
                            AND fecha_vencimiento IS NOT NULL
                            AND fecha_vencimiento = prox_fecha
                      ), 0) AS cantidad_por_vencer
               FROM (
                   SELECT l.producto_id, l.fecha_vencimiento, s.cantidad,
                          MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0)
                              OVER (PARTITION BY l.producto_id) AS prox_fecha
                   FROM stock s
                   JOIN lotes l ON l.id = s.lote_id
                   WHERE 1=1 {2}
               ) t
               GROUP BY producto_id
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
                   p.control_lote,
                   p.lead_time_propio,
                   p.created_at,
                   (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE pres.producto_id = p.id LIMIT 1) AS proveedor_id,
                   pv.nombre AS proveedor_nombre,
                   COALESCE(p.lead_time_propio, pv.dias_despacho_tierra, pv.dias_despacho_aereo, 7) AS dias_despacho,
                   ub.nombre AS unidad,
                   ub.nombre_plural AS unidad_plural,
                   COALESCE(ss.total, 0) AS total,
                   COALESCE(ss.stock_usable, 0) AS stock_usable,
                   COALESCE(ss.stock_vencido, 0) AS stock_vencido,
                   ss.prox_venc_usable,
                   COALESCE(ss.tiene_vencido, false) AS tiene_vencido,
                   COALESCE(ss.recientemente_descartado, false) AS recientemente_descartado,
                   pl.min_manual,
                   pl.max_manual,
                   COALESCE(ss.inicializado, false) AS inicializado,
                   COALESCE(pp.total_en_camino, 0) AS total_en_camino,
                   ss.proxima_fecha_venc,
                   COALESCE(pvenc.cantidad_por_vencer, 0) AS cantidad_por_vencer,
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
               LEFT JOIN proveedores pv ON pv.id = (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pres ON pres.id = op.presentacion_id WHERE pres.producto_id = p.id LIMIT 1)
               LEFT JOIN stock_stats ss ON ss.producto_id = p.id
               LEFT JOIN par_levels pl ON pl.producto_id = p.id
               LEFT JOIN prox_venc pvenc ON pvenc.producto_id = p.id
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
                    ) AS estado,
                    -- Dos ejes ortogonales: el conteo del dashboard cuenta por cada eje,
                    -- así un ítem vencido+agotado suma en AMBOS (vencido y agotado).
                    fn_estado_cantidad(
                        stock_usable, consumo_base_estimado, dias_con_consumo::int, dias_despacho::int,
                        {6}, inicializado, min_manual, max_manual, 3
                    ) AS estado_cantidad,
                    fn_estado_vencimiento(tiene_vencido, prox_venc_usable, control_lote <> 'simple', {7}, {8}, recientemente_descartado) AS estado_vencimiento
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
                   CASE WHEN proxima_fecha_venc IS NOT NULL
                        THEN (proxima_fecha_venc - CURRENT_DATE)::int
                        ELSE NULL END AS dias_para_vencer,
                   CASE WHEN total > 0
                        THEN ROUND(cantidad_por_vencer / total * 100)::int
                        ELSE NULL END AS pct_por_vencer,
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
                   estado as tipo_alerta,
                   estado_cantidad,
                   estado_vencimiento
               FROM con_estado
               WHERE estado_cantidad IN ('agotado', 'critico', 'reponer')
                  OR estado_vencimiento IN ('vencido', 'riesgo_venc', 'por_vencer')
           ),
           total_count AS (
               SELECT COUNT(*) as full_count FROM filtered_alertas
           ),
           resumen AS (
               SELECT
                   COUNT(*) FILTER (WHERE estado_cantidad = 'agotado') AS sin_stock_count,
                   COUNT(*) FILTER (WHERE estado_vencimiento = 'vencido') AS vencido_count,
                   COUNT(*) FILTER (WHERE estado_cantidad IN ('critico', 'reponer')) AS bajo_minimo_count,
                   COUNT(*) FILTER (WHERE estado_vencimiento IN ('riesgo_venc', 'por_vencer')) AS vencimiento_count
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
               -- Dentro de los buckets de vencimiento, lo que más vence va primero.
               CASE WHEN tipo_alerta IN ('riesgo_venc', 'por_vencer')
                    THEN COALESCE(pct_por_vencer, 0) ELSE 0 END DESC,
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
        par_area_filter,
    );

    let rows = sqlx::query_as::<_, AlertaRow>(&sql)
        .bind(per_page)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    let total = rows.first().map(|r| r.total_count).unwrap_or(0);
    let sin_stock_count = rows.first().map(|r| r.sin_stock_count).unwrap_or(0);
    let vencido_count = rows.first().map(|r| r.vencido_count).unwrap_or(0);
    let bajo_minimo_count = rows.first().map(|r| r.bajo_minimo_count).unwrap_or(0);
    let vencimiento_count = rows.first().map(|r| r.vencimiento_count).unwrap_or(0);

    Ok(AlertasResultado {
        rows,
        total,
        sin_stock_count,
        vencido_count,
        bajo_minimo_count,
        vencimiento_count,
    })
}

// === Lotes vencidos / por vencer ===

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LoteVencidoItem {
    pub lote_id: Uuid,
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub codigo_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub area_id: i32,
    pub area_nombre: String,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub cantidad: Decimal,
    pub unidad_base_nombre: String,
    pub unidad_base_nombre_plural: String,
}

pub async fn lotes_vencidos(
    pool: &PgPool,
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    dias_alerta: Option<i32>,
    q: Option<String>,
) -> Result<Vec<LoteVencidoItem>, AppError> {
    let dias = dias_alerta.unwrap_or(0);
    let q = q
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
    // El área es solo un filtro opcional (area_id); no hay recorte implícito por rol.

    if area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("s.area_id = ${}", param_idx));
    }
    if proveedor_id.is_some() {
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
    if let Some(v) = area_id {
        query = query.bind(v);
    }
    if let Some(v) = proveedor_id {
        query = query.bind(v);
    }

    query.fetch_all(pool).await.map_err(Into::into)
}

// === Balance check ===

pub struct BalanceCheck {
    pub discrepancias: Vec<serde_json::Value>,
    pub sano: bool,
}

/// Compara la tabla materializada `stock` contra la suma firmada de movimientos
/// por (lote, área). Un arreglo `discrepancias` vacío significa ledger sano.
pub async fn balance_check(pool: &PgPool) -> Result<BalanceCheck, AppError> {
    let rows = sqlx::query(
        "SELECT lote_id, area_id, stock_calculado, stock_materializado, discrepancia \
         FROM v_stock_balance_check ORDER BY discrepancia DESC",
    )
    .fetch_all(pool)
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
    Ok(BalanceCheck {
        discrepancias,
        sano,
    })
}

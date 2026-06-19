use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::{PaginatedResponse, PaginationParams};
use crate::errors::AppError;

#[derive(Debug, Deserialize)]
struct MovimientoQuery {
    area_id: Option<i32>,
    producto_id: Option<Uuid>,
    usuario_id: Option<Uuid>,
    tipo: Option<String>,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    grupo_movimiento: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TendenciaConsumoQuery {
    area_id: Option<i32>,
    producto_ids: Option<String>,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    granularidad: Option<String>,
    agrupar_por: Option<String>,
    incluir_descartes: Option<bool>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MovimientoListItem {
    id: Uuid,
    numero_documento: String,
    grupo_movimiento: Option<Uuid>,
    tipo: String,
    cantidad: Decimal,
    cantidad_resultante: Decimal,
    lote_numero: String,
    producto_nombre: String,
    area_nombre: String,
    usuario_nombre: String,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
    nota: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TendenciaConsumoRow {
    periodo_inicio: NaiveDate,
    periodo_label: String,
    area_id: Option<i32>,
    area_nombre: Option<String>,
    producto_id: Option<Uuid>,
    producto_nombre: Option<String>,
    unidad_base_nombre: Option<String>,
    unidad_base_nombre_plural: Option<String>,
    cantidad: Decimal,
    movimientos: i64,
    dias_con_consumo: i64,
}

#[derive(Debug, Serialize)]
struct TendenciaConsumoResumen {
    total_consumido: Decimal,
    total_movimientos: i64,
    periodos_con_consumo: i64,
    promedio_por_periodo: Decimal,
    promedio_por_movimiento: Decimal,
}

#[derive(Debug, Serialize)]
struct TendenciaConsumoResponse {
    granularidad: String,
    agrupar_por: String,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    resumen: TendenciaConsumoResumen,
    series: Vec<TendenciaConsumoRow>,
}

fn parse_producto_ids(raw: Option<String>) -> Result<Vec<Uuid>, AppError> {
    raw.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            Uuid::parse_str(v)
                .map_err(|_| AppError::Validation("producto_ids contiene un UUID inválido".into()))
        })
        .collect()
}

fn period_sql(granularidad: &str) -> Result<(&'static str, &'static str), AppError> {
    match granularidad {
        "dia" => Ok((
            "m.created_at::date",
            "to_char(m.created_at::date, 'YYYY-MM-DD')",
        )),
        "mes" => Ok((
            "date_trunc('month', m.created_at)::date",
            "to_char(date_trunc('month', m.created_at), 'YYYY-MM')",
        )),
        "trimestre" => Ok((
            "date_trunc('quarter', m.created_at)::date",
            "concat(extract(year from m.created_at)::int, '-T', extract(quarter from m.created_at)::int)",
        )),
        "semestre" => Ok((
            "make_date(extract(year from m.created_at)::int, CASE WHEN extract(month from m.created_at)::int <= 6 THEN 1 ELSE 7 END, 1)",
            "concat(extract(year from m.created_at)::int, '-S', CASE WHEN extract(month from m.created_at)::int <= 6 THEN 1 ELSE 2 END)",
        )),
        "anio" => Ok((
            "date_trunc('year', m.created_at)::date",
            "to_char(date_trunc('year', m.created_at), 'YYYY')",
        )),
        _ => Err(AppError::Validation(
            "granularidad debe ser dia, mes, trimestre, semestre o anio".into(),
        )),
    }
}

fn dimension_sql(agrupar_por: &str) -> Result<(&'static str, &'static str), AppError> {
    match agrupar_por {
        "global" => Ok((
            "NULL::int AS area_id, NULL::text AS area_nombre, NULL::uuid AS producto_id, NULL::text AS producto_nombre, NULL::text AS unidad_base_nombre, NULL::text AS unidad_base_nombre_plural",
            "",
        )),
        "area" => Ok((
            "a.id AS area_id, a.nombre AS area_nombre, NULL::uuid AS producto_id, NULL::text AS producto_nombre, NULL::text AS unidad_base_nombre, NULL::text AS unidad_base_nombre_plural",
            ", a.id, a.nombre",
        )),
        "producto" => Ok((
            "NULL::int AS area_id, NULL::text AS area_nombre, p.id AS producto_id, p.nombre AS producto_nombre, um.nombre AS unidad_base_nombre, um.nombre_plural AS unidad_base_nombre_plural",
            ", p.id, p.nombre, um.nombre, um.nombre_plural",
        )),
        _ => Err(AppError::Validation(
            "agrupar_por debe ser global, area o producto".into(),
        )),
    }
}

fn restrict_area_filter(
    _claims: &Claims,
    _requested_area_id: Option<i32>,
    _table_alias: &str,
    _param_idx: &mut u32,
) -> Result<Option<(String, Vec<i32>)>, AppError> {
    // El área dejó de ser barrera de permiso: ningún rol queda restringido por área.
    // El filtrado explícito por área (params.area_id) se aplica aparte en cada handler.
    Ok(None)
}

/// GET /api/v1/movimientos/tendencias-consumo
async fn tendencias_consumo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<TendenciaConsumoQuery>,
) -> Result<Json<TendenciaConsumoResponse>, AppError> {
    let granularidad = params.granularidad.unwrap_or_else(|| "mes".to_string());
    let agrupar_por = params.agrupar_por.unwrap_or_else(|| "global".to_string());
    let producto_ids = parse_producto_ids(params.producto_ids)?;
    let (period_start_sql, period_label_sql) = period_sql(&granularidad)?;
    let (dimension_select_sql, dimension_group_sql) = dimension_sql(&agrupar_por)?;

    let mut movement_types = vec!["CONSUMO"];
    if params.incluir_descartes.unwrap_or(false) {
        movement_types.push("DESCARTE_VENCIDO");
        movement_types.push("DESCARTE_DAÑADO");
    }

    let mut conditions: Vec<String> = vec!["m.tipo = ANY($1)".to_string()];
    let mut param_idx = 1u32;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.area_id = ${}", param_idx));
    }
    let area_scope = restrict_area_filter(&claims, params.area_id, "m", &mut param_idx)?;
    if let Some((condition, _)) = &area_scope {
        conditions.push(condition.clone());
    }
    if !producto_ids.is_empty() {
        param_idx += 1;
        conditions.push(format!("p.id = ANY(${})", param_idx));
    }
    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "m.created_at < ${}::date + INTERVAL '1 day'",
            param_idx
        ));
    }

    let where_clause = conditions.join(" AND ");
    let sql = format!(
        r#"SELECT
                  {period_start_sql} AS periodo_inicio,
                  {period_label_sql} AS periodo_label,
                  {dimension_select_sql},
                  COALESCE(SUM(m.cantidad), 0) AS cantidad,
                  COUNT(*)::bigint AS movimientos,
                  COUNT(DISTINCT m.created_at::date)::bigint AS dias_con_consumo
           FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = m.area_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE {where_clause}
           GROUP BY periodo_inicio, periodo_label{dimension_group_sql}
           ORDER BY periodo_inicio ASC, cantidad DESC"#,
    );

    let mut query = sqlx::query_as::<_, TendenciaConsumoRow>(&sql).bind(movement_types);
    if let Some(v) = params.area_id {
        query = query.bind(v);
    }
    if let Some((_, allowed_area_ids)) = area_scope {
        if !allowed_area_ids.is_empty() {
            query = query.bind(allowed_area_ids);
        }
    }
    if !producto_ids.is_empty() {
        query = query.bind(producto_ids);
    }
    if let Some(v) = params.desde {
        query = query.bind(v);
    }
    if let Some(v) = params.hasta {
        query = query.bind(v);
    }

    let series = query.fetch_all(&state.pool).await?;
    let total_consumido = series
        .iter()
        .fold(Decimal::ZERO, |acc, row| acc + row.cantidad);
    let total_movimientos = series.iter().map(|row| row.movimientos).sum::<i64>();
    let periodos_con_consumo = {
        let mut periodos: Vec<NaiveDate> = series.iter().map(|row| row.periodo_inicio).collect();
        periodos.sort();
        periodos.dedup();
        periodos.len() as i64
    };
    let promedio_por_periodo = if periodos_con_consumo > 0 {
        total_consumido / Decimal::from(periodos_con_consumo)
    } else {
        Decimal::ZERO
    };
    let promedio_por_movimiento = if total_movimientos > 0 {
        total_consumido / Decimal::from(total_movimientos)
    } else {
        Decimal::ZERO
    };

    Ok(Json(TendenciaConsumoResponse {
        granularidad,
        agrupar_por,
        desde: params.desde,
        hasta: params.hasta,
        resumen: TendenciaConsumoResumen {
            total_consumido,
            total_movimientos,
            periodos_con_consumo,
            promedio_por_periodo,
            promedio_por_movimiento,
        },
        series,
    }))
}

/// GET /api/v1/movimientos
async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<MovimientoQuery>,
) -> Result<Json<PaginatedResponse<MovimientoListItem>>, AppError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions: Vec<String> = vec!["TRUE".to_string()];
    let mut param_idx = 0u32;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.area_id = ${}", param_idx));
    }
    let area_scope = restrict_area_filter(&claims, params.area_id, "m", &mut param_idx)?;
    if let Some((condition, _)) = &area_scope {
        conditions.push(condition.clone());
    }
    if params.producto_id.is_some() {
        param_idx += 1;
        conditions.push(format!("l.producto_id = ${}", param_idx));
    }
    if params.usuario_id.is_some() {
        param_idx += 1;
        conditions.push(format!("m.usuario_id = ${}", param_idx));
    }
    if params.tipo.is_some() {
        param_idx += 1;
        conditions.push(format!("m.tipo = ANY(${})", param_idx));
    }
    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("m.created_at >= ${}::date", param_idx));
    }
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "m.created_at < ${}::date + INTERVAL '1 day'",
            param_idx
        ));
    }
    if params.grupo_movimiento.is_some() {
        param_idx += 1;
        conditions.push(format!("m.grupo_movimiento = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let count_sql = format!(
        r#"SELECT COUNT(*) FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           WHERE {}"#,
        where_clause
    );

    let data_sql = format!(
        r#"SELECT m.id, m.numero_documento, m.grupo_movimiento, m.tipo,
                  m.cantidad, m.cantidad_resultante,
                  l.numero_lote as lote_numero, p.nombre as producto_nombre,
                  a.nombre as area_nombre, u.nombre as usuario_nombre,
                  um.nombre as unidad_base_nombre, um.nombre_plural as unidad_base_nombre_plural,
                  m.nota, m.created_at
           FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = m.area_id
           JOIN usuarios u ON u.id = m.usuario_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE {}
           ORDER BY m.created_at DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
    let mut data_query = sqlx::query_as::<_, MovimientoListItem>(&data_sql);

    // Bind parameters in order
    if let Some(v) = params.area_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some((_, allowed_area_ids)) = area_scope {
        if !allowed_area_ids.is_empty() {
            count_query = count_query.bind(allowed_area_ids.clone());
            data_query = data_query.bind(allowed_area_ids);
        }
    }
    if let Some(v) = params.producto_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.usuario_id {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(ref t) = params.tipo {
        let mapped = match t.as_str() {
            "entrada" => vec!["INGRESO", "CARGA_INICIAL"],
            "salida" => vec!["CONSUMO"],
            "descarte" => vec!["DESCARTE_VENCIDO", "DESCARTE_DAÑADO"],
            "ajuste" => vec!["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO"],
            "ajuste_pos" => vec!["AJUSTE_POSITIVO"],
            "ajuste_neg" => vec!["AJUSTE_NEGATIVO"],
            _ => vec![t.as_str()],
        };
        count_query = count_query.bind(mapped.clone());
        data_query = data_query.bind(mapped);
    }
    if let Some(v) = params.desde {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.hasta {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }
    if let Some(v) = params.grupo_movimiento {
        count_query = count_query.bind(v);
        data_query = data_query.bind(v);
    }

    data_query = data_query.bind(limit).bind(offset);

    let total = count_query.fetch_one(&state.pool).await?;
    let mut data = data_query.fetch_all(&state.pool).await?;

    // Normalizar tipos para el frontend
    for item in &mut data {
        item.tipo = match item.tipo.as_str() {
            "INGRESO" | "CARGA_INICIAL" => "entrada".to_string(),
            "CONSUMO" => "salida".to_string(),
            "DESCARTE_VENCIDO" | "DESCARTE_DAÑADO" => "descarte".to_string(),
            "AJUSTE_POSITIVO" => "ajuste_pos".to_string(),
            "AJUSTE_NEGATIVO" => "ajuste_neg".to_string(),
            other => other.to_lowercase(),
        };
    }

    Ok(Json(PaginatedResponse {
        data,
        total,
        page: pagination.page(),
        per_page: limit,
    }))
}

/// GET /api/v1/movimientos/:id
async fn obtener(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // El área no restringe la consulta de un movimiento: cualquier rol lo ve por su id.
    let sql = r#"SELECT m.id, m.numero_documento, m.grupo_movimiento, m.tipo,
                  m.cantidad, m.cantidad_resultante,
                  l.numero_lote as lote_numero, p.nombre as producto_nombre,
                  a.nombre as area_nombre, u.nombre as usuario_nombre,
                  um.nombre as unidad_base_nombre, um.nombre_plural as unidad_base_nombre_plural,
                  m.nota, m.created_at
           FROM movimientos m
           JOIN lotes l ON l.id = m.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN areas a ON a.id = m.area_id
           JOIN usuarios u ON u.id = m.usuario_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE m.id = $1"#;
    let mut mov = sqlx::query_as::<_, MovimientoListItem>(sql)
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Movimiento no encontrado".into()))?;

    // Normalizar tipo
    mov.tipo = match mov.tipo.as_str() {
        "INGRESO" | "CARGA_INICIAL" => "entrada".to_string(),
        "CONSUMO" => "salida".to_string(),
        "DESCARTE_VENCIDO" | "DESCARTE_DAÑADO" => "descarte".to_string(),
        "AJUSTE_POSITIVO" => "ajuste_pos".to_string(),
        "AJUSTE_NEGATIVO" => "ajuste_neg".to_string(),
        other => other.to_lowercase(),
    };

    Ok(Json(serde_json::json!(mov)))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/tendencias-consumo", get(tendencias_consumo))
        .route("/", get(listar))
        .route("/{id}", get(obtener))
}

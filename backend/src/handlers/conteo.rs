use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, patch, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;
use crate::services::idempotency;

// ==============================
// DTOs
// ==============================

#[derive(Debug, Deserialize)]
struct ConteoQuery {
    area_id: Option<i32>,
    estado: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PaginatedSesiones {
    data: Vec<SesionListItem>,
    total: i64,
    page: i64,
    per_page: i64,
    total_pages: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SesionListItem {
    id: Uuid,
    area_id: i32,
    area_nombre: String,
    estado: String,
    usuario_creador_nombre: String,
    created_at: DateTime<Utc>,
    confirmed_at: Option<DateTime<Utc>>,
    total_items: i64,
    items_contados: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ConteoItemRow {
    id: Uuid,
    lote_id: Uuid,
    numero_lote: String,
    fecha_vencimiento: chrono::NaiveDate,
    producto_id: Uuid,
    producto_nombre: String,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
    stock_sistema: Decimal,
    cantidad_contada: Option<Decimal>,
    estado_item: String,
    version: i32,
}

#[derive(Debug, Deserialize)]
struct CreateSesionInput {
    area_id: i32,
}

#[derive(Debug, Deserialize)]
struct UpdateItemInput {
    item_id: Uuid,
    cantidad_contada: Option<Decimal>,
    estado_item: String,
    version: i32,
}

#[derive(Debug, Deserialize)]
struct UpdateItemsInput {
    items: Vec<UpdateItemInput>,
}

#[derive(Debug, Deserialize)]
struct ConfirmarInput {
    nota: Option<String>,
}

// ==============================
// Handlers
// ==============================

/// GET /api/v1/conteo
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ConteoQuery>,
) -> Result<Json<PaginatedSesiones>, AppError> {
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let mut conditions: Vec<String> = Vec::new();
    let mut param_idx = 0u32;

    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!("sc.area_id = ${}", param_idx));
    }
    if params.estado.is_some() {
        param_idx += 1;
        conditions.push(format!("sc.estado = ${}", param_idx));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM sesiones_conteo sc {}",
        where_clause
    );

    let data_sql = format!(
        r#"SELECT sc.id, sc.area_id, a.nombre as area_nombre, sc.estado,
                  u.nombre as usuario_creador_nombre,
                  sc.created_at, sc.confirmed_at,
                  COUNT(ci.id) as total_items,
                  COUNT(ci.id) FILTER (WHERE ci.estado_item = 'contado') as items_contados
           FROM sesiones_conteo sc
           JOIN areas a ON a.id = sc.area_id
           JOIN usuarios u ON u.id = sc.usuario_creador_id
           LEFT JOIN conteo_items ci ON ci.sesion_id = sc.id
           {}
           GROUP BY sc.id, a.nombre, u.nombre
           ORDER BY sc.created_at DESC
           LIMIT {} OFFSET {}"#,
        where_clause, per_page, offset
    );

    macro_rules! bind_params {
        ($q:expr) => {{
            let mut q = $q;
            if let Some(v) = params.area_id { q = q.bind(v); }
            if let Some(ref v) = params.estado { q = q.bind(v.clone()); }
            q
        }};
    }

    let total: i64 = bind_params!(sqlx::query_scalar::<_, i64>(&count_sql))
        .fetch_one(&state.pool)
        .await?;

    let data = bind_params!(sqlx::query_as::<_, SesionListItem>(&data_sql))
        .fetch_all(&state.pool)
        .await?;

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    Ok(Json(PaginatedSesiones { data, total, page, per_page, total_pages }))
}

/// GET /api/v1/conteo/:id
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let sesion = sqlx::query_as::<_, SesionListItem>(
        r#"SELECT sc.id, sc.area_id, a.nombre as area_nombre, sc.estado,
                  u.nombre as usuario_creador_nombre,
                  sc.created_at, sc.confirmed_at,
                  COUNT(ci.id) as total_items,
                  COUNT(ci.id) FILTER (WHERE ci.estado_item = 'contado') as items_contados
           FROM sesiones_conteo sc
           JOIN areas a ON a.id = sc.area_id
           JOIN usuarios u ON u.id = sc.usuario_creador_id
           LEFT JOIN conteo_items ci ON ci.sesion_id = sc.id
           WHERE sc.id = $1
           GROUP BY sc.id, a.nombre, u.nombre"#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Sesión de conteo no encontrada".into()))?;

    let nota: Option<String> =
        sqlx::query_scalar("SELECT nota FROM sesiones_conteo WHERE id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    let items = sqlx::query_as::<_, ConteoItemRow>(
        r#"SELECT ci.id, ci.lote_id, l.numero_lote, l.fecha_vencimiento,
                  p.id as producto_id, p.nombre as producto_nombre,
                  ub.nombre as unidad_base_nombre,
                  ub.nombre_plural as unidad_base_nombre_plural,
                  ci.stock_sistema, ci.cantidad_contada, ci.estado_item, ci.version
           FROM conteo_items ci
           JOIN lotes l ON l.id = ci.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
           WHERE ci.sesion_id = $1
           ORDER BY p.nombre ASC, l.fecha_vencimiento ASC"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "sesion": sesion,
        "nota": nota,
        "items": items,
    })))
}

/// POST /api/v1/conteo
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateSesionInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let area_existe: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM areas WHERE id = $1 AND activa = true)")
            .bind(req.area_id)
            .fetch_one(&state.pool)
            .await?;

    if !area_existe {
        return Err(AppError::NotFound("Área no encontrada o inactiva".into()));
    }

    let mut tx = state.pool.begin().await?;

    let sesion_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO sesiones_conteo (area_id, usuario_creador_id)
           VALUES ($1, $2) RETURNING id"#,
    )
    .bind(req.area_id)
    .bind(claims.sub)
    .fetch_one(&mut *tx)
    .await?;

    #[derive(sqlx::FromRow)]
    struct StockSnapshot {
        lote_id: Uuid,
        cantidad: Decimal,
    }

    let lotes = sqlx::query_as::<_, StockSnapshot>(
        r#"SELECT s.lote_id, s.cantidad
           FROM stock s
           JOIN lotes l ON l.id = s.lote_id
           WHERE s.area_id = $1 AND s.cantidad > 0
           ORDER BY l.fecha_vencimiento ASC"#,
    )
    .bind(req.area_id)
    .fetch_all(&mut *tx)
    .await?;

    let total_items = lotes.len() as i64;

    for lote in &lotes {
        sqlx::query(
            r#"INSERT INTO conteo_items (sesion_id, lote_id, stock_sistema)
               VALUES ($1, $2, $3)"#,
        )
        .bind(sesion_id)
        .bind(lote.lote_id)
        .bind(lote.cantidad)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": sesion_id,
            "total_items": total_items,
            "estado": "borrador",
        })),
    ))
}

/// PATCH /api/v1/conteo/:id/items
async fn actualizar_items(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateItemsInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let mut tx = state.pool.begin().await?;

    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM sesiones_conteo WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

    let estado = estado.ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

    if estado == "confirmado" || estado == "cancelado" {
        tx.rollback().await?;
        return Err(AppError::BusinessLogic(
            "No se puede modificar una sesión confirmada o cancelada".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    let mut updated = 0i32;
    let mut conflictos: Vec<String> = Vec::new();

    for item in &req.items {
        if !["contado", "no_contado", "pendiente"].contains(&item.estado_item.as_str()) {
            return Err(AppError::Validation(
                format!("estado_item inválido: {}", item.estado_item),
            ));
        }

        if item.estado_item == "contado" {
            match item.cantidad_contada {
                None => {
                    return Err(AppError::Validation(
                        "cantidad_contada requerida cuando estado_item = 'contado'".into(),
                    ));
                }
                Some(c) if c < Decimal::ZERO => {
                    return Err(AppError::Validation(
                        "cantidad_contada no puede ser negativa".into(),
                    ));
                }
                _ => {}
            }
        }

        let rows = sqlx::query(
            r#"UPDATE conteo_items
               SET cantidad_contada = $1,
                   estado_item = $2,
                   version = version + 1,
                   updated_at = NOW()
               WHERE id = $3
                 AND sesion_id = $4
                 AND version = $5"#,
        )
        .bind(item.cantidad_contada)
        .bind(&item.estado_item)
        .bind(item.item_id)
        .bind(id)
        .bind(item.version)
        .execute(&mut *tx)
        .await?;

        if rows.rows_affected() == 0 {
            conflictos.push(item.item_id.to_string());
        } else {
            updated += 1;
        }
    }

    if !conflictos.is_empty() {
        tx.rollback().await?;
        return Err(AppError::BusinessLogic(
            format!("Conflicto de versión en {} ítem(s). Recarga la sesión.", conflictos.len()),
            "VERSION_CONFLICT".into(),
        ));
    }

    if estado == "borrador" && updated > 0 {
        sqlx::query(
            "UPDATE sesiones_conteo SET estado = 'en_progreso', updated_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE sesiones_conteo SET updated_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "updated": updated,
        "conflictos": conflictos.len(),
    })))
}

/// POST /api/v1/conteo/:id/confirmar
async fn confirmar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<ConfirmarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /conteo/confirmar", claims.sub)
            .await?
    {
        return Ok(Json(body));
    }

    let mut tx = state.pool.begin().await?;

    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM sesiones_conteo WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

    let estado = estado.ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

    if estado == "confirmado" {
        tx.rollback().await?;
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
        return Err(AppError::BusinessLogic(
            "La sesión ya está confirmada".into(),
            "YA_CONFIRMADO".into(),
        ));
    }

    if estado == "cancelado" {
        tx.rollback().await?;
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
        return Err(AppError::BusinessLogic(
            "No se puede confirmar una sesión cancelada".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    #[derive(sqlx::FromRow)]
    struct ItemAjuste {
        lote_id: Uuid,
        area_id: i32,
        stock_sistema: Decimal,
        cantidad_contada: Decimal,
    }

    let items = sqlx::query_as::<_, ItemAjuste>(
        r#"SELECT ci.lote_id, sc.area_id, ci.stock_sistema, ci.cantidad_contada
           FROM conteo_items ci
           JOIN sesiones_conteo sc ON sc.id = ci.sesion_id
           WHERE ci.sesion_id = $1
             AND ci.estado_item = 'contado'
             AND ci.cantidad_contada IS NOT NULL
             AND ci.cantidad_contada <> ci.stock_sistema"#,
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    let grupo = Uuid::new_v4();
    let mut ajustes_generados = 0i32;

    for item in &items {
        let diferencia = item.cantidad_contada - item.stock_sistema;
        let (tipo, cantidad_abs) = if diferencia > Decimal::ZERO {
            ("AJUSTE_POSITIVO", diferencia)
        } else {
            ("AJUSTE_NEGATIVO", diferencia.abs())
        };

        // Set stock to the counted value (physical count = ground truth)
        sqlx::query(
            r#"INSERT INTO stock (lote_id, area_id, cantidad)
               VALUES ($1, $2, $3)
               ON CONFLICT (lote_id, area_id)
               DO UPDATE SET cantidad = $3, updated_at = NOW()"#,
        )
        .bind(item.lote_id)
        .bind(item.area_id)
        .bind(item.cantidad_contada)
        .execute(&mut *tx)
        .await?;

        // Record the movement using cantidad_abs from snapshot difference
        sqlx::query(
            r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota)
               SELECT $1, $2, $3, $4, $5, s.cantidad, $6, 'conteo', $7
               FROM stock s WHERE s.lote_id = $2 AND s.area_id = $3"#,
        )
        .bind(grupo)
        .bind(item.lote_id)
        .bind(item.area_id)
        .bind(tipo)
        .bind(cantidad_abs)
        .bind(claims.sub)
        .bind(req.nota.as_deref())
        .execute(&mut *tx)
        .await?;

        ajustes_generados += 1;
    }

    sqlx::query(
        r#"UPDATE sesiones_conteo
           SET estado = 'confirmado',
               usuario_confirmador_id = $1,
               nota = COALESCE($2, nota),
               confirmed_at = NOW(),
               updated_at = NOW()
           WHERE id = $3"#,
    )
    .bind(claims.sub)
    .bind(req.nota.as_deref())
    .bind(id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let response = serde_json::json!({
        "id": id,
        "estado": "confirmado",
        "ajustes_generados": ajustes_generados,
        "grupo_movimiento": grupo,
    });

    idempotency::save_response(&state.pool, &idem_key, 200, &response).await?;

    Ok(Json(response))
}

/// DELETE /api/v1/conteo/:id
async fn cancelar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    #[derive(sqlx::FromRow)]
    struct SesionInfo {
        estado: String,
        usuario_creador_id: Uuid,
    }

    let sesion = sqlx::query_as::<_, SesionInfo>(
        "SELECT estado, usuario_creador_id FROM sesiones_conteo WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

    if sesion.estado == "confirmado" {
        return Err(AppError::BusinessLogic(
            "No se puede cancelar una sesión confirmada".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    let es_admin = claims.rol == "admin";
    let es_creador = claims.sub == sesion.usuario_creador_id;
    if !es_admin && !es_creador {
        return Err(AppError::Forbidden("No tiene permiso para cancelar esta sesión".into()));
    }

    sqlx::query(
        "UPDATE sesiones_conteo SET estado = 'cancelado', updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/v1/conteo/pendientes
/// Retorna las áreas que tienen frecuencia de conteo configurada y están vencidas o próximas
async fn pendientes(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    #[derive(Debug, serde::Serialize, sqlx::FromRow)]
    struct AreaPendiente {
        area_id: i32,
        area_nombre: String,
        frecuencia_dias: i32,
        ultimo_conteo_confirmado: Option<chrono::DateTime<Utc>>,
        dias_desde_ultimo: Option<i64>,
    }

    let areas = sqlx::query_as::<_, AreaPendiente>(
        r#"SELECT
             a.id as area_id,
             a.nombre as area_nombre,
             a.conteo_frecuencia_dias as frecuencia_dias,
             MAX(sc.confirmed_at) as ultimo_conteo_confirmado,
             EXTRACT(EPOCH FROM (NOW() - MAX(sc.confirmed_at))) / 86400 AS dias_desde_ultimo
           FROM areas a
           LEFT JOIN sesiones_conteo sc ON sc.area_id = a.id AND sc.estado = 'confirmado'
           WHERE a.activa = true AND a.conteo_frecuencia_dias > 0
           GROUP BY a.id, a.nombre, a.conteo_frecuencia_dias
           HAVING MAX(sc.confirmed_at) IS NULL
              OR EXTRACT(EPOCH FROM (NOW() - MAX(sc.confirmed_at))) / 86400 >= a.conteo_frecuencia_dias * 0.85
           ORDER BY dias_desde_ultimo DESC NULLS FIRST, a.nombre ASC"#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(areas)))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/pendientes", get(pendientes))
        .route("/{id}", get(obtener).delete(cancelar))
        .route("/{id}/items", patch(actualizar_items))
        .route("/{id}/confirmar", post(confirmar))
}

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
    fecha_vencimiento: Option<chrono::NaiveDate>,
    producto_id: Uuid,
    producto_nombre: String,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
    stock_sistema: Decimal,
    cantidad_contada: Option<Decimal>,
    estado_item: String,
    version: i32,
    imagen_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateSesionInput {
    area_id: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct UpdateItemInput {
    pub item_id: Uuid,
    pub cantidad_contada: Option<Decimal>,
    pub estado_item: String,
    pub version: i32,
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

    let count_sql = format!("SELECT COUNT(*) FROM sesiones_conteo sc {}", where_clause);

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
            if let Some(v) = params.area_id {
                q = q.bind(v);
            }
            if let Some(ref v) = params.estado {
                q = q.bind(v.clone());
            }
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

    Ok(Json(PaginatedSesiones {
        data,
        total,
        page,
        per_page,
        total_pages,
    }))
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

    let nota: Option<String> = sqlx::query_scalar("SELECT nota FROM sesiones_conteo WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    let items = sqlx::query_as::<_, ConteoItemRow>(
        r#"SELECT ci.id, ci.lote_id, l.numero_lote, l.fecha_vencimiento,
                  p.id as producto_id, p.nombre as producto_nombre,
                  ub.nombre as unidad_base_nombre,
                  ub.nombre_plural as unidad_base_nombre_plural,
                  ci.stock_sistema, ci.cantidad_contada, ci.estado_item, ci.version,
                  p.imagen_path AS imagen_url
           FROM conteo_items ci
           JOIN lotes l ON l.id = ci.lote_id
           JOIN productos p ON p.id = l.producto_id
           JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
           WHERE ci.sesion_id = $1
           ORDER BY p.nombre ASC, l.fecha_vencimiento ASC NULLS LAST"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    // Obtener presentaciones para todos los productos en la sesión
    let producto_ids: Vec<Uuid> = items.iter().map(|i| i.producto_id).collect();
    let presentaciones = sqlx::query_as::<_, crate::models::presentacion::Presentacion>(
        "SELECT * FROM presentaciones WHERE producto_id = ANY($1) AND activa = true",
    )
    .bind(&producto_ids)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "sesion": sesion,
        "nota": nota,
        "items": items,
        "presentaciones": presentaciones,
    })))
}

use crate::services::conteo_service::ConteoService;

// ... (listar y obtener omitidos para brevedad, permanecen igual)

/// POST /api/v1/conteo
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateSesionInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let sesion = ConteoService::iniciar_sesion(&state.pool, req.area_id, claims.sub).await?;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": sesion.id,
            "total_items": sesion.total_items,
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

    let (updated, conflictos) = ConteoService::actualizar_items(&state.pool, id, req.items).await?;

    Ok(Json(serde_json::json!({
        "updated": updated,
        "conflictos": conflictos,
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
        idempotency::try_claim(&state.pool, &idem_key, "POST /conteo/confirmar", claims.sub).await?
    {
        return Ok(Json(body));
    }

    // El service maneja la transacción y lógica de ajuste
    match ConteoService::confirmar_sesion(&state.pool, id, claims.sub, req.nota).await {
        Ok(response) => {
            idempotency::save_response(&state.pool, &idem_key, 200, &response).await?;
            Ok(Json(response))
        }
        Err(e) => {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            Err(e)
        }
    }
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
        return Err(AppError::Forbidden(
            "No tiene permiso para cancelar esta sesión".into(),
        ));
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
async fn pendientes(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
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

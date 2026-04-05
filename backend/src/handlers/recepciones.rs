use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::recepcion::{CreateRecepcion, RecepcionQuery, SubirFotoInput};
use crate::errors::AppError;
use crate::services::{recepcion_service, idempotency, storage};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecepcionConProveedor {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub guia_despacho: Option<String>,
    pub estado: String,
    pub fecha_recepcion: DateTime<Utc>,
    pub usuario_id: Uuid,
    pub nota: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<RecepcionQuery>,
) -> Result<Json<crate::dto::recepcion::PaginatedRecepciones>, AppError> {
    let res = recepcion_service::listar(&state.pool, params, claims.sub, &claims.rol).await?;
    Ok(Json(res))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let recepcion = sqlx::query_as::<_, RecepcionConProveedor>(
        "SELECT r.*, p.nombre as proveedor_nombre FROM recepciones r JOIN proveedores p ON p.id = r.proveedor_id WHERE r.id = $1"
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let detalles = recepcion_service::obtener_detalles(&state.pool, id).await?;

    Ok(Json(serde_json::json!({
        "recepcion": recepcion,
        "detalle": detalles
    })))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<CreateRecepcion>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) =
        idempotency::try_claim(&state.pool, &idem_key, "POST /recepciones", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let id = match recepcion_service::crear_recepcion(&state.pool, req, claims.sub).await {
        Ok(id) => id,
        Err(e) => {
            idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
            return Err(e);
        }
    };

    let response = serde_json::json!({ "id": id });
    idempotency::save_response(&state.pool, &idem_key, 201, &response).await?;

    Ok((StatusCode::CREATED, Json(response)))
}

async fn subir_foto(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<SubirFotoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM recepciones WHERE id = $1)")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if !exists { return Err(AppError::NotFound("Recepción no encontrada".into())); }

    let path = storage::save_base64_image(&req.data_url, "recepciones", &id.to_string()).await?;

    sqlx::query("UPDATE recepciones SET guia_despacho_archivo = $1 WHERE id = $2")
        .bind(&path)
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "path": path })))
}

#[derive(Debug, Deserialize)]
struct ReconciliarInput {
    item_ids: Vec<Uuid>,
}

async fn reconciliar_en_camino(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(recepcion_id): Path<Uuid>,
    Json(body): Json<ReconciliarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM recepciones WHERE id = $1)"
    )
    .bind(recepcion_id)
    .fetch_one(&state.pool)
    .await?;
    if !exists { return Err(AppError::NotFound("Recepción no encontrada".into())); }

    for item_id in &body.item_ids {
        sqlx::query(
            "UPDATE solicitud_items SET estado = 'recibido', recepcion_id = $1 WHERE id = $2"
        )
        .bind(recepcion_id)
        .bind(item_id)
        .execute(&state.pool)
        .await?;
    }

    Ok(Json(serde_json::json!({ "reconciliados": body.item_ids.len() })))
}

async fn crear_scanner_session(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let token: (Uuid, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "INSERT INTO scanner_sessions (expires_at) VALUES (NOW() + INTERVAL '10 minutes')
         RETURNING token, expires_at"
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "token": token.0,
        "expires_at": token.1,
    })))
}

#[derive(Debug, Deserialize)]
struct ScanInput {
    codigo: String,
}

async fn scan_codigo(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
    Json(body): Json<ScanInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let valid = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM scanner_sessions WHERE token = $1 AND expires_at > NOW())"
    )
    .bind(token)
    .fetch_one(&state.pool)
    .await?;
    if !valid { return Err(AppError::Forbidden("Sesión expirada o inválida".into())); }

    let producto: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, nombre FROM productos WHERE (codigo_interno = $1 OR codigo_proveedor = $1) AND activo = true LIMIT 1"
    )
    .bind(&body.codigo)
    .fetch_optional(&state.pool)
    .await?;

    let (producto_id, producto_nombre) = match producto {
        Some(p) => (Some(p.0), Some(p.1)),
        None => (None, None),
    };

    sqlx::query(
        "INSERT INTO scanner_items (session_token, codigo, producto_id, producto_nombre) VALUES ($1, $2, $3, $4)"
    )
    .bind(token)
    .bind(&body.codigo)
    .bind(producto_id)
    .bind(&producto_nombre)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "producto_id": producto_id,
        "producto_nombre": producto_nombre,
    })))
}

async fn get_scanner_items(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items: Vec<(uuid::Uuid, String, Option<uuid::Uuid>, Option<String>)> = sqlx::query_as(
        "UPDATE scanner_items SET fetched = TRUE
         WHERE session_token = $1 AND fetched = FALSE
         RETURNING id, codigo, producto_id, producto_nombre"
    )
    .bind(token)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "items": items.iter().map(|(id, codigo, pid, pnombre)| serde_json::json!({
            "id": id,
            "codigo": codigo,
            "producto_id": pid,
            "producto_nombre": pnombre,
        })).collect::<Vec<_>>()
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener))
        .route("/{id}/foto", post(subir_foto))
        .route("/scanner-session", post(crear_scanner_session))
        .route("/scanner-session/{token}/scan", post(scan_codigo))
        .route("/scanner-session/{token}/items", get(get_scanner_items))
        .route("/{id}/reconciliar", post(reconciliar_en_camino))
}

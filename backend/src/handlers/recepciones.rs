use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::domain::EstadoRecepcion;
use crate::dto::recepcion::{CreateRecepcion, RecepcionQuery, SubirFotoInput};
use crate::errors::AppError;
use crate::services::{idempotency, recepcion_service, storage};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecepcionConProveedor {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub proveedor_icono: Option<String>,
    pub guia_despacho: Option<String>,
    pub estado: EstadoRecepcion,
    pub fecha_recepcion: DateTime<Utc>,
    pub usuario_id: Uuid,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub guia_despacho_archivo: Option<String>,
    pub foto_actualizada_at: Option<DateTime<Utc>>,
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
        "SELECT 
            r.id, 
            r.numero_documento, 
            r.proveedor_id, 
            p.nombre as proveedor_nombre, 
            p.icono as proveedor_icono,
            r.guia_despacho, 
            r.estado::text AS estado, 
            r.fecha_recepcion, 
            r.usuario_id, 
            u.nombre as usuario_nombre,
            r.nota, 
            r.solicitud_id, 
            r.created_at,
            r.guia_despacho_archivo,
            r.foto_actualizada_at 
         FROM recepciones r 
         JOIN proveedores p ON p.id = r.proveedor_id 
         JOIN usuarios u ON u.id = r.usuario_id
         WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let detalles = recepcion_service::obtener_detalles(&state.pool, id).await?;
    let reconciliacion = recepcion_service::obtener_reconciliacion(&state.pool, id).await?;

    Ok(Json(serde_json::json!({
        "recepcion": recepcion,
        "detalle": detalles,
        "reconciliacion": reconciliacion
    })))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<CreateRecepcion>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let estado = req.estado.clone().unwrap_or_else(|| "completa".to_string());
    let idem_key = if estado == "borrador" && !headers.contains_key("X-Idempotency-Key") {
        None
    } else {
        Some(idempotency::extract_idempotency_key(&headers)?)
    };

    if let Some(key) = &idem_key
        && let Some((_status, body)) =
            idempotency::try_claim(&state.pool, key, "POST /recepciones", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let (id, lotes) = match recepcion_service::crear_recepcion(&state.pool, req, claims.sub).await {
        Ok(result) => result,
        Err(e) => {
            if let Some(key) = &idem_key {
                idempotency::cleanup_on_error(&state.pool, key).await?;
            }
            return Err(e);
        }
    };

    let response = serde_json::json!({ "id": id, "estado": estado, "lotes": lotes });
    if let Some(key) = &idem_key {
        idempotency::save_response(&state.pool, key, 201, &response).await?;
    }

    Ok((StatusCode::CREATED, Json(response)))
}

async fn subir_foto(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<SubirFotoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM recepciones WHERE id = $1)")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(AppError::NotFound("Recepción no encontrada".into()));
    }

    let path = storage::save_base64_image(&req.data_url, "recepciones", &id.to_string()).await?;

    sqlx::query("UPDATE recepciones SET guia_despacho_archivo = $1, foto_actualizada_at = NOW() WHERE id = $2")
        .bind(&path)
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "path": path })))
}

async fn crear_scanner_session(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let token: (Uuid, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "INSERT INTO scanner_sessions (expires_at) VALUES (NOW() + INTERVAL '10 minutes')
         RETURNING token, expires_at",
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
        "SELECT EXISTS(SELECT 1 FROM scanner_sessions WHERE token = $1 AND expires_at > NOW())",
    )
    .bind(token)
    .fetch_one(&state.pool)
    .await?;
    if !valid {
        return Err(AppError::Forbidden("Sesión expirada o inválida".into()));
    }

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
         RETURNING id, codigo, producto_id, producto_nombre",
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

async fn confirmar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;
    let id = recepcion_service::confirmar_borrador(&state.pool, id, claims.sub).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn eliminar_borrador_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    recepcion_service::eliminar_borrador(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener).delete(eliminar_borrador_handler))
        .route("/{id}/confirmar", post(confirmar))
        .route("/{id}/foto", post(subir_foto).put(subir_foto))
        .route("/scanner-session", post(crear_scanner_session))
        .route("/scanner-session/{token}/scan", post(scan_codigo))
        .route("/scanner-session/{token}/items", get(get_scanner_items))
}

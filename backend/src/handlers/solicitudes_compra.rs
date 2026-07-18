use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::solicitud::{
    CancelarEnvioInput, RegistrarEnvioInput, SolicitudDetalle, UpdateSolicitudRequest,
};
use crate::errors::AppError;
use crate::services::solicitud_service::{
    HorizonteResponse, ListarSolicitudesParams, SolicitudService,
};

#[derive(Debug, Deserialize)]
struct SolicitudListParams {
    page: Option<i64>,
    per_page: Option<i64>,
    q: Option<String>,
    estado: Option<String>,
    proveedor_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct HorizonteParams {
    producto_id: Uuid,
    proveedor_id: i32,
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let id = SolicitudService::crear_o_actualizar_borrador(
        &state.pool,
        claims.sub,
        &payload.nota,
        &payload.items,
    )
    .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<SolicitudListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.unwrap_or(20).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);

    let (solicitudes, total) = SolicitudService::listar(
        &state.pool,
        ListarSolicitudesParams {
            page,
            per_page,
            q: params.q,
            estado: params.estado,
            proveedor_id: params.proveedor_id,
        },
    )
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
    Ok(Json(SolicitudService::recomendaciones(&state.pool).await?))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    Ok(Json(
        SolicitudService::obtener_detalle(&state.pool, id).await?,
    ))
}

async fn actualizar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    SolicitudService::actualizar_borrador(&state.pool, id, &req.nota, &req.items).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn guardar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    SolicitudService::guardar(&state.pool, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
    SolicitudService::enviar(&state.pool, id, req.metodo_envio.as_deref(), claims.sub).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn registrar_envio(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<RegistrarEnvioInput>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    let detalle = SolicitudService::registrar_envio(&state.pool, id, &req, claims.sub).await?;
    Ok(Json(detalle))
}

async fn cancelar_envio(
    State(state): State<AppState>,
    Path((id, proveedor_id)): Path<(Uuid, i32)>,
    Json(req): Json<CancelarEnvioInput>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    let detalle =
        SolicitudService::cancelar_envio(&state.pool, id, proveedor_id, req.version).await?;
    Ok(Json(detalle))
}

async fn completar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    SolicitudService::completar(&state.pool, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn cancelar(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<CancelarRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    SolicitudService::cancelar(&state.pool, id, &req.motivo).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_borrador(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    match SolicitudService::obtener_borrador(&state.pool, claims.sub).await? {
        None => Ok(Json(serde_json::json!({ "borrador": null }))),
        Some(detalle) => Ok(Json(serde_json::json!({ "borrador": detalle }))),
    }
}

async fn horizonte_sugerido(
    State(state): State<AppState>,
    Query(params): Query<HorizonteParams>,
) -> Result<Json<HorizonteResponse>, AppError> {
    let resp =
        SolicitudService::horizonte(&state.pool, params.producto_id, params.proveedor_id).await?;
    Ok(Json(resp))
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

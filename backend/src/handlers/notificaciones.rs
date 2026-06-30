use axum::{
    Extension, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use uuid::Uuid;

use crate::{
    auth::models::Claims,
    db::AppState,
    dto::pagination::PaginationParams,
    errors::AppError,
    services::notificacion_service,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar))
        .route("/conteo", get(obtener_conteo))
        .route("/{id}/leer", post(marcar_leida))
        .route("/leer-todas", post(marcar_todas_leidas))
        .route("/clear", axum::routing::delete(limpiar_todas))
}

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    if claims.rol != "admin" {
        return Err(AppError::Forbidden("No autorizado".to_string()));
    }

    let page = params.page.unwrap_or(1);
    let per_page = params.per_page.unwrap_or(25);

    let res = notificacion_service::listar(&state.pool, claims.sub, page, per_page).await?;
    Ok(axum::Json(res))
}

async fn obtener_conteo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, AppError> {
    if claims.rol != "admin" {
        return Err(AppError::Forbidden("No autorizado".to_string()));
    }

    let res = notificacion_service::obtener_conteo_no_leidas(&state.pool, claims.sub).await?;
    Ok(axum::Json(res))
}

async fn marcar_leida(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    if claims.rol != "admin" {
        return Err(AppError::Forbidden("No autorizado".to_string()));
    }

    notificacion_service::marcar_leida(&state.pool, claims.sub, id).await?;
    Ok(StatusCode::OK)
}

async fn marcar_todas_leidas(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, AppError> {
    if claims.rol != "admin" {
        return Err(AppError::Forbidden("No autorizado".to_string()));
    }

    notificacion_service::marcar_todas_leidas(&state.pool, claims.sub).await?;
    Ok(StatusCode::OK)
}

async fn limpiar_todas(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, AppError> {
    if claims.rol != "admin" {
        return Err(AppError::Forbidden("No autorizado".to_string()));
    }

    notificacion_service::eliminar_todas(&state.pool, claims.sub).await?;
    Ok(StatusCode::NO_CONTENT)
}

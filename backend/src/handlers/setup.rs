use axum::extract::{Multipart, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;
use crate::services::setup_service::{
    self, ImportConfig, ImportResult
};

// === Helpers ===

/// Extrae el archivo y la configuración del Multipart
async fn extract_import_data(
    mut multipart: Multipart,
) -> Result<(Vec<u8>, ImportConfig), AppError> {
    let mut file_bytes = None;
    let mut config = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(e.to_string()))?
    {
        match field.name() {
            Some("file") => {
                file_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| AppError::Validation(e.to_string()))?
                        .to_vec(),
                )
            }
            Some("config") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::Validation(e.to_string()))?;
                config =
                    Some(serde_json::from_str::<ImportConfig>(&text).map_err(|e| {
                        AppError::Validation(format!("Configuración inválida: {}", e))
                    })?);
            }
            _ => {}
        }
    }

    let b = file_bytes.ok_or(AppError::Validation("Archivo no encontrado".into()))?;
    let c = config.ok_or(AppError::Validation("Configuración no encontrada".into()))?;
    Ok((b, c))
}

// === Handlers ===

/// GET /api/v1/setup/estado
async fn estado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let estado = setup_service::verificar_estado(&state.pool).await?;
    Ok(Json(serde_json::json!({
        "carga_inicial_completada": estado.carga_inicial_completada,
        "productos_cargados": estado.productos_cargados
    })))
}

/// POST /api/v1/setup/importar-productos (Mapeador Inteligente)
async fn importar_productos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> Result<Json<ImportResult>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let (bytes, config) = extract_import_data(multipart).await?;
    let res = setup_service::importar_catalogo(&state.pool, &bytes, config).await?;
    Ok(Json(res))
}

/// POST /api/v1/setup/importar-stock
async fn importar_stock(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let mut file_bytes = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(e.to_string()))?
    {
        if field.name() == Some("file") {
            file_bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::Validation(e.to_string()))?
                    .to_vec(),
            );
        }
    }

    let bytes = file_bytes.ok_or(AppError::Validation("Archivo no encontrado".into()))?;
    let res = setup_service::importar_inventario(&state.pool, &bytes).await?;
    Ok(Json(res))
}

/// GET /api/v1/setup/resumen
async fn resumen(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let res = setup_service::obtener_resumen(&state.pool).await?;
    Ok(Json(serde_json::json!({
        "productos": res.productos,
        "presentaciones": res.presentaciones,
        "lotes": res.lotes,
        "stock_registros": res.stock_registros,
        "categorias_creadas": res.categorias_creadas,
        "areas_con_stock": res.areas_con_stock
    })))
}

/// POST /api/v1/setup/finalizar
async fn finalizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    setup_service::finalizar_setup(&state.pool).await?;
    Ok(Json(serde_json::json!({ "mensaje": "Configuración finalizada" })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/estado", get(estado))
        .route("/importar-productos", post(importar_productos))
        .route("/importar-stock", post(importar_stock))
        .route("/resumen", get(resumen))
        .route("/finalizar", post(finalizar))
}

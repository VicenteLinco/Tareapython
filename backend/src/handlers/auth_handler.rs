use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Extension, Json, Router};

use crate::auth::models::{
    CambiarPasswordRequest, Claims, LoginRequest, LoginResponse, RefreshRequest, UserResponse,
};
use crate::db::AppState;
use crate::errors::AppError;
use crate::services::auth_service::AuthService;

/// Extrae IP del cliente desde headers (X-Forwarded-For, X-Real-Ip) o usa fallback.
fn extract_client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Login de usuario para obtener tokens de acceso
#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login exitoso", body = LoginResponse),
        (status = 401, description = "Credenciales inválidas"),
        (status = 429, description = "Demasiadas solicitudes")
    ),
    tag = "auth"
)]
async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    // Rate limiting por IP
    let ip = extract_client_ip(&headers);
    if !state.login_limiter.check(&ip).await {
        tracing::warn!("Login bloqueado por rate limit: {}", ip);
        return Err(AppError::TooManyRequests);
    }

    let response = AuthService::login(&state.pool, &state.config, req, &ip).await?;
    Ok(Json(response))
}

async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    // Rate limiting por IP
    let ip = extract_client_ip(&headers);
    if !state.login_limiter.check(&ip).await {
        return Err(AppError::TooManyRequests);
    }

    let response = AuthService::refresh(&state.pool, &state.config, req, &ip).await?;
    Ok(Json(response))
}

async fn me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserResponse>, AppError> {
    let response = AuthService::me(&state.pool, claims.sub, claims.rol, claims.area_ids).await?;
    Ok(Json(response))
}

async fn actualizar_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<crate::auth::models::UpdateProfileRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let updated_user = crate::services::usuario_service::actualizar_perfil(&state.pool, claims.sub, req).await?;
    
    Ok(Json(UserResponse {
        id: updated_user.id,
        nombre: updated_user.nombre,
        email: updated_user.email,
        whatsapp_phone: updated_user.whatsapp_phone,
        rol: updated_user.rol,
        area_ids: updated_user.areas.iter().map(|a| a.id).collect(),
        version: updated_user.version,
    }))
}

async fn cambiar_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CambiarPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    AuthService::cambiar_password(&state.pool, claims.sub, req).await?;
    Ok(Json(serde_json::json!({ "message": "Contraseña actualizada" })))
}

/// Rutas públicas (no requieren JWT)
async fn logout(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    AuthService::logout(&state.pool, &state.config, req).await?;
    Ok(Json(serde_json::json!({ "message": "Sesion cerrada" })))
}

pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/logout", post(logout))
}

/// Rutas protegidas (requieren JWT, el middleware se aplica en routes.rs)
pub fn protected_routes() -> Router<AppState> {
    Router::new()
        .route("/me", get(me).put(actualizar_me))
        .route("/cambiar-password", post(cambiar_password))
}

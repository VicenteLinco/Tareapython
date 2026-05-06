use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use sqlx::Row;

use crate::auth::jwt::{create_access_token, create_refresh_token, verify_refresh_token};
use crate::auth::models::{
    CambiarPasswordRequest, Claims, LoginRequest, LoginResponse, RefreshRequest, UserResponse,
};
use crate::db::AppState;
use crate::errors::AppError;

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use uuid::Uuid;

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

    let email_normalizado = req.email.trim().to_lowercase();
    tracing::info!("Intento de login para: {}", email_normalizado);

    let user = sqlx::query("SELECT id, password_hash, rol, activo FROM usuarios WHERE email = $1")
        .bind(&email_normalizado)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| {
            tracing::warn!("Usuario no encontrado: {}", email_normalizado);
            AppError::Unauthorized
        })?;

    let activo: bool = user.get("activo");
    if !activo {
        tracing::warn!("Usuario inactivo intentó loguear: {}", email_normalizado);
        return Err(AppError::Unauthorized);
    }

    let password_hash: String = user.get("password_hash");
    let parsed_hash = PasswordHash::new(&password_hash).map_err(|e| {
        tracing::error!(
            "Error al parsear hash de DB para {}: {}",
            email_normalizado,
            e
        );
        AppError::Internal("Hash inválido en DB".to_string())
    })?;

    if let Err(e) = Argon2::default().verify_password(req.password.as_bytes(), &parsed_hash) {
        tracing::warn!("Contraseña incorrecta para {}: {}", email_normalizado, e);
        return Err(AppError::Unauthorized);
    }

    let user_id: Uuid = user.get("id");
    let rol: String = user.get("rol");

    tracing::info!("Login exitoso: {} (ID: {})", email_normalizado, user_id);

    let area_rows = sqlx::query("SELECT area_id FROM usuario_area WHERE usuario_id = $1")
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;

    let area_ids: Vec<i32> = area_rows.iter().map(|r| r.get("area_id")).collect();

    let access_token = create_access_token(user_id, &rol, area_ids, &state.config)?;
    let refresh_token = create_refresh_token(user_id, &state.config)?;

    Ok(Json(LoginResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.config.jwt_access_expiration,
    }))
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

    let refresh_claims = verify_refresh_token(&req.refresh_token, &state.config.jwt_secret)?;

    let user = sqlx::query("SELECT id, rol, activo FROM usuarios WHERE id = $1")
        .bind(refresh_claims.sub)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;

    let activo: bool = user.get("activo");
    if !activo {
        return Err(AppError::Unauthorized);
    }

    let user_id: Uuid = user.get("id");
    let rol: String = user.get("rol");

    let area_rows = sqlx::query("SELECT area_id FROM usuario_area WHERE usuario_id = $1")
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;

    let area_ids: Vec<i32> = area_rows.iter().map(|r| r.get("area_id")).collect();

    let access_token = create_access_token(user_id, &rol, area_ids, &state.config)?;
    let refresh_token = create_refresh_token(user_id, &state.config)?;

    Ok(Json(LoginResponse {
        access_token,
        refresh_token,
        token_type: "Bearer".to_string(),
        expires_in: state.config.jwt_access_expiration,
    }))
}

async fn me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserResponse>, AppError> {
    let user = sqlx::query("SELECT nombre, email, version FROM usuarios WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(UserResponse {
        id: claims.sub,
        nombre: user.get("nombre"),
        email: user.get("email"),
        rol: claims.rol,
        area_ids: claims.area_ids,
        version: user.get("version"),
    }))
}

async fn cambiar_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CambiarPasswordRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if req.password_nueva.len() < 8 {
        return Err(AppError::Validation(
            "La contraseña debe tener al menos 8 caracteres".to_string(),
        ));
    }
    if req.password_nueva.len() > 128 {
        return Err(AppError::Validation(
            "La contraseña no puede exceder 128 caracteres".to_string(),
        ));
    }

    let user = sqlx::query("SELECT password_hash FROM usuarios WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.pool)
        .await?;

    let password_hash: String = user.get("password_hash");
    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|_| AppError::Internal("Hash inválido en DB".to_string()))?;

    Argon2::default()
        .verify_password(req.password_actual.as_bytes(), &parsed_hash)
        .map_err(|_| AppError::Validation("Contraseña actual incorrecta".to_string()))?;

    let salt = SaltString::generate(&mut OsRng);
    let new_hash = Argon2::default()
        .hash_password(req.password_nueva.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Error hasheando password: {}", e)))?
        .to_string();

    sqlx::query("UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&new_hash)
        .bind(claims.sub)
        .execute(&state.pool)
        .await?;

    Ok(Json(
        serde_json::json!({ "message": "Contraseña actualizada" }),
    ))
}

/// Rutas públicas (no requieren JWT)
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/login", post(login))
        .route("/refresh", post(refresh))
}

/// Rutas protegidas (requieren JWT, el middleware se aplica en routes.rs)
pub fn protected_routes() -> Router<AppState> {
    Router::new()
        .route("/me", get(me))
        .route("/cambiar-password", post(cambiar_password))
}

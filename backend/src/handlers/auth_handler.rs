use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{TimeZone, Utc};
use sha2::{Digest, Sha256};
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

fn refresh_token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

async fn registrar_refresh_session(
    state: &AppState,
    token: &str,
    user_id: Uuid,
    ip: &str,
) -> Result<(), AppError> {
    let claims = verify_refresh_token(token, &state.config.jwt_secret)?;
    let expires_at = Utc
        .timestamp_opt(claims.exp, 0)
        .single()
        .ok_or_else(|| AppError::Internal("Expiracion de refresh token invalida".into()))?;

    sqlx::query(
        "INSERT INTO refresh_sessions (id, usuario_id, token_hash, expires_at, created_ip) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(claims.jti)
    .bind(user_id)
    .bind(refresh_token_hash(token))
    .bind(expires_at)
    .bind(ip)
    .execute(&state.pool)
    .await?;

    Ok(())
}

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
    registrar_refresh_session(&state, &refresh_token, user_id, &ip).await?;

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
    let token_hash = refresh_token_hash(&req.refresh_token);

    let session = sqlx::query(
        "SELECT usuario_id, revoked_at, expires_at, replaced_by FROM refresh_sessions \
         WHERE id = $1 AND token_hash = $2",
    )
    .bind(refresh_claims.jti)
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let session_user_id: Uuid = session.get("usuario_id");
    let revoked_at: Option<chrono::DateTime<Utc>> = session.get("revoked_at");
    let expires_at: chrono::DateTime<Utc> = session.get("expires_at");
    if revoked_at.is_some() {
        let replaced_by: Option<Uuid> = session.get("replaced_by");
        if let Some(replacement_id) = replaced_by {
            sqlx::query(
                "UPDATE refresh_sessions SET revoked_at = NOW() \
                 WHERE id = $1 AND revoked_at IS NULL",
            )
            .bind(replacement_id)
            .execute(&state.pool)
            .await?;
            tracing::warn!(
                "Refresh token reutilizado; sesion reemplazo revocada para usuario {}",
                refresh_claims.sub
            );
        }
        return Err(AppError::Unauthorized);
    }
    if session_user_id != refresh_claims.sub || expires_at <= Utc::now() {
        return Err(AppError::Unauthorized);
    }

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
    let new_claims = verify_refresh_token(&refresh_token, &state.config.jwt_secret)?;
    let new_expires_at = Utc
        .timestamp_opt(new_claims.exp, 0)
        .single()
        .ok_or_else(|| AppError::Internal("Expiracion de refresh token invalida".into()))?;

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO refresh_sessions (id, usuario_id, token_hash, expires_at, created_ip) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(new_claims.jti)
    .bind(user_id)
    .bind(refresh_token_hash(&refresh_token))
    .bind(new_expires_at)
    .bind(&ip)
    .execute(&mut *tx)
    .await?;

    let revoke_result = sqlx::query(
        "UPDATE refresh_sessions \
         SET revoked_at = NOW(), replaced_by = $1 \
         WHERE id = $2 AND revoked_at IS NULL",
    )
    .bind(new_claims.jti)
    .bind(refresh_claims.jti)
    .execute(&mut *tx)
    .await?;
    if revoke_result.rows_affected() != 1 {
        return Err(AppError::Unauthorized);
    }
    tx.commit().await?;

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

    sqlx::query(
        "UPDATE refresh_sessions SET revoked_at = NOW() \
         WHERE usuario_id = $1 AND revoked_at IS NULL",
    )
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(Json(
        serde_json::json!({ "message": "Contraseña actualizada" }),
    ))
}

/// Rutas públicas (no requieren JWT)
async fn logout(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let refresh_claims = verify_refresh_token(&req.refresh_token, &state.config.jwt_secret)?;

    sqlx::query(
        "UPDATE refresh_sessions SET revoked_at = NOW() \
         WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL",
    )
    .bind(refresh_claims.jti)
    .bind(refresh_token_hash(&req.refresh_token))
    .execute(&state.pool)
    .await?;

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
        .route("/me", get(me))
        .route("/cambiar-password", post(cambiar_password))
}

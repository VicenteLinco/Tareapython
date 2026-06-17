use sqlx::{PgPool, Row};
use uuid::Uuid;
use chrono::{TimeZone, Utc};
use sha2::{Digest, Sha256};
use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};

use crate::auth::jwt::{create_access_token, create_refresh_token, verify_refresh_token};
use crate::auth::models::{
    CambiarPasswordRequest, LoginRequest, LoginResponse, RefreshRequest, UserResponse,
};
use crate::errors::AppError;

fn refresh_token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

async fn registrar_refresh_session(
    pool: &PgPool,
    config: &crate::config::AppConfig,
    token: &str,
    user_id: Uuid,
    ip: &str,
) -> Result<(), AppError> {
    let claims = verify_refresh_token(token, &config.jwt_refresh_secret)?;
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
    .execute(pool)
    .await?;

    Ok(())
}

pub struct AuthService;

impl AuthService {
    /// Login de usuario para obtener tokens de acceso
    pub async fn login(
        pool: &PgPool,
        config: &crate::config::AppConfig,
        req: LoginRequest,
        ip: &str,
    ) -> Result<LoginResponse, AppError> {
        let email_normalizado = req.email.trim().to_lowercase();
        tracing::info!("Intento de login para: {}", email_normalizado);

        let user = sqlx::query("SELECT id, password_hash, rol, activo FROM usuarios WHERE email = $1 AND deleted_at IS NULL")
            .bind(&email_normalizado)
            .fetch_optional(pool)
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
            .fetch_all(pool)
            .await?;

        let area_ids: Vec<i32> = area_rows.iter().map(|r| r.get("area_id")).collect();

        let access_token = create_access_token(user_id, &rol, area_ids, config)?;
        let refresh_token = create_refresh_token(user_id, config)?;
        registrar_refresh_session(pool, config, &refresh_token, user_id, ip).await?;

        Ok(LoginResponse {
            access_token,
            refresh_token,
            token_type: "Bearer".to_string(),
            expires_in: config.jwt_access_expiration,
        })
    }

    /// Refresca los tokens de acceso usando un refresh token válido
    pub async fn refresh(
        pool: &PgPool,
        config: &crate::config::AppConfig,
        req: RefreshRequest,
        ip: &str,
    ) -> Result<LoginResponse, AppError> {
        let refresh_claims = verify_refresh_token(&req.refresh_token, &config.jwt_refresh_secret)?;
        let token_hash = refresh_token_hash(&req.refresh_token);

        let session = sqlx::query(
            "SELECT usuario_id, revoked_at, expires_at, replaced_by FROM refresh_sessions \
             WHERE id = $1 AND token_hash = $2",
        )
        .bind(refresh_claims.jti)
        .bind(&token_hash)
        .fetch_optional(pool)
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
                .execute(pool)
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

        let user = sqlx::query("SELECT id, rol, activo FROM usuarios WHERE id = $1 AND deleted_at IS NULL")
            .bind(refresh_claims.sub)
            .fetch_optional(pool)
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
            .fetch_all(pool)
            .await?;

        let area_ids: Vec<i32> = area_rows.iter().map(|r| r.get("area_id")).collect();

        let access_token = create_access_token(user_id, &rol, area_ids, config)?;
        let refresh_token = create_refresh_token(user_id, config)?;
        let new_claims = verify_refresh_token(&refresh_token, &config.jwt_refresh_secret)?;
        let new_expires_at = Utc
            .timestamp_opt(new_claims.exp, 0)
            .single()
            .ok_or_else(|| AppError::Internal("Expiracion de refresh token invalida".into()))?;

        let mut tx = pool.begin().await?;
        sqlx::query(
            "INSERT INTO refresh_sessions (id, usuario_id, token_hash, expires_at, created_ip) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(new_claims.jti)
        .bind(user_id)
        .bind(refresh_token_hash(&refresh_token))
        .bind(new_expires_at)
        .bind(ip)
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

        Ok(LoginResponse {
            access_token,
            refresh_token,
            token_type: "Bearer".to_string(),
            expires_in: config.jwt_access_expiration,
        })
    }

    /// Cierra la sesión revocando el refresh token
    pub async fn logout(
        pool: &PgPool,
        config: &crate::config::AppConfig,
        req: RefreshRequest,
    ) -> Result<(), AppError> {
        let refresh_claims = verify_refresh_token(&req.refresh_token, &config.jwt_refresh_secret)?;

        sqlx::query(
            "UPDATE refresh_sessions SET revoked_at = NOW() \
             WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL",
        )
        .bind(refresh_claims.jti)
        .bind(refresh_token_hash(&req.refresh_token))
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Obtiene los datos del perfil del usuario actual
    pub async fn me(
        pool: &PgPool,
        claims_sub: Uuid,
        claims_rol: String,
        claims_area_ids: Vec<i32>,
    ) -> Result<UserResponse, AppError> {
        let user = sqlx::query("SELECT nombre, email, whatsapp_phone, version FROM usuarios WHERE id = $1 AND deleted_at IS NULL")
            .bind(claims_sub)
            .fetch_one(pool)
            .await?;

        Ok(UserResponse {
            id: claims_sub,
            nombre: user.get("nombre"),
            email: user.get("email"),
            whatsapp_phone: user.get("whatsapp_phone"),
            rol: claims_rol,
            area_ids: claims_area_ids,
            version: user.get("version"),
        })
    }

    /// Cambia la contraseña del usuario
    pub async fn cambiar_password(
        pool: &PgPool,
        claims_sub: Uuid,
        req: CambiarPasswordRequest,
    ) -> Result<(), AppError> {
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

        let user = sqlx::query("SELECT password_hash FROM usuarios WHERE id = $1 AND deleted_at IS NULL")
            .bind(claims_sub)
            .fetch_one(pool)
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

        sqlx::query("UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL")
            .bind(&new_hash)
            .bind(claims_sub)
            .execute(pool)
            .await?;

        sqlx::query(
            "UPDATE refresh_sessions SET revoked_at = NOW() \
             WHERE usuario_id = $1 AND revoked_at IS NULL",
        )
        .bind(claims_sub)
        .execute(pool)
        .await?;

        Ok(())
    }
}

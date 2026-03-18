use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use uuid::Uuid;

use crate::config::AppConfig;
use crate::errors::AppError;

use super::models::{Claims, RefreshClaims};

pub fn create_access_token(
    user_id: Uuid,
    rol: &str,
    area_ids: Vec<i32>,
    config: &AppConfig,
) -> Result<String, AppError> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: user_id,
        rol: rol.to_string(),
        area_ids,
        exp: now + config.jwt_access_expiration,
        iat: now,
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Error creando access token: {}", e)))
}

pub fn create_refresh_token(user_id: Uuid, config: &AppConfig) -> Result<String, AppError> {
    let now = Utc::now().timestamp();
    let claims = RefreshClaims {
        sub: user_id,
        token_type: "refresh".to_string(),
        exp: now + config.jwt_refresh_expiration,
        iat: now,
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Error creando refresh token: {}", e)))
}

pub fn verify_access_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "iat", "sub"]);

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized)?;

    Ok(token_data.claims)
}

pub fn verify_refresh_token(token: &str, secret: &str) -> Result<RefreshClaims, AppError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "iat", "sub"]);

    let token_data = decode::<RefreshClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::Unauthorized)?;

    if token_data.claims.token_type != "refresh" {
        return Err(AppError::Unauthorized);
    }

    Ok(token_data.claims)
}

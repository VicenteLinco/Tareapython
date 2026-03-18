use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

use crate::db::AppState;
use crate::errors::AppError;

use super::jwt::verify_access_token;
use super::models::Claims;

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;

    let claims = verify_access_token(token, &state.config.jwt_secret)?;

    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}

pub fn require_role<'a>(allowed_roles: &'a [&'a str]) -> impl Fn(&Claims) -> Result<(), AppError> + 'a {
    move |claims: &Claims| {
        if allowed_roles.contains(&claims.rol.as_str()) {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!(
                "Rol '{}' no tiene acceso a este recurso",
                claims.rol
            )))
        }
    }
}

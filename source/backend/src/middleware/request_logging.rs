use std::time::Instant;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use crate::auth::jwt::verify_access_token;
use crate::db::AppState;

const REQUEST_ID_HEADER: &str = "x-request-id";

pub async fn request_logging(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let request_id = request_id(&request);
    let usuario_id = user_id(&request, &state.config.jwt_secret);

    request.extensions_mut().insert(request_id.clone());

    let mut response = next.run(request).await;
    let status = response.status();
    let latency_ms = started.elapsed().as_millis() as u64;

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), value);
    }

    tracing::info!(
        request_id = %request_id,
        usuario_id = usuario_id.as_deref().unwrap_or("anonymous"),
        method = %method,
        path = %path,
        status = status.as_u16(),
        latency_ms,
        "http_request"
    );

    response
}

fn request_id(request: &Request<Body>) -> String {
    request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn user_id(request: &Request<Body>, secret: &str) -> Option<String> {
    let auth_header = request.headers().get(axum::http::header::AUTHORIZATION)?;
    let auth_str = auth_header.to_str().ok()?;
    let token = auth_str.strip_prefix("Bearer ")?;
    let claims = verify_access_token(token, secret).ok()?;
    Some(claims.sub.to_string())
}

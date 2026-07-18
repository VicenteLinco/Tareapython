use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

use crate::auth::jwt::verify_access_token;
use crate::db::AppState;

/// Rate limiter de ventana deslizante en memoria.
#[derive(Clone)]
pub struct RateLimiter {
    requests: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
    max_requests: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window_secs: u64) -> Self {
        Self {
            requests: Arc::new(Mutex::new(HashMap::new())),
            max_requests,
            window: Duration::from_secs(window_secs),
        }
    }

    pub async fn check(&self, key: &str) -> bool {
        let mut map = self.requests.lock().await;
        let now = Instant::now();
        let window = self.window;

        let entries = map.entry(key.to_string()).or_default();
        entries.retain(|t| now.duration_since(*t) < window);

        if entries.len() >= self.max_requests {
            false
        } else {
            entries.push(now);
            true
        }
    }

    pub async fn cleanup(&self) {
        let mut map = self.requests.lock().await;
        let now = Instant::now();
        let window = self.window;

        map.retain(|_, entries| {
            entries.retain(|t| now.duration_since(*t) < window);
            !entries.is_empty()
        });
    }
}

/// Middleware de Rate Limiting Diferenciado (SPEC-TECH-04)
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let method = req.method();
    let path = req.uri().path();

    // 1. Auth Limiter (Login/Refresh)
    if path.contains("/api/v1/auth/login") || path.contains("/api/v1/auth/refresh") {
        let ip = extract_ip(&req);
        if !state.login_limiter.check(&ip).await {
            tracing::warn!("Rate limit exceeded for auth: {}", ip);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
    } else if path.starts_with("/api/v1") {
        // 2. Otros endpoints bajo /api/v1
        let user_id = extract_user_id(&req, &state.config.jwt_secret);
        let key = user_id.unwrap_or_else(|| extract_ip(&req));

        if method == axum::http::Method::GET {
            // Lecturas: 300 req/min
            if !state.read_limiter.check(&key).await {
                tracing::warn!("Rate limit exceeded for reads: {}", key);
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
        } else if method == axum::http::Method::POST
            || method == axum::http::Method::PUT
            || method == axum::http::Method::DELETE
            || method == axum::http::Method::PATCH
        {
            // Mutaciones: 60 req/min
            if !state.mutation_limiter.check(&key).await {
                tracing::warn!("Rate limit exceeded for mutations: {}", key);
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
        }
    }

    Ok(next.run(req).await)
}

fn extract_ip(req: &Request<Body>) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            req.headers()
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
}

fn extract_user_id(req: &Request<Body>, secret: &str) -> Option<String> {
    let auth_header = req.headers().get(axum::http::header::AUTHORIZATION)?;
    let auth_str = auth_header.to_str().ok()?;
    if !auth_str.starts_with("Bearer ") {
        return None;
    }
    let token = &auth_str[7..];
    let claims = verify_access_token(token, secret).ok()?;
    Some(claims.sub.to_string())
}

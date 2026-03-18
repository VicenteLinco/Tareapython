use std::net::SocketAddr;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod dto;
mod errors;
mod handlers;
mod middleware;
mod models;
mod routes;
mod services;

use middleware::rate_limit::RateLimiter;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = config::AppConfig::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .expect("No se pudo conectar a la base de datos");

    tracing::info!("Conectado a PostgreSQL");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Error ejecutando migraciones");

    tracing::info!("Migraciones ejecutadas");

    // CORS: restringido al origen configurado
    let cors = if config.cors_origin == "*" {
        CorsLayer::new()
            .allow_origin(tower_http::cors::Any)
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::PATCH,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::HeaderName::from_static("x-idempotency-key"),
            ])
    } else {
        let origin = config
            .cors_origin
            .parse::<axum::http::HeaderValue>()
            .expect("CORS_ORIGIN inválido");
        CorsLayer::new()
            .allow_origin(origin)
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::PATCH,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::HeaderName::from_static("x-idempotency-key"),
            ])
    };

    // Rate limiter: 10 requests por minuto en login/refresh
    let login_limiter = RateLimiter::new(10, 60);

    // Tarea de limpieza periódica del rate limiter
    let cleanup_limiter = login_limiter.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            cleanup_limiter.cleanup().await;
        }
    });

    let state = db::AppState {
        pool: pool.clone(),
        config: config.clone(),
        login_limiter,
    };

    let app = Router::new()
        .merge(routes::create_routes(state.clone()))
        .layer(axum::middleware::from_fn(
            middleware::security_headers::security_headers,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB max body
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Servidor iniciado en {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

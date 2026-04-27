use std::net::SocketAddr;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
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

    // --- BLOQUE DE EMERGENCIA: Reset Admin ---
    {
        let email = "admin@laboratorio.cl";
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM usuarios WHERE email = $1)")
            .bind(email)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);

        if !exists {
            use argon2::password_hash::SaltString;
            use argon2::{Argon2, PasswordHasher};
            use argon2::password_hash::rand_core::OsRng;

            let salt = SaltString::generate(&mut OsRng);
            let password = "Admin123!";
            let hash = Argon2::default()
                .hash_password(password.as_bytes(), &salt)
                .expect("Error hasheando password de emergencia")
                .to_string();

            let res = sqlx::query(
                "INSERT INTO usuarios (nombre, email, password_hash, rol) \
                 VALUES ('Administrador', $1, $2, 'admin')",
            )
            .bind(email)
            .bind(hash)
            .execute(&pool).await;

            match res {
                Ok(_) => tracing::info!("Admin creado exitosamente"),
                Err(e) => tracing::error!("Error creando admin: {}", e),
            }
        } else {
            tracing::info!("Admin ya existe, saltando creación de emergencia");
        }
    }
    // -----------------------------------------

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

    // Rate limiters: aumentados para desarrollo
    let login_limiter = RateLimiter::new(100, 60);    // Auth: 100 req/min
    let mutation_limiter = RateLimiter::new(200, 60); // Mutaciones: 200 req/min
    let read_limiter = RateLimiter::new(1000, 60);    // Lecturas: 1000 req/min

    // Tarea de limpieza periódica de los rate limiters
    let (c1, c2, c3) = (login_limiter.clone(), mutation_limiter.clone(), read_limiter.clone());
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            c1.cleanup().await;
            c2.cleanup().await;
            c3.cleanup().await;
        }
    });

    let state = db::AppState {
        pool: pool.clone(),
        config: config.clone(),
        login_limiter,
        mutation_limiter,
        read_limiter,
    };

    let app = Router::new()
        .merge(routes::create_routes(state.clone()))
        .fallback_service(
            ServeDir::new("static").fallback(ServeFile::new("static/index.html")),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit_middleware,
        ))
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

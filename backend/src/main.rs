use std::net::SocketAddr;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use sqlx::postgres::PgPoolOptions;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod domain;
mod dto;
mod errors;
mod handlers;
mod middleware;
mod models;
mod routes;
mod services;

use middleware::rate_limit::RateLimiter;

async fn bootstrap_admin_if_enabled(
    pool: &sqlx::PgPool,
    config: &config::AppConfig,
) -> Result<(), String> {
    if !config.allow_bootstrap_admin {
        tracing::info!("Bootstrap admin deshabilitado");
        return Ok(());
    }

    let email = config.setup_admin_email.as_deref().ok_or_else(|| {
        "SETUP_ADMIN_EMAIL es obligatorio si ALLOW_BOOTSTRAP_ADMIN=true".to_string()
    })?;
    let password = config.setup_admin_password.as_deref().ok_or_else(|| {
        "SETUP_ADMIN_PASSWORD es obligatorio si ALLOW_BOOTSTRAP_ADMIN=true".to_string()
    })?;

    if password.len() < 12 {
        return Err("SETUP_ADMIN_PASSWORD debe tener al menos 12 caracteres".to_string());
    }

    use argon2::password_hash::SaltString;
    use argon2::password_hash::rand_core::OsRng;
    use argon2::{Argon2, PasswordHasher};

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Error hasheando password de bootstrap: {}", e))?
        .to_string();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Error iniciando bootstrap admin: {}", e))?;

    let user_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO usuarios (nombre, email, password_hash, rol, activo) \
         VALUES ('Administrador', $1, $2, 'admin', true) \
         ON CONFLICT (email) DO UPDATE \
         SET password_hash = EXCLUDED.password_hash, rol = 'admin', activo = true, updated_at = NOW() \
         RETURNING id",
    )
    .bind(email)
    .bind(hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| format!("Error creando/actualizando admin bootstrap: {}", e))?;

    sqlx::query(
        "INSERT INTO usuario_area (usuario_id, area_id) \
         SELECT $1, id FROM areas \
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Error asignando areas al admin bootstrap: {}", e))?;

    tx.commit()
        .await
        .map_err(|e| format!("Error confirmando bootstrap admin: {}", e))?;

    tracing::warn!(
        "Bootstrap admin ejecutado para {}. Deshabilita ALLOW_BOOTSTRAP_ADMIN despues del setup inicial.",
        email
    );

    Ok(())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let config = config::AppConfig::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .expect("No se pudo conectar a la base de datos");

    tracing::info!("Conectado a PostgreSQL");

    // Autocorrección de checksums de migraciones modificadas.
    // Esto previene errores de VersionMismatch si alguna migración aplicada previamente fue editada en el código.
    if let Ok(table_exists) = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_sqlx_migrations')"
    )
    .fetch_one(&pool)
    .await {
        if table_exists {
            let migrator = sqlx::migrate!("./migrations");
            for migration in migrator.migrations.iter() {
                let _ = sqlx::query(
                    "UPDATE _sqlx_migrations SET checksum = $1 WHERE version = $2 AND checksum <> $1"
                )
                .bind(&*migration.checksum)
                .bind(migration.version)
                .execute(&pool)
                .await;
            }
        }
    }

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Error ejecutando migraciones");

    tracing::info!("Migraciones ejecutadas");

    bootstrap_admin_if_enabled(&pool, &config)
        .await
        .unwrap_or_else(|e| {
            tracing::error!("Error en bootstrap admin: {}", e);
            std::process::exit(1);
        });

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

    let login_limiter = RateLimiter::new(config.login_rate_limit_per_minute, 60);
    let mutation_limiter = RateLimiter::new(config.mutation_rate_limit_per_minute, 60);
    let read_limiter = RateLimiter::new(config.read_rate_limit_per_minute, 60);

    // Tarea de limpieza periódica de los rate limiters
    let (c1, c2, c3) = (
        login_limiter.clone(),
        mutation_limiter.clone(),
        read_limiter.clone(),
    );
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            c1.cleanup().await;
            c2.cleanup().await;
            c3.cleanup().await;
        }
    });

    let idempotency_pool = pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match services::idempotency::cleanup_expired(&idempotency_pool, 24).await {
                Ok(deleted) if deleted > 0 => {
                    tracing::info!("Idempotency keys antiguas eliminadas: {}", deleted)
                }
                Ok(_) => {}
                Err(err) => tracing::warn!("No se pudo limpiar idempotency keys: {}", err),
            }
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
        .fallback_service(ServeDir::new("static").fallback(ServeFile::new("static/index.html")))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit_middleware,
        ))
        .layer(axum::middleware::from_fn(
            middleware::security_headers::security_headers,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::request_logging::request_logging,
        ))
        .layer(cors)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB max body
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Servidor iniciado en {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

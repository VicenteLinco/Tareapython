use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_access_expiration: i64,
    pub jwt_refresh_expiration: i64,
    pub port: u16,
    pub cors_origin: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let jwt_secret = env::var("JWT_SECRET")
            .expect("JWT_SECRET debe estar configurada");

        if jwt_secret.len() < 32 {
            panic!("JWT_SECRET debe tener al menos 32 caracteres");
        }

        Self {
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL debe estar configurada"),
            jwt_secret,
            jwt_access_expiration: env::var("JWT_ACCESS_EXPIRATION")
                .unwrap_or_else(|_| "900".to_string())
                .parse()
                .expect("JWT_ACCESS_EXPIRATION debe ser un número"),
            jwt_refresh_expiration: env::var("JWT_REFRESH_EXPIRATION")
                .unwrap_or_else(|_| "86400".to_string())
                .parse()
                .expect("JWT_REFRESH_EXPIRATION debe ser un número"),
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .expect("PORT debe ser un número"),
            cors_origin: env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:5173".to_string()),
        }
    }
}

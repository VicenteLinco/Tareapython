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
    pub fn load() -> Result<Self, String> {
        let jwt_secret = env::var("JWT_SECRET")
            .map_err(|_| "Variable JWT_SECRET no está definida".to_string())?;

        if jwt_secret.len() < 32 {
            return Err(format!(
                "JWT_SECRET debe tener al menos 32 caracteres (tiene {})",
                jwt_secret.len()
            ));
        }

        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "Variable DATABASE_URL no está definida".to_string())?;

        let jwt_access_expiration = env::var("JWT_ACCESS_EXPIRATION")
            .unwrap_or_else(|_| "900".to_string())
            .parse::<i64>()
            .map_err(|_| "JWT_ACCESS_EXPIRATION debe ser un número entero".to_string())?;

        let jwt_refresh_expiration = env::var("JWT_REFRESH_EXPIRATION")
            .unwrap_or_else(|_| "86400".to_string())
            .parse::<i64>()
            .map_err(|_| "JWT_REFRESH_EXPIRATION debe ser un número entero".to_string())?;

        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|_| "PORT debe ser un número entre 1 y 65535".to_string())?;

        let cors_origin = env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:5173".to_string());

        Ok(Self {
            database_url,
            jwt_secret,
            jwt_access_expiration,
            jwt_refresh_expiration,
            port,
            cors_origin,
        })
    }

    // Mantener compatibilidad con código existente
    pub fn from_env() -> Self {
        Self::load().unwrap_or_else(|e| {
            eprintln!("ERROR DE CONFIGURACIÓN: {}", e);
            std::process::exit(1);
        })
    }
}

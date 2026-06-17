use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_refresh_secret: String,
    pub jwt_access_expiration: i64,
    pub jwt_refresh_expiration: i64,
    pub port: u16,
    pub cors_origin: String,
    pub enable_swagger: bool,
    pub login_rate_limit_per_minute: usize,
    pub mutation_rate_limit_per_minute: usize,
    pub read_rate_limit_per_minute: usize,
    pub allow_bootstrap_admin: bool,
    pub setup_admin_email: Option<String>,
    pub setup_admin_password: Option<String>,
    pub twilio_auth_token: String,
    pub whatsapp_webhook_secret: String,
    pub whatsapp_api_url: String,
    pub whatsapp_api_key: String,
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

        let jwt_refresh_secret = env::var("JWT_REFRESH_SECRET")
            .map_err(|_| "Variable JWT_REFRESH_SECRET no está definida".to_string())?;

        if jwt_refresh_secret.len() < 32 {
            return Err(format!(
                "JWT_REFRESH_SECRET debe tener al menos 32 caracteres (tiene {})",
                jwt_refresh_secret.len()
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

        let cors_origin =
            env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_string());

        let enable_swagger = env::var("ENABLE_SWAGGER")
            .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        let login_rate_limit_per_minute = env::var("LOGIN_RATE_LIMIT_PER_MINUTE")
            .unwrap_or_else(|_| "10".to_string())
            .parse::<usize>()
            .map_err(|_| "LOGIN_RATE_LIMIT_PER_MINUTE debe ser un numero entero".to_string())?;

        let mutation_rate_limit_per_minute = env::var("MUTATION_RATE_LIMIT_PER_MINUTE")
            .unwrap_or_else(|_| "120".to_string())
            .parse::<usize>()
            .map_err(|_| "MUTATION_RATE_LIMIT_PER_MINUTE debe ser un numero entero".to_string())?;

        let read_rate_limit_per_minute = env::var("READ_RATE_LIMIT_PER_MINUTE")
            .unwrap_or_else(|_| "600".to_string())
            .parse::<usize>()
            .map_err(|_| "READ_RATE_LIMIT_PER_MINUTE debe ser un numero entero".to_string())?;

        let allow_bootstrap_admin = env::var("ALLOW_BOOTSTRAP_ADMIN")
            .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        let setup_admin_email = env::var("SETUP_ADMIN_EMAIL")
            .ok()
            .map(|v| v.trim().to_lowercase())
            .filter(|v| !v.is_empty());

        let setup_admin_password = env::var("SETUP_ADMIN_PASSWORD")
            .ok()
            .filter(|v| !v.is_empty());

        let twilio_auth_token = env::var("TWILIO_AUTH_TOKEN")
            .unwrap_or_else(|_| "mock_twilio_auth_token_for_dev_12345".to_string());

        let whatsapp_webhook_secret = env::var("WHATSAPP_WEBHOOK_SECRET")
            .unwrap_or_else(|_| "mock_webhook_secret_for_dev".to_string());

        let whatsapp_api_url = env::var("WHATSAPP_API_URL")
            .unwrap_or_else(|_| "http://localhost:8008".to_string());

        let whatsapp_api_key = env::var("WHATSAPP_API_KEY")
            .unwrap_or_else(|_| "mock_whatsapp_api_key_for_dev".to_string());

        Ok(Self {
            database_url,
            jwt_secret,
            jwt_refresh_secret,
            jwt_access_expiration,
            jwt_refresh_expiration,
            port,
            cors_origin,
            enable_swagger,
            login_rate_limit_per_minute,
            mutation_rate_limit_per_minute,
            read_rate_limit_per_minute,
            allow_bootstrap_admin,
            setup_admin_email,
            setup_admin_password,
            twilio_auth_token,
            whatsapp_webhook_secret,
            whatsapp_api_url,
            whatsapp_api_key,
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

use sqlx::PgPool;

use crate::config::AppConfig;
use crate::middleware::rate_limit::RateLimiter;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: AppConfig,
    pub login_limiter: RateLimiter,
    pub mutation_limiter: RateLimiter,
    pub read_limiter: RateLimiter,
}

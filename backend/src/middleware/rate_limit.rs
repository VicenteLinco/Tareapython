use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

/// Rate limiter de ventana deslizante en memoria.
/// Cada key (IP) tiene un vector de timestamps de requests recientes.
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

    /// Retorna true si el request está permitido, false si excede el límite.
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

    /// Limpieza periódica de entries viejos (llamar desde un task de fondo).
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

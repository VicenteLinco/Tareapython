use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;

use crate::db::AppState;
use crate::errors::AppError;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OpenwaWebhook {
    pub event: String,
    pub data: OpenwaMessageData,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OpenwaMessageData {
    pub id: String,
    pub body: String,
    pub from: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub timestamp: i64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct TwilioWebhook {
    #[serde(rename = "MessageSid")]
    pub message_sid: String,
    pub body: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct WebhookMessage {
    pub id: String,
    pub body: String,
    pub from: String,
    pub raw_payload: String,
}

/// Verifies pre-shared secret for OpenWA gateway
pub fn verify_openwa_secret(headers: &HeaderMap, expected_secret: &str) -> bool {
    if let Some(secret_header) = headers.get("X-Webhook-Secret") {
        if let Ok(secret_str) = secret_header.to_str() {
            return constant_time_eq(secret_str.as_bytes(), expected_secret.as_bytes());
        }
    }
    false
}

/// Verifies signature for Twilio webhook (HMAC-SHA1)
pub fn verify_twilio_signature(
    absolute_url: &str,
    post_params: &[(String, String)],
    auth_token: &str,
    expected_signature: &str,
) -> bool {
    let mut sorted_params = post_params.to_vec();
    sorted_params.sort_by(|a, b| a.0.cmp(&b.0));

    let mut data = absolute_url.to_string();
    for (k, v) in sorted_params {
        data.push_str(&k);
        data.push_str(&v);
    }

    let mut mac = HmacSha1::new_from_slice(auth_token.as_bytes())
        .expect("HMAC can accept keys of any length");
    mac.update(data.as_bytes());
    let result = mac.finalize();
    let computed_signature = BASE64_STANDARD.encode(result.into_bytes());

    constant_time_eq(computed_signature.as_bytes(), expected_signature.as_bytes())
}

/// Normalizes phone number (strips whatsapp: prefix and @domain suffix)
pub fn normalize_phone(phone: &str) -> String {
    let stripped = phone.strip_prefix("whatsapp:").unwrap_or(phone);
    if let Some(idx) = stripped.find('@') {
        stripped[..idx].to_string()
    } else {
        stripped.to_string()
    }
}

pub async fn webhook_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, StatusCode> {
    // 1. Determine provider & verify signature
    let msg = if headers.contains_key("X-Twilio-Signature") {
        let twilio_signature = headers
            .get("X-Twilio-Signature")
            .and_then(|h| h.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        let host = headers
            .get(axum::http::header::HOST)
            .and_then(|h| h.to_str().ok())
            .unwrap_or("localhost");
        let scheme = headers
            .get("x-forwarded-proto")
            .and_then(|s| s.to_str().ok())
            .unwrap_or("https");
        let absolute_url = format!("{}://{}{}", scheme, host, "/api/v1/webhooks/whatsapp");

        let post_params: Vec<(String, String)> = serde_urlencoded::from_bytes(&body)
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        if !verify_twilio_signature(&absolute_url, &post_params, &state.config.twilio_auth_token, twilio_signature) {
            return Err(StatusCode::UNAUTHORIZED);
        }

        let twilio_payload: TwilioWebhook = serde_urlencoded::from_bytes(&body)
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        WebhookMessage {
            id: twilio_payload.message_sid,
            body: twilio_payload.body,
            from: twilio_payload.from,
            raw_payload: String::from_utf8_lossy(&body).into_owned(),
        }
    } else if headers.contains_key("X-Webhook-Secret") {
        if !verify_openwa_secret(&headers, &state.config.whatsapp_webhook_secret) {
            return Err(StatusCode::UNAUTHORIZED);
        }

        let openwa_payload: OpenwaWebhook = serde_json::from_slice(&body)
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        if openwa_payload.event != "onMessage" {
            return Ok((StatusCode::OK, "Event ignored").into_response());
        }

        WebhookMessage {
            id: openwa_payload.data.id,
            body: openwa_payload.data.body,
            from: openwa_payload.data.from,
            raw_payload: String::from_utf8_lossy(&body).into_owned(),
        }
    } else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    // 2. Prevent Replay Attacks
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM whatsapp_webhook_logs WHERE message_id = $1)"
    )
        .bind(&msg.id)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(false);

    if exists {
        return Ok((StatusCode::ACCEPTED, "Duplicate request ignored").into_response());
    }

    // 3. Tokio spawn
    tokio::spawn(async move {
        if let Err(e) = process_message_async(state, msg).await {
            tracing::error!("Error processing WhatsApp webhook asynchronously: {:?}", e);
        }
    });

    Ok((StatusCode::ACCEPTED, "Processing request").into_response())
}

pub async fn process_message_async(_state: AppState, _msg: WebhookMessage) -> Result<(), AppError> {
    // Stub to be implemented in Slice 5
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(webhook_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_phone() {
        assert_eq!(normalize_phone("whatsapp:+56912345678"), "+56912345678");
        assert_eq!(normalize_phone("+56912345678@c.us"), "+56912345678");
        assert_eq!(normalize_phone("whatsapp:+56912345678@c.us"), "+56912345678");
        assert_eq!(normalize_phone("+56912345678"), "+56912345678");
    }

    #[test]
    fn test_verify_openwa_secret() {
        let mut headers = HeaderMap::new();
        headers.insert("X-Webhook-Secret", "secret123".parse().unwrap());
        assert!(verify_openwa_secret(&headers, "secret123"));
        assert!(!verify_openwa_secret(&headers, "wrongsecret"));

        let headers_empty = HeaderMap::new();
        assert!(!verify_openwa_secret(&headers_empty, "secret123"));
    }

    #[test]
    fn test_verify_twilio_signature() {
        let url = "https://mycompany.com/myapp.php?foo=1&bar=2";
        let params = vec![
            ("CallSid".to_string(), "CA1234567890ABCDE".to_string()),
            ("From".to_string(), "+14158675309".to_string()),
            ("To".to_string(), "+14158675310".to_string()),
        ];
        let auth_token = "12345";
        let expected_signature = "1qMcXsrGkX9+xuSpaazMGNpn9lM=";
        assert!(verify_twilio_signature(url, &params, auth_token, expected_signature));
    }
}

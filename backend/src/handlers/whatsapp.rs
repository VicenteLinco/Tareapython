use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;

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

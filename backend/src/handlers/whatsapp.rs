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
use std::sync::LazyLock;
use regex::Regex;

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

static RE_AYUDA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?i)AYUDA\s*$").unwrap()
});

static RE_VER_STOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?i)VER/STOCK\s+(?P<query>.+?)\s*$").unwrap()
});

static RE_RECIBIR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?i)RECIBIR\s+(?P<product>[A-Z0-9\-]+)\s+(?P<qty>\d+(\.\d{1,2})?)\s+(?P<lote>[A-Z0-9\-]+)\s+(?P<expiry>\d{4}-\d{2}-\d{2})\s+(?P<area>\d+)\s*$").unwrap()
});

static RE_CREAR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?i)CREAR\s+SOLICITUD\s+(?P<product>[A-Z0-9\-]+)\s+(?P<qty>\d+(\.\d{1,2})?)(?:\s+(?P<note>.+))?\s*$").unwrap()
});

#[derive(sqlx::FromRow, Debug)]
pub struct ActiveUser {
    id: uuid::Uuid,
    rol: String,
}

#[derive(sqlx::FromRow, Debug)]
pub struct StockRow {
    codigo_interno: String,
    producto_nombre: String,
    area_nombre: String,
    stock_total: rust_decimal::Decimal,
    unidad: String,
    proximo_vencimiento: Option<chrono::NaiveDate>,
}

#[derive(sqlx::FromRow, Debug)]
pub struct ProductResolution {
    producto_id: uuid::Uuid,
    producto_nombre: String,
    presentacion_id: Option<i32>,
    factor_conversion: rust_decimal::Decimal,
    unidad_basica_nombre: String,
}

pub async fn send_whatsapp_reply(
    config: &crate::config::AppConfig,
    to: &str,
    message: &str,
) -> Result<(), AppError> {
    let url = format!("{}/sendText", config.whatsapp_api_url);
    let payload = serde_json::json!({
        "to": to,
        "content": message,
    });

    let client = reqwest::Client::new();
    let mut request = client.post(&url);

    let key = &config.whatsapp_api_key;
    if !key.is_empty() && key != "mock_whatsapp_api_key_for_dev" {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.json(&payload).send().await {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::error!("WhatsApp sendText failed: Status={}, Body={}", status, text);
            }
        }
        Err(e) => {
            tracing::error!("Error sending WhatsApp reply: {:?}", e);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn log_webhook_transaction(
    pool: &sqlx::PgPool,
    message_id: &str,
    sender_phone: &str,
    usuario_id: Option<uuid::Uuid>,
    request_body: &str,
    command_type: Option<&str>,
    status: &str,
    response_body: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO whatsapp_webhook_logs 
           (message_id, sender_phone, usuario_id, request_body, command_type, status, response_body)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#
    )
    .bind(message_id)
    .bind(sender_phone)
    .bind(usuario_id)
    .bind(request_body)
    .bind(command_type)
    .bind(status)
    .bind(response_body)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn handle_ver_stock(
    state: &AppState,
    msg: &WebhookMessage,
    sender_phone: &str,
    user: &ActiveUser,
    query: &str,
) -> Result<(), AppError> {
    let ilike_query = format!("%{}%", query);
    
    let rows_res = sqlx::query_as::<_, StockRow>(
        r#"SELECT
            v.codigo_interno,
            v.producto_nombre,
            v.area_nombre,
            v.stock_total,
            v.unidad,
            v.proximo_vencimiento
           FROM v_stock_por_producto_area v
           WHERE (v.codigo_interno ILIKE $1 OR v.producto_nombre ILIKE $1)
             AND (
                 $2 = 'admin' OR 
                 EXISTS (
                     SELECT 1 FROM usuario_area ua 
                     WHERE ua.usuario_id = $3 AND ua.area_id = v.area_id
                 )
             )
           ORDER BY v.producto_nombre, v.codigo_interno, v.area_nombre"#
    )
    .bind(&ilike_query)
    .bind(&user.rol)
    .bind(user.id)
    .fetch_all(&state.pool)
    .await;

    let rows = match rows_res {
        Ok(r) => r,
        Err(e) => {
            let error_msg = "Ocurrió un error al consultar el stock.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("STOCK"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if rows.is_empty() {
        let no_stock_msg = format!("No se encontró stock para la búsqueda: '{}'.", query);
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("STOCK"),
            "SUCCESS",
            Some(&no_stock_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, &no_stock_msg).await;
        return Ok(());
    }

    let mut reply = format!("Resultados de stock para '{}':\n", query);
    let mut current_product = String::new();
    for row in rows {
        let prod_header = format!("\n*{}* (Código: {})\n", row.producto_nombre, row.codigo_interno);
        if prod_header != current_product {
            reply.push_str(&prod_header);
            current_product = prod_header;
        }
        let vencimiento_str = match row.proximo_vencimiento {
            Some(date) => date.format("%Y-%m-%d").to_string(),
            None => "N/A".to_string(),
        };
        reply.push_str(&format!(
            " - Área: {} | Stock: {} {} | Próx. Vencimiento: {}\n",
            row.area_nombre, row.stock_total, row.unidad, vencimiento_str
        ));
    }

    let _ = log_webhook_transaction(
        &state.pool,
        &msg.id,
        sender_phone,
        Some(user.id),
        &msg.raw_payload,
        Some("STOCK"),
        "SUCCESS",
        Some(&reply),
    ).await;

    let _ = send_whatsapp_reply(&state.config, &msg.from, &reply).await;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn handle_recibir(
    state: &AppState,
    msg: &WebhookMessage,
    sender_phone: &str,
    user: &ActiveUser,
    product_code: &str,
    qty_str: &str,
    lote_num: &str,
    expiry_str: &str,
    area_str: &str,
) -> Result<(), AppError> {
    use std::str::FromStr;

    let area_id = match i32::from_str(area_str) {
        Ok(id) => id,
        Err(_) => {
            let error_msg = format!("Error: El área ID '{}' no es un número válido.", area_str);
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "SYNTAX_ERROR",
                Some(&error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
            return Ok(());
        }
    };

    let qty_dec = match rust_decimal::Decimal::from_str(qty_str) {
        Ok(q) => {
            if q.scale() > 2 {
                let error_msg = "Error: La cantidad no puede tener más de 2 decimales.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "SYNTAX_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Ok(());
            }
            if q <= rust_decimal::Decimal::ZERO {
                let error_msg = "Error: La cantidad debe ser mayor a cero.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "SYNTAX_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Ok(());
            }
            q
        }
        Err(_) => {
            let error_msg = format!("Error: La cantidad '{}' no es un número válido.", qty_str);
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "SYNTAX_ERROR",
                Some(&error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
            return Ok(());
        }
    };

    let expiry_date = match chrono::NaiveDate::parse_from_str(expiry_str, "%Y-%m-%d") {
        Ok(date) => {
            let today = chrono::Utc::now().date_naive();
            if date <= today {
                let error_msg = format!("Error: La fecha de vencimiento '{}' debe ser futura.", expiry_str);
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "SYNTAX_ERROR",
                    Some(&error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
                return Ok(());
            }
            date
        }
        Err(_) => {
            let error_msg = format!("Error: La fecha de vencimiento '{}' no tiene el formato AAAA-MM-DD.", expiry_str);
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "SYNTAX_ERROR",
                Some(&error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
            return Ok(());
        }
    };

    if user.rol != "admin" {
        let has_access = match sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM usuario_area WHERE usuario_id = $1 AND area_id = $2)"
        )
        .bind(user.id)
        .bind(area_id)
        .fetch_one(&state.pool)
        .await {
            Ok(access) => access,
            Err(e) => {
                let error_msg = "Ocurrió un error al verificar los accesos del área.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "DB_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Err(e.into());
            }
        };

        if !has_access {
            let error_msg = format!("Error: No tiene autorización para ingresar stock en el área ID {}.", area_id);
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "UNAUTHORIZED",
                Some(&error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
            return Ok(());
        }
    }

    let area_exists = match sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM areas WHERE id = $1)"
    )
    .bind(area_id)
    .fetch_one(&state.pool)
    .await {
        Ok(exists) => exists,
        Err(e) => {
            let error_msg = "Ocurrió un error al verificar el área.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if !area_exists {
        let error_msg = format!("Error: El área ID {} no existe.", area_id);
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("RECIBIR"),
            "SYNTAX_ERROR",
            Some(&error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
        return Ok(());
    }

    let resolved_opt = match sqlx::query_as::<_, ProductResolution>(
        r#"SELECT 
            p.id AS producto_id, 
            p.nombre AS producto_nombre,
            NULL::INT AS presentacion_id, 
            1.0::NUMERIC AS factor_conversion, 
            ub.nombre AS unidad_basica_nombre
        FROM productos p
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE p.codigo_interno = $1 AND p.activo = true"#
    )
    .bind(product_code)
    .fetch_optional(&state.pool)
    .await {
        Ok(res) => res,
        Err(e) => {
            let error_msg = "Ocurrió un error al buscar el producto.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let resolved = match resolved_opt {
        Some(res) => res,
        None => {
            let pres_opt = match sqlx::query_as::<_, ProductResolution>(
                r#"SELECT 
                    pres.producto_id AS producto_id, 
                    p.nombre AS producto_nombre,
                    pres.id AS presentacion_id, 
                    pres.factor_conversion, 
                    ub.nombre AS unidad_basica_nombre
                FROM presentaciones pres
                JOIN productos p ON p.id = pres.producto_id
                JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
                WHERE pres.codigo_barras = $1 AND pres.activa = true AND p.activo = true"#
            )
            .bind(product_code)
            .fetch_optional(&state.pool)
            .await {
                Ok(res) => res,
                Err(e) => {
                    let error_msg = "Ocurrió un error al buscar la presentación.";
                    let _ = log_webhook_transaction(
                        &state.pool,
                        &msg.id,
                        sender_phone,
                        Some(user.id),
                        &msg.raw_payload,
                        Some("RECIBIR"),
                        "DB_ERROR",
                        Some(error_msg),
                    ).await;
                    let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                    return Err(e.into());
                }
            };

            match pres_opt {
                Some(res) => res,
                None => {
                    let error_msg = format!("Error: No se encontró un producto activo con código o código de barras '{}'.", product_code);
                    let _ = log_webhook_transaction(
                        &state.pool,
                        &msg.id,
                        sender_phone,
                        Some(user.id),
                        &msg.raw_payload,
                        Some("RECIBIR"),
                        "SYNTAX_ERROR",
                        Some(&error_msg),
                    ).await;
                    let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
                    return Ok(());
                }
            }
        }
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            let error_msg = "Ocurrió un error al iniciar la transacción.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let mut provider_id: Option<i32> = match sqlx::query_scalar::<_, i32>(
        r#"SELECT pp.proveedor_id
           FROM producto_proveedor pp
           JOIN proveedores prov ON prov.id = pp.proveedor_id
           WHERE pp.producto_id = $1 AND pp.es_principal = true AND pp.activo = true AND prov.activa = true"#
    )
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await {
        Ok(id) => id,
        Err(e) => {
            let error_msg = "Error al buscar el proveedor principal.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if provider_id.is_none() {
        provider_id = match sqlx::query_scalar::<_, i32>(
            r#"SELECT pp.proveedor_id
               FROM producto_proveedor pp
               JOIN proveedores prov ON prov.id = pp.proveedor_id
               WHERE pp.producto_id = $1 AND pp.activo = true AND prov.activa = true
               LIMIT 1"#
        )
        .bind(resolved.producto_id)
        .fetch_optional(&mut *tx)
        .await {
            Ok(id) => id,
            Err(e) => {
                let error_msg = "Error al buscar proveedores activos del producto.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "DB_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Err(e.into());
            }
        };
    }

    if provider_id.is_none() {
        provider_id = match sqlx::query_scalar::<_, i32>(
            "SELECT id FROM proveedores ORDER BY id ASC LIMIT 1"
        )
        .fetch_optional(&mut *tx)
        .await {
            Ok(id) => id,
            Err(e) => {
                let error_msg = "Error al buscar primer proveedor en el sistema.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("RECIBIR"),
                    "DB_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Err(e.into());
            }
        };
    }

    let provider_id = match provider_id {
        Some(id) => id,
        None => {
            let error_msg = "Error: No se encontró ningún proveedor en el sistema.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Ok(());
        }
    };

    let insert_reception_res: Result<(uuid::Uuid, String), sqlx::Error> = sqlx::query_as(
        "INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
         VALUES ($1, $2, 'completa', NOW(), $3, $4)
         RETURNING id, numero_documento"
    )
    .bind(provider_id)
    .bind(&msg.id)
    .bind(user.id)
    .bind("Ingreso vía WhatsApp")
    .fetch_one(&mut *tx)
    .await;

    let (recepcion_id, numero_documento) = match insert_reception_res {
        Ok(res) => res,
        Err(e) => {
            let error_msg = "Error: Falló la creación del registro de recepción.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let insert_lot_res: Result<(uuid::Uuid, String), sqlx::Error> = sqlx::query_as(
        r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno)
           VALUES ($1, $2, $3, $4, 'L' || LPAD(nextval('seq_lot_numero')::text, 6, '0'))
           ON CONFLICT (producto_id, proveedor_id, numero_lote)
           DO UPDATE SET fecha_vencimiento = EXCLUDED.fecha_vencimiento
           RETURNING id, codigo_interno"#
    )
    .bind(resolved.producto_id)
    .bind(provider_id)
    .bind(lote_num)
    .bind(expiry_date)
    .fetch_one(&mut *tx)
    .await;

    let (lote_id, lot_codigo_interno) = match insert_lot_res {
        Ok(res) => res,
        Err(e) => {
            let error_msg = "Error: Falló el registro del lote.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let cantidad_base = qty_dec * resolved.factor_conversion;

    let insert_detail_res = sqlx::query(
        r#"INSERT INTO recepcion_detalle 
           (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id, cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#
    )
    .bind(recepcion_id)
    .bind(resolved.producto_id)
    .bind(lote_id)
    .bind(resolved.presentacion_id)
    .bind(area_id)
    .bind(qty_dec)
    .bind(resolved.factor_conversion)
    .bind(cantidad_base)
    .execute(&mut *tx)
    .await;

    if let Err(e) = insert_detail_res {
        let error_msg = "Error: Falló el registro del detalle de la recepción.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("RECIBIR"),
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e.into());
    }

    let link_area_res = sqlx::query(
        "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(resolved.producto_id)
    .bind(area_id)
    .execute(&mut *tx)
    .await;

    if let Err(e) = link_area_res {
        let error_msg = "Error: Falló el enlace de producto y área.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("RECIBIR"),
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e.into());
    }

    let apply_res = crate::services::stock_ops::aplicar_ingreso(
        &mut tx,
        lote_id,
        area_id,
        cantidad_base,
        user.id,
        "INGRESO",
        Some(recepcion_id),
        Some("Ingreso vía WhatsApp"),
        Some("RECEPCION"),
    )
    .await;

    if let Err(e) = apply_res {
        let error_msg = "Error: Falló la aplicación de ingreso al stock.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("RECIBIR"),
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e);
    }

    if let Err(e) = tx.commit().await {
        let error_msg = "Error: Falló el commit de la transacción.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("RECIBIR"),
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e.into());
    }

    let success_msg = format!(
        "Recepción {} registrada exitosamente.\n\
         Producto: {}\n\
         Cantidad: {} {}\n\
         Lote: {} ({})\n\
         Área ID: {}",
        numero_documento,
        resolved.producto_nombre,
        qty_dec,
        resolved.unidad_basica_nombre,
        lote_num,
        lot_codigo_interno,
        area_id
    );

    let _ = log_webhook_transaction(
        &state.pool,
        &msg.id,
        sender_phone,
        Some(user.id),
        &msg.raw_payload,
        Some("RECIBIR"),
        "SUCCESS",
        Some(&success_msg),
    ).await;

    let _ = send_whatsapp_reply(&state.config, &msg.from, &success_msg).await;
    Ok(())
}

pub async fn handle_crear_solicitud(
    state: &AppState,
    msg: &WebhookMessage,
    sender_phone: &str,
    user: &ActiveUser,
    product_code: &str,
    qty_str: &str,
    _note: Option<&str>,
) -> Result<(), AppError> {
    use std::str::FromStr;

    let qty_dec = match rust_decimal::Decimal::from_str(qty_str) {
        Ok(q) => {
            if q <= rust_decimal::Decimal::ZERO {
                let error_msg = "Error: La cantidad sugerida debe ser mayor a cero.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("CREAR"),
                    "SYNTAX_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Ok(());
            }
            q
        }
        Err(_) => {
            let error_msg = format!("Error: La cantidad '{}' no es un número válido.", qty_str);
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "SYNTAX_ERROR",
                Some(&error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
            return Ok(());
        }
    };

    let resolved_opt = match sqlx::query_as::<_, ProductResolution>(
        r#"SELECT 
            p.id AS producto_id, 
            p.nombre AS producto_nombre,
            NULL::INT AS presentacion_id, 
            1.0::NUMERIC AS factor_conversion, 
            ub.nombre AS unidad_basica_nombre
        FROM productos p
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE p.codigo_interno = $1 AND p.activo = true"#
    )
    .bind(product_code)
    .fetch_optional(&state.pool)
    .await {
        Ok(res) => res,
        Err(e) => {
            let error_msg = "Ocurrió un error al buscar el producto.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let resolved = match resolved_opt {
        Some(res) => res,
        None => {
            let pres_opt = match sqlx::query_as::<_, ProductResolution>(
                r#"SELECT 
                    pres.producto_id AS producto_id, 
                    p.nombre AS producto_nombre,
                    pres.id AS presentacion_id, 
                    pres.factor_conversion, 
                    ub.nombre AS unidad_basica_nombre
                FROM presentaciones pres
                JOIN productos p ON p.id = pres.producto_id
                JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
                WHERE pres.codigo_barras = $1 AND pres.activa = true AND p.activo = true"#
            )
            .bind(product_code)
            .fetch_optional(&state.pool)
            .await {
                Ok(res) => res,
                Err(e) => {
                    let error_msg = "Ocurrió un error al buscar la presentación.";
                    let _ = log_webhook_transaction(
                        &state.pool,
                        &msg.id,
                        sender_phone,
                        Some(user.id),
                        &msg.raw_payload,
                        Some("CREAR"),
                        "DB_ERROR",
                        Some(error_msg),
                    ).await;
                    let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                    return Err(e.into());
                }
            };

            match pres_opt {
                Some(res) => res,
                None => {
                    let error_msg = format!("Error: No se encontró un producto activo con código o código de barras '{}'.", product_code);
                    let _ = log_webhook_transaction(
                        &state.pool,
                        &msg.id,
                        sender_phone,
                        Some(user.id),
                        &msg.raw_payload,
                        Some("CREAR"),
                        "SYNTAX_ERROR",
                        Some(&error_msg),
                    ).await;
                    let _ = send_whatsapp_reply(&state.config, &msg.from, &error_msg).await;
                    return Ok(());
                }
            }
        }
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            let error_msg = "Ocurrió un error al iniciar la transacción.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let solicitud_id_res = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM solicitudes_compra WHERE usuario_id = $1 AND estado = 'borrador'"
    )
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await;

    let mut solicitud_id = match solicitud_id_res {
        Ok(id) => id,
        Err(e) => {
            let error_msg = "Error al buscar solicitud de compra existente.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if solicitud_id.is_none() {
        let insert_sol_res = sqlx::query_scalar::<_, uuid::Uuid>(
            "INSERT INTO solicitudes_compra (usuario_id, nota, estado) VALUES ($1, 'Borrador WhatsApp', 'borrador') RETURNING id"
        )
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await;

        solicitud_id = match insert_sol_res {
            Ok(id) => Some(id),
            Err(e) => {
                let error_msg = "Error al crear nueva solicitud de compra borrador.";
                let _ = log_webhook_transaction(
                    &state.pool,
                    &msg.id,
                    sender_phone,
                    Some(user.id),
                    &msg.raw_payload,
                    Some("CREAR"),
                    "DB_ERROR",
                    Some(error_msg),
                ).await;
                let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
                return Err(e.into());
            }
        };
    }
    let solicitud_id = solicitud_id.unwrap();

    let existing_qty_res = sqlx::query_scalar::<_, rust_decimal::Decimal>(
        "SELECT cantidad_sugerida FROM solicitud_compra_detalle WHERE solicitud_id = $1 AND producto_id = $2"
    )
    .bind(solicitud_id)
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await;

    let existing_qty = match existing_qty_res {
        Ok(qty) => qty,
        Err(e) => {
            let error_msg = "Error al verificar detalles de solicitud de compra.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if existing_qty.is_some() {
        let update_res = sqlx::query(
            "UPDATE solicitud_compra_detalle SET cantidad_sugerida = cantidad_sugerida + $3 WHERE solicitud_id = $1 AND producto_id = $2"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(qty_dec)
        .execute(&mut *tx)
        .await;

        if let Err(e) = update_res {
            let error_msg = "Error al actualizar detalle de la solicitud de compra.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    } else {
        let insert_detail_res = sqlx::query(
            "INSERT INTO solicitud_compra_detalle (solicitud_id, producto_id, cantidad_sugerida, unidad) VALUES ($1, $2, $3, $4)"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(qty_dec)
        .bind(&resolved.unidad_basica_nombre)
        .execute(&mut *tx)
        .await;

        if let Err(e) = insert_detail_res {
            let error_msg = "Error al registrar detalle de la solicitud de compra.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("CREAR"),
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    }

    if let Err(e) = tx.commit().await {
        let error_msg = "Error al confirmar la transacción.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("CREAR"),
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e.into());
    }

    let success_msg = format!(
        "Solicitud de compra borrador actualizada exitosamente.\n\
         Producto: {}\n\
         Cantidad Agregada: {} {}",
        resolved.producto_nombre,
        qty_dec,
        resolved.unidad_basica_nombre
    );

    let _ = log_webhook_transaction(
        &state.pool,
        &msg.id,
        sender_phone,
        Some(user.id),
        &msg.raw_payload,
        Some("CREAR"),
        "SUCCESS",
        Some(&success_msg),
    ).await;

    let _ = send_whatsapp_reply(&state.config, &msg.from, &success_msg).await;
    Ok(())
}

pub async fn process_message_async(state: AppState, msg: WebhookMessage) -> Result<(), AppError> {
    let sender_phone = normalize_phone(&msg.from);

    let user_res = sqlx::query_as::<_, ActiveUser>(
        "SELECT id, rol FROM usuarios WHERE whatsapp_phone = $1 AND activo = true"
    )
    .bind(&sender_phone)
    .fetch_optional(&state.pool)
    .await;

    let user = match user_res {
        Ok(Some(u)) => u,
        Ok(None) => {
            let access_denied_msg = "Acceso denegado: Su número de WhatsApp no está registrado o está inactivo.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                None,
                &msg.raw_payload,
                None,
                "UNAUTHORIZED",
                Some(access_denied_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, access_denied_msg).await;
            return Ok(());
        }
        Err(e) => {
            tracing::error!("Database error finding user: {:?}", e);
            let error_msg = "Ocurrió un error en el servidor al verificar su cuenta.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                None,
                &msg.raw_payload,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    if RE_AYUDA.is_match(&msg.body) {
        let help_msg = "Comandos disponibles:\n\
                        1. AYUDA: Muestra este mensaje de ayuda.\n\
                        2. VER/STOCK <busqueda>: Muestra el stock del producto.\n\
                        3. RECIBIR <producto> <cantidad> <lote> <AAAA-MM-DD> <area_id>: Registra ingreso de stock.\n\
                        4. CREAR SOLICITUD <producto> <cantidad> [nota]: Crea una solicitud de compra borrador.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            &sender_phone,
            Some(user.id),
            &msg.raw_payload,
            Some("AYUDA"),
            "SUCCESS",
            Some(help_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, help_msg).await;
        return Ok(());
    }

    if let Some(caps) = RE_VER_STOCK.captures(&msg.body) {
        let query = caps.name("query").map(|m| m.as_str().trim()).unwrap_or("");
        if let Err(e) = handle_ver_stock(&state, &msg, &sender_phone, &user, query).await {
            tracing::error!("Error in handle_ver_stock: {:?}", e);
            return Err(e);
        }
        return Ok(());
    }

    if let Some(caps) = RE_RECIBIR.captures(&msg.body) {
        if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
            let unauthorized_msg = "No autorizado: Requiere rol tecnologo o admin para recibir stock.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                Some(user.id),
                &msg.raw_payload,
                Some("RECIBIR"),
                "UNAUTHORIZED",
                Some(unauthorized_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, unauthorized_msg).await;
            return Ok(());
        }

        let product = caps.name("product").map(|m| m.as_str().trim()).unwrap_or("");
        let qty = caps.name("qty").map(|m| m.as_str().trim()).unwrap_or("");
        let lote = caps.name("lote").map(|m| m.as_str().trim()).unwrap_or("");
        let expiry = caps.name("expiry").map(|m| m.as_str().trim()).unwrap_or("");
        let area = caps.name("area").map(|m| m.as_str().trim()).unwrap_or("");

        if let Err(e) = handle_recibir(&state, &msg, &sender_phone, &user, product, qty, lote, expiry, area).await {
            tracing::error!("Error in handle_recibir: {:?}", e);
            return Err(e);
        }
        return Ok(());
    }

    if let Some(caps) = RE_CREAR.captures(&msg.body) {
        let product = caps.name("product").map(|m| m.as_str().trim()).unwrap_or("");
        let qty = caps.name("qty").map(|m| m.as_str().trim()).unwrap_or("");
        let note = caps.name("note").map(|m| m.as_str().trim());

        if let Err(e) = handle_crear_solicitud(&state, &msg, &sender_phone, &user, product, qty, note).await {
            tracing::error!("Error in handle_crear_solicitud: {:?}", e);
            return Err(e);
        }
        return Ok(());
    }

    let invalid_format_msg = "Formato de comando inválido. Envíe 'AYUDA' para ver los comandos disponibles.";
    let _ = log_webhook_transaction(
        &state.pool,
        &msg.id,
        &sender_phone,
        Some(user.id),
        &msg.raw_payload,
        Some("INVALIDO"),
        "SYNTAX_ERROR",
        Some(invalid_format_msg),
    ).await;
    let _ = send_whatsapp_reply(&state.config, &msg.from, invalid_format_msg).await;

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
    fn test_regex_patterns() {
        assert!(RE_AYUDA.is_match("AYUDA"));
        assert!(RE_AYUDA.is_match("  ayuda  "));
        assert!(!RE_AYUDA.is_match("AYUDAR"));

        assert!(RE_VER_STOCK.is_match("VER/STOCK paracetamol"));
        assert!(RE_VER_STOCK.is_match("  ver/stock   ibuprofeno  "));
        assert!(!RE_VER_STOCK.is_match("VER/STOCK"));

        assert!(RE_RECIBIR.is_match("RECIBIR P-001 10.5 L-123 2026-12-31 2"));
        assert!(RE_RECIBIR.is_match("recibir P-001 10 L-123 2026-12-31 2"));
        assert!(!RE_RECIBIR.is_match("RECIBIR P-001 10.555 L-123 2026-12-31 2"));

        assert!(RE_CREAR.is_match("CREAR SOLICITUD P-001 5"));
        assert!(RE_CREAR.is_match("crear solicitud P-001 5.5 nota especial"));
        assert!(!RE_CREAR.is_match("CREAR SOLICITUD P-001"));
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

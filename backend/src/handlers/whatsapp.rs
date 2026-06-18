use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Router,
};
use serde::{Deserialize, Serialize};
use constant_time_eq::constant_time_eq;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;

pub use crate::services::whatsapp_service::{
    ActiveUser, WhatsappSettings, BuscarStockArgs, BuscarStockResult, StockItemResult,
    RegistrarIngresoArgs, RegistrarIngresoResult, CrearSolicitudCompraArgs, CrearSolicitudCompraResult,
    RegistrarConsumoArgs, WebhookLogEntry, ProductResolution
};
use crate::services::whatsapp_service;
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

/// Normalizes phone number (strips whatsapp: prefix, @domain suffix, and spaces/dashes)
pub fn normalize_phone(phone: &str) -> String {
    let stripped = phone.strip_prefix("whatsapp:").unwrap_or(phone);
    let stripped = if let Some(idx) = stripped.find('@') {
        &stripped[..idx]
    } else {
        stripped
    };
    let trimmed = stripped.trim();
    let mut normalized = String::new();
    if trimmed.starts_with('+') {
        normalized.push('+');
    }
    for c in trimmed.chars() {
        if c.is_ascii_digit() {
            normalized.push(c);
        }
    }
    normalized
}

pub async fn load_whatsapp_settings(pool: &sqlx::PgPool) -> Result<WhatsappSettings, AppError> {
    whatsapp_service::load_whatsapp_settings(pool).await
}

pub async fn send_whatsapp_reply(
    pool: &sqlx::PgPool,
    config: &crate::config::AppConfig,
    to: &str,
    message: &str,
) -> Result<(), AppError> {
    let settings = load_whatsapp_settings(pool).await.unwrap_or_else(|_| {
        WhatsappSettings {
            api_url: config.whatsapp_api_url.clone(),
            api_key: config.whatsapp_api_key.clone(),
            webhook_secret: config.whatsapp_webhook_secret.clone(),
            bot_phone: String::new(),
        }
    });

    let url = format!("{}/sendText", settings.api_url);
    let payload = serde_json::json!({
        "to": to,
        "content": message,
    });

    let client = reqwest::Client::new();
    let mut request = client.post(&url);

    let key = &settings.api_key;
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
    whatsapp_service::log_webhook_transaction(
        pool,
        message_id,
        sender_phone,
        usuario_id,
        request_body,
        command_type,
        status,
        response_body,
    )
    .await
}

pub async fn execute_tool(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    tool_name: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    match tool_name {
        "buscar_stock" => {
            let args: BuscarStockArgs = serde_json::from_value(args)
                .map_err(|e| AppError::Internal(format!("Invalid arguments for buscar_stock: {}", e)))?;
            let res = execute_buscar_stock(pool, user, args).await?;
            Ok(serde_json::to_value(res).map_err(|e| AppError::Internal(e.to_string()))?)
        }
        "registrar_ingreso" => {
            let args: RegistrarIngresoArgs = serde_json::from_value(args)
                .map_err(|e| AppError::Internal(format!("Invalid arguments for registrar_ingreso: {}", e)))?;
            let res = execute_registrar_ingreso(pool, user, args).await?;
            Ok(serde_json::to_value(res).map_err(|e| AppError::Internal(e.to_string()))?)
        }
        "registrar_consumo" => {
            let args: RegistrarConsumoArgs = serde_json::from_value(args)
                .map_err(|e| AppError::Internal(format!("Invalid arguments for registrar_consumo: {}", e)))?;
            let res = execute_registrar_consumo(pool, user, args).await?;
            Ok(res)
        }
        "crear_solicitud_compra" => {
            let args: CrearSolicitudCompraArgs = serde_json::from_value(args)
                .map_err(|e| AppError::Internal(format!("Invalid arguments for crear_solicitud_compra: {}", e)))?;
            let res = execute_crear_solicitud_compra(pool, user, args).await?;
            Ok(serde_json::to_value(res).map_err(|e| AppError::Internal(e.to_string()))?)
        }
        _ => Err(AppError::Internal(format!("Unknown tool: {}", tool_name))),
    }
}

pub async fn execute_buscar_stock(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: BuscarStockArgs,
) -> Result<BuscarStockResult, AppError> {
    whatsapp_service::buscar_stock_tool(pool, user, args).await
}

pub async fn resolve_product(
    pool: &sqlx::PgPool,
    ident: &str,
) -> Result<Result<ProductResolution, String>, AppError> {
    whatsapp_service::resolve_product_by_code(pool, ident).await
}

pub async fn execute_registrar_ingreso(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: RegistrarIngresoArgs,
) -> Result<RegistrarIngresoResult, AppError> {
    whatsapp_service::registrar_recepcion_tool(pool, user, args).await
}

pub async fn execute_crear_solicitud_compra(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: CrearSolicitudCompraArgs,
) -> Result<CrearSolicitudCompraResult, AppError> {
    whatsapp_service::add_to_purchase_request_tool(pool, user, args).await
}

pub async fn execute_registrar_consumo(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: RegistrarConsumoArgs,
) -> Result<serde_json::Value, AppError> {
    whatsapp_service::registrar_consumo_fefo_tool(pool, user, args).await
}

pub async fn webhook_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, StatusCode> {
    let wa_settings = load_whatsapp_settings(&state.pool).await.unwrap_or_else(|_| {
        WhatsappSettings {
            api_url: state.config.whatsapp_api_url.clone(),
            api_key: state.config.whatsapp_api_key.clone(),
            webhook_secret: state.config.whatsapp_webhook_secret.clone(),
            bot_phone: String::new(),
        }
    });

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
        if !verify_openwa_secret(&headers, &wa_settings.webhook_secret) {
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

    let exists = whatsapp_service::webhook_log_exists(&state.pool, &msg.id).await.unwrap_or(false);

    if exists {
        return Ok((StatusCode::ACCEPTED, "Duplicate request ignored").into_response());
    }

    tokio::spawn(async move {
        if let Err(e) = process_message_async(state, msg).await {
            tracing::error!("Error processing WhatsApp webhook asynchronously: {:?}", e);
        }
    });

    Ok((StatusCode::ACCEPTED, "Processing request").into_response())
}

pub async fn process_message_async(state: AppState, msg: WebhookMessage) -> Result<(), AppError> {
    let sender_phone = normalize_phone(&msg.from);

    let user_res = whatsapp_service::get_active_user_by_phone(&state.pool, &sender_phone).await;

    let user = match user_res {
        Ok(Some(u)) => u,
        Ok(None) => {
            let access_denied_msg = "Acceso denegado: Su número de WhatsApp no está registrado o está inactivo.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                None,
                &msg.body,
                None,
                "UNAUTHORIZED",
                Some(access_denied_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.pool, &state.config, &msg.from, access_denied_msg).await;
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
                &msg.body,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.pool, &state.config, &msg.from, error_msg).await;
            return Err(e.into());
        }
    };

    let llm_config = match crate::services::llm::load_llm_config(&state.pool).await {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::error!("Failed to load LLM config: {:?}", e);
            let error_msg = "Error al cargar la configuración del asistente de IA.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                Some(user.id),
                &msg.body,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.pool, &state.config, &msg.from, error_msg).await;
            return Err(e);
        }
    };

    let client = match crate::services::llm::LlmFactory::create(llm_config) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to create LLM client: {:?}", e);
            let error_msg = "Error al inicializar el asistente de IA.";
            let _ = log_webhook_transaction(
                &state.pool,
                &msg.id,
                &sender_phone,
                Some(user.id),
                &msg.body,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.pool, &state.config, &msg.from, error_msg).await;
            return Err(e);
        }
    };

    let system_prompt = crate::services::llm::get_system_prompt();

    if let Err(e) = client.chat_with_tools(
        &system_prompt,
        &msg.body,
        &state.pool,
        &user,
        &msg.id,
        &sender_phone,
        &msg.raw_payload,
        &msg.from,
        &state.config,
    ).await {
        tracing::error!("LLM chat session failed: {:?}", e);
        let error_msg = "Disculpe, ocurrió un error al procesar su mensaje con el asistente de IA.";
        let _ = log_webhook_transaction(
            &state.pool,
            &msg.id,
            &sender_phone,
            Some(user.id),
            &msg.body,
            None,
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.pool, &state.config, &msg.from, error_msg).await;
        return Err(e);
    }

    Ok(())
}

pub async fn get_logs_handler(
    State(state): State<AppState>,
) -> Result<axum::Json<Vec<WebhookLogEntry>>, AppError> {
    let logs = whatsapp_service::get_logs(&state.pool).await?;
    Ok(axum::Json(logs))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", axum::routing::post(webhook_handler))
        .route("/logs", axum::routing::get(get_logs_handler))
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
        assert_eq!(normalize_phone("+56 9 1234 5678"), "+56912345678");
        assert_eq!(normalize_phone("56912345678"), "56912345678");
        assert_eq!(normalize_phone("  +56-9-1234-5678  "), "+56912345678");
        assert_eq!(normalize_phone("+"), "+");
        assert_eq!(normalize_phone(""), "");
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

    #[sqlx::test(migrations = "./migrations")]
    async fn test_execute_tool_validation_and_early_errors(pool: sqlx::PgPool) {
        let admin_user = ActiveUser {
            id: uuid::Uuid::new_v4(),
            rol: "admin".to_string(),
        };
        let normal_user = ActiveUser {
            id: uuid::Uuid::new_v4(),
            rol: "user".to_string(),
        };

        // 1. RBAC on execute_buscar_stock
        let search_args = BuscarStockArgs {
            busqueda: "paracetamol".to_string(),
        };
        let err_res = execute_buscar_stock(&pool, &normal_user, search_args.clone()).await;
        assert!(err_res.is_err());
        match err_res.unwrap_err() {
            AppError::Forbidden(msg) => assert!(msg.contains("No autorizado")),
            _ => panic!("Expected Forbidden error"),
        }

        let ok_res = execute_buscar_stock(&pool, &admin_user, search_args.clone()).await;
        assert!(ok_res.is_ok());

        // 2. RBAC on execute_registrar_ingreso
        let registrar_args = RegistrarIngresoArgs {
            producto: "PRD-123".to_string(),
            cantidad: rust_decimal::Decimal::new(10, 0),
            lote: "L-99".to_string(),
            vencimiento: "2030-01-01".to_string(),
            area_id: 1,
        };
        let rbac_fail = execute_registrar_ingreso(&pool, &normal_user, registrar_args.clone()).await.unwrap();
        assert_eq!(rbac_fail.status, "error");
        assert!(rbac_fail.message.contains("No autorizado"));

        // 3. Quantity validation <= 0
        let mut invalid_qty_args = registrar_args.clone();
        invalid_qty_args.cantidad = rust_decimal::Decimal::new(-5, 0);
        let qty_fail = execute_registrar_ingreso(&pool, &admin_user, invalid_qty_args).await.unwrap();
        assert_eq!(qty_fail.status, "error");
        assert!(qty_fail.message.contains("mayor a cero"));

        // 4. Decimal scale > 2
        let mut invalid_scale_args = registrar_args.clone();
        invalid_scale_args.cantidad = rust_decimal::Decimal::new(10123, 3); // 10.123
        let scale_fail = execute_registrar_ingreso(&pool, &admin_user, invalid_scale_args).await.unwrap();
        assert_eq!(scale_fail.status, "error");
        assert!(scale_fail.message.contains("2 decimales"));

        // 5. Expiry date past date
        let mut past_expiry_args = registrar_args.clone();
        past_expiry_args.vencimiento = "2020-01-01".to_string();
        let past_fail = execute_registrar_ingreso(&pool, &admin_user, past_expiry_args).await.unwrap();
        assert_eq!(past_fail.status, "error");
        assert!(past_fail.message.contains("debe ser futura"));

        // 6. Expiry date invalid format
        let mut invalid_format_args = registrar_args.clone();
        invalid_format_args.vencimiento = "01-01-2030".to_string();
        let format_fail = execute_registrar_ingreso(&pool, &admin_user, invalid_format_args).await.unwrap();
        assert_eq!(format_fail.status, "error");
        assert!(format_fail.message.contains("formato AAAA-MM-DD"));

        // 7. Area non-existent
        let mut non_existent_area_args = registrar_args.clone();
        non_existent_area_args.area_id = 99999;
        let area_fail = execute_registrar_ingreso(&pool, &admin_user, non_existent_area_args).await.unwrap();
        assert_eq!(area_fail.status, "error");
        assert!(area_fail.message.contains("no existe"));

        // 8. execute_crear_solicitud_compra invalid quantity
        let sol_args = CrearSolicitudCompraArgs {
            producto: "PRD-123".to_string(),
            cantidad: rust_decimal::Decimal::new(-10, 0),
            nota: None,
        };
        let sol_fail = execute_crear_solicitud_compra(&pool, &admin_user, sol_args).await.unwrap();
        assert_eq!(sol_fail.status, "error");
        assert!(sol_fail.message.contains("mayor a cero"));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_execute_tool_success_routes(pool: sqlx::PgPool) {
        // Setup database records
        let admin_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) \
             VALUES ($1, 'Admin DB Test', 'admin-db-test@lab.cl', 'hash', 'admin', true)"
        )
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();

        let admin_user = ActiveUser {
            id: admin_id,
            rol: "admin".to_string(),
        };

        let provider_id: i32 = sqlx::query_scalar(
            "INSERT INTO proveedores (nombre) VALUES ('Test Proveedor') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let unit_id: i32 = sqlx::query_scalar(
            "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Test Base Unit', 'Test Base Units') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let product_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos (id, nombre, codigo_interno, unidad_base_id, activo) \
             VALUES ($1, 'Test Product DB', 'PRD-SUCCESS-1', $2, true)"
        )
        .bind(product_id)
        .bind(unit_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE productos SET proveedor_id = $2 WHERE id = $1"
        )
        .bind(product_id)
        .bind(provider_id)
        .execute(&pool)
        .await
        .unwrap();

        let area_exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 1)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (1, 'Area Central', 'Central')")
                .execute(&pool)
                .await
                .unwrap();
        }

        // Test Registrar Ingreso (Success Route)
        let registrar_args = RegistrarIngresoArgs {
            producto: "PRD-SUCCESS-1".to_string(),
            cantidad: rust_decimal::Decimal::new(15, 0),
            lote: "LOT-SUCCESS-99".to_string(),
            vencimiento: "2030-01-01".to_string(),
            area_id: 1,
        };

        let result = execute_registrar_ingreso(&pool, &admin_user, registrar_args).await.unwrap();
        assert_eq!(result.status, "success");
        assert!(result.message.contains("registrada exitosamente"));

        let stock_qty: rust_decimal::Decimal = sqlx::query_scalar(
            "SELECT SUM(cantidad) FROM stock WHERE area_id = 1 AND lote_id IN (SELECT id FROM lotes WHERE producto_id = $1)"
        )
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stock_qty, rust_decimal::Decimal::new(15, 0));

        // Test Crear Solicitud Compra (Success Route)
        let sol_args = CrearSolicitudCompraArgs {
            producto: "PRD-SUCCESS-1".to_string(),
            cantidad: rust_decimal::Decimal::new(50, 0),
            nota: Some("Urgente por WhatsApp".to_string()),
        };

        let result_sol = execute_crear_solicitud_compra(&pool, &admin_user, sol_args).await.unwrap();
        assert_eq!(result_sol.status, "success");
        assert!(result_sol.message.contains("actualizada exitosamente"));

        let sol_detail_qty: rust_decimal::Decimal = sqlx::query_scalar(
            "SELECT cantidad_sugerida FROM solicitud_compra_detalle WHERE producto_id = $1"
        )
        .bind(product_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(sol_detail_qty, rust_decimal::Decimal::new(50, 0));

        // Test execute_buscar_stock (Success Route)
        let search_args = BuscarStockArgs {
            busqueda: "Success".to_string(),
        };
        let search_res = execute_buscar_stock(&pool, &admin_user, search_args).await.unwrap();
        assert_eq!(search_res.status, "success");
        assert_eq!(search_res.items.len(), 1);
        assert_eq!(search_res.items[0].codigo_interno, "PRD-SUCCESS-1");
        assert_eq!(search_res.items[0].stock_total, rust_decimal::Decimal::new(15, 0));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_parallel_execution_and_failure_isolation(pool: sqlx::PgPool) {
        // Setup database records
        let admin_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) \
             VALUES ($1, 'Admin DB Test', 'admin-db-test@lab.cl', 'hash', 'admin', true)"
        )
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();

        let admin_user = ActiveUser {
            id: admin_id,
            rol: "admin".to_string(),
        };

        let provider_id: i32 = sqlx::query_scalar(
            "INSERT INTO proveedores (nombre) VALUES ('Test Proveedor') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let unit_id: i32 = sqlx::query_scalar(
            "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Test Base Unit', 'Test Base Units') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let p1_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos (id, nombre, codigo_interno, unidad_base_id, activo) \
             VALUES ($1, 'Product One', 'P-001', $2, true)"
        )
        .bind(p1_id)
        .bind(unit_id)
        .execute(&pool)
        .await
        .unwrap();

        let p2_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos (id, nombre, codigo_interno, unidad_base_id, activo) \
             VALUES ($1, 'Product Two', 'P-002', $2, true)"
        )
        .bind(p2_id)
        .bind(unit_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE productos SET proveedor_id = $2 WHERE id = $1"
        )
        .bind(p1_id)
        .bind(provider_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE productos SET proveedor_id = $2 WHERE id = $1"
        )
        .bind(p2_id)
        .bind(provider_id)
        .execute(&pool)
        .await
        .unwrap();

        let area_exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 1)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (1, 'Area Central', 'Central')")
                .execute(&pool)
                .await
                .unwrap();
        }

        // 1. Success batch: register entry for both P-001 and P-002
        let args1 = serde_json::json!({
            "producto": "P-001",
            "cantidad": 10.0,
            "lote": "L1",
            "vencimiento": "2030-01-01",
            "area_id": 1
        });
        let args2 = serde_json::json!({
            "producto": "P-002",
            "cantidad": 20.0,
            "lote": "L2",
            "vencimiento": "2030-01-01",
            "area_id": 1
        });

        // Run "parallel" tools execution block
        let res1 = execute_tool(&pool, &admin_user, "registrar_ingreso", args1).await.unwrap();
        let res2 = execute_tool(&pool, &admin_user, "registrar_ingreso", args2).await.unwrap();

        assert_eq!(res1.get("status").unwrap().as_str().unwrap(), "success");
        assert_eq!(res2.get("status").unwrap().as_str().unwrap(), "success");

        // Verify both stock rows are committed
        let stock_p1: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $1)")
            .bind(p1_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let stock_p2: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $1)")
            .bind(p2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stock_p1, rust_decimal::Decimal::new(10, 0));
        assert_eq!(stock_p2, rust_decimal::Decimal::new(20, 0));

        // 2. Failure Isolation:
        // First tool succeeds (consume 5 of P-001)
        // Second tool fails (consume 100 of P-002 -> stock insufficient)
        let consume_args1 = serde_json::json!({
            "producto": "P-001",
            "cantidad": 5.0,
            "lote": "L1",
            "area_id": 1
        });
        let consume_args2 = serde_json::json!({
            "producto": "P-002",
            "cantidad": 100.0,
            "lote": "L2",
            "area_id": 1
        });

        let cres1 = execute_tool(&pool, &admin_user, "registrar_consumo", consume_args1).await.unwrap();
        let cres2 = execute_tool(&pool, &admin_user, "registrar_consumo", consume_args2).await.unwrap();

        // P-001 consumption succeeds
        assert_eq!(cres1.get("status").unwrap().as_str().unwrap(), "success");
        // P-002 consumption fails
        assert_eq!(cres2.get("status").unwrap().as_str().unwrap(), "error");
        assert!(cres2.get("message").unwrap().as_str().unwrap().contains("insuficiente"));

        // Verify failure isolation: P-001 is committed (stock goes 10 -> 5)
        let stock_p1_after: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $1)")
            .bind(p1_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stock_p1_after, rust_decimal::Decimal::new(5, 0));

        // P-002 is rolled back (stock remains 20)
        let stock_p2_after: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $1)")
            .bind(p2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stock_p2_after, rust_decimal::Decimal::new(20, 0));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_rbac_global_search_for_tecnologo(pool: sqlx::PgPool) {
        // Setup areas
        let area_exists1 = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 1)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists1 {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (1, 'Area Central', 'Central')")
                .execute(&pool)
                .await
                .unwrap();
        }
        let area_exists2 = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 2)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists2 {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (2, 'Urgencias', 'Urgencias')")
                .execute(&pool)
                .await
                .unwrap();
        }

        // Setup user tecnologo
        let tec_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) \
             VALUES ($1, 'Tec DB Test', 'tec-db-test@lab.cl', 'hash', 'tecnologo', true)"
        )
        .bind(tec_id)
        .execute(&pool)
        .await
        .unwrap();

        let tec_user = ActiveUser {
            id: tec_id,
            rol: "tecnologo".to_string(),
        };

        // Note: NO entries in usuario_area are added for tec_user.

        // Setup product & stock in both areas
        let unit_id: i32 = sqlx::query_scalar(
            "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Test Base Unit', 'Test Base Units') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let p_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos (id, nombre, codigo_interno, unidad_base_id, activo) \
             VALUES ($1, 'Global Product', 'P-GLOBAL', $2, true)"
        )
        .bind(p_id)
        .bind(unit_id)
        .execute(&pool)
        .await
        .unwrap();

        // Insert stock in Area 1 and Area 2
        let l_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) \
             VALUES ($1, $2, 'L-GLOBAL', '2030-01-01')"
        )
        .bind(l_id)
        .bind(p_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0), ($1, 2, 15.0)"
        )
        .bind(l_id)
        .execute(&pool)
        .await
        .unwrap();

        // Execute buscar_stock as tecnologo
        let search_args = BuscarStockArgs {
            busqueda: "P-GLOBAL".to_string(),
        };
        let res = execute_buscar_stock(&pool, &tec_user, search_args).await.unwrap();

        assert_eq!(res.status, "success");
        // Must return 2 items (one for Area Central, one for Urgencias)
        assert_eq!(res.items.len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_interactive_consumption_flow(pool: sqlx::PgPool) {
        // Setup areas
        let area_exists1 = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 1)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists1 {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (1, 'Area Central', 'Central')")
                .execute(&pool)
                .await
                .unwrap();
        }
        let area_exists2 = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM areas WHERE id = 2)")
            .fetch_one(&pool)
            .await
            .unwrap();
        if !area_exists2 {
            sqlx::query("INSERT INTO areas (id, nombre, descripcion) VALUES (2, 'Urgencias', 'Urgencias')")
                .execute(&pool)
                .await
                .unwrap();
        }

        // Setup user admin
        let admin_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) \
             VALUES ($1, 'Admin DB Test', 'admin-db-test@lab.cl', 'hash', 'admin', true)"
        )
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();

        let admin_user = ActiveUser {
            id: admin_id,
            rol: "admin".to_string(),
        };

        // Setup product
        let unit_id: i32 = sqlx::query_scalar(
            "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ('Test Base Unit', 'Test Base Units') RETURNING id"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let p_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos (id, nombre, codigo_interno, unidad_base_id, activo) \
             VALUES ($1, 'Interactive Product', 'P-INT', $2, true)"
        )
        .bind(p_id)
        .bind(unit_id)
        .execute(&pool)
        .await
        .unwrap();

        // Lote 1 (vence pronto)
        let l1_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) \
             VALUES ($1, $2, 'L12', '2026-08-30')"
        )
        .bind(l1_id)
        .bind(p_id)
        .execute(&pool)
        .await
        .unwrap();

        // Lote 2 (vence despues)
        let l2_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO lotes (id, producto_id, numero_lote, fecha_vencimiento) \
             VALUES ($1, $2, 'L14', '2026-12-31')"
        )
        .bind(l2_id)
        .bind(p_id)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, 1, 10.0), ($2, 2, 15.0)"
        )
        .bind(l1_id)
        .bind(l2_id)
        .execute(&pool)
        .await
        .unwrap();

        // 1. Consume without specifying a lote -> should prompt selection
        let args = RegistrarConsumoArgs {
            producto: "P-INT".to_string(),
            cantidad: rust_decimal::Decimal::new(5, 0),
            lote: None,
            area_id: None,
        };

        let res = execute_registrar_consumo(&pool, &admin_user, args).await.unwrap();

        assert_eq!(res.get("status").unwrap().as_str().unwrap(), "needs_lote_selection");
        assert_eq!(res.get("producto_nombre").unwrap().as_str().unwrap(), "Interactive Product");

        let fefo = res.get("fefo_lote").unwrap();
        assert_eq!(fefo.get("numero_lote").unwrap().as_str().unwrap(), "L12");
        assert_eq!(fefo.get("area_id").unwrap().as_i64().unwrap(), 1);

        let alts = res.get("alternativas").unwrap().as_array().unwrap();
        assert_eq!(alts.len(), 1);
        assert_eq!(alts[0].get("numero_lote").unwrap().as_str().unwrap(), "L14");
        assert_eq!(alts[0].get("area_id").unwrap().as_i64().unwrap(), 2);

        // 2. Consume specifying L14 -> should succeed immediately
        let args_selected = RegistrarConsumoArgs {
            producto: "P-INT".to_string(),
            cantidad: rust_decimal::Decimal::new(5, 0),
            lote: Some("L14".to_string()),
            area_id: None,
        };

        let res_selected = execute_registrar_consumo(&pool, &admin_user, args_selected).await.unwrap();
        assert_eq!(res_selected.get("status").unwrap().as_str().unwrap(), "success");
        assert!(res_selected.get("message").unwrap().as_str().unwrap().contains("Lote L14"));

        // Verify stock of L14 decreased (15 -> 10)
        let stock_l14: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = 2")
            .bind(l2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stock_l14, rust_decimal::Decimal::new(10, 0));

        // Stock of L12 remained 10
        let stock_l12: rust_decimal::Decimal = sqlx::query_scalar("SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = 1")
            .bind(l1_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stock_l12, rust_decimal::Decimal::new(10, 0));
    }
}

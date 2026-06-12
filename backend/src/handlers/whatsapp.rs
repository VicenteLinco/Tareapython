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



#[derive(sqlx::FromRow, Debug, Clone)]
pub struct ActiveUser {
    pub id: uuid::Uuid,
    pub rol: String,
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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BuscarStockArgs {
    pub busqueda: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockItemResult {
    pub codigo_interno: String,
    pub producto_nombre: String,
    pub area_nombre: String,
    pub stock_total: rust_decimal::Decimal,
    pub unidad: String,
    pub proximo_vencimiento: Option<chrono::NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuscarStockResult {
    pub status: String,
    pub items: Vec<StockItemResult>,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistrarIngresoArgs {
    pub producto: String,
    pub cantidad: rust_decimal::Decimal,
    pub lote: String,
    pub vencimiento: String,
    pub area_id: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegistrarIngresoResult {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CrearSolicitudCompraArgs {
    pub producto: String,
    pub cantidad: rust_decimal::Decimal,
    pub nota: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrearSolicitudCompraResult {
    pub status: String,
    pub message: String,
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
    if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
        return Err(AppError::Forbidden("No autorizado: Requiere rol tecnologo o admin para buscar stock.".to_string()));
    }

    let ilike_query = format!("%{}%", args.busqueda.trim());

    let rows = sqlx::query_as::<_, StockRow>(
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
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let items = rows
        .into_iter()
        .map(|r| StockItemResult {
            codigo_interno: r.codigo_interno,
            producto_nombre: r.producto_nombre,
            area_nombre: r.area_nombre,
            stock_total: r.stock_total,
            unidad: r.unidad,
            proximo_vencimiento: r.proximo_vencimiento,
        })
        .collect::<Vec<_>>();

    let message = if items.is_empty() {
        Some(format!("No se encontró stock para la búsqueda: '{}'.", args.busqueda))
    } else {
        None
    };

    Ok(BuscarStockResult {
        status: "success".to_string(),
        items,
        message,
    })
}

pub async fn execute_registrar_ingreso(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: RegistrarIngresoArgs,
) -> Result<RegistrarIngresoResult, AppError> {
    if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: "No autorizado: Requiere rol tecnologo o admin para registrar ingreso.".to_string(),
        });
    }

    if args.cantidad.scale() > 2 {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: "Error: La cantidad no puede tener más de 2 decimales.".to_string(),
        });
    }
    if args.cantidad <= rust_decimal::Decimal::ZERO {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: "Error: La cantidad debe ser mayor a cero.".to_string(),
        });
    }

    let expiry_date = match chrono::NaiveDate::parse_from_str(&args.vencimiento, "%Y-%m-%d") {
        Ok(date) => {
            let today = chrono::Utc::now().date_naive();
            if date <= today {
                return Ok(RegistrarIngresoResult {
                    status: "error".to_string(),
                    message: format!("Error: La fecha de vencimiento '{}' debe ser futura.", args.vencimiento),
                });
            }
            date
        }
        Err(_) => {
            return Ok(RegistrarIngresoResult {
                status: "error".to_string(),
                message: format!("Error: La fecha de vencimiento '{}' no tiene el formato AAAA-MM-DD.", args.vencimiento),
            });
        }
    };

    let area_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM areas WHERE id = $1)"
    )
    .bind(args.area_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if !area_exists {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: format!("Error: El área ID {} no existe.", args.area_id),
        });
    }

    if user.rol != "admin" {
        let has_access = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM usuario_area WHERE usuario_id = $1 AND area_id = $2)"
        )
        .bind(user.id)
        .bind(args.area_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

        if !has_access {
            return Ok(RegistrarIngresoResult {
                status: "error".to_string(),
                message: format!("Error: No tiene autorización para ingresar stock en el área ID {}.", args.area_id),
            });
        }
    }

    let resolved_opt = sqlx::query_as::<_, ProductResolution>(
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
    .bind(&args.producto)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let resolved = match resolved_opt {
        Some(res) => res,
        None => {
            let pres_opt = sqlx::query_as::<_, ProductResolution>(
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
            .bind(&args.producto)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

            match pres_opt {
                Some(res) => res,
                None => {
                    return Ok(RegistrarIngresoResult {
                        status: "error".to_string(),
                        message: format!("Error: No se encontró un producto activo con código o código de barras '{}'.", args.producto),
                    });
                }
            }
        }
    };

    let mut tx = pool.begin().await.map_err(|e| AppError::Internal(e.to_string()))?;

    let mut provider_id: Option<i32> = sqlx::query_scalar::<_, i32>(
        r#"SELECT pp.proveedor_id
           FROM producto_proveedor pp
           JOIN proveedores prov ON prov.id = pp.proveedor_id
           WHERE pp.producto_id = $1 AND pp.es_principal = true AND pp.activo = true AND prov.activa = true"#
    )
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if provider_id.is_none() {
        provider_id = sqlx::query_scalar::<_, i32>(
            r#"SELECT pp.proveedor_id
               FROM producto_proveedor pp
               JOIN proveedores prov ON prov.id = pp.proveedor_id
               WHERE pp.producto_id = $1 AND pp.activo = true AND prov.activa = true
               LIMIT 1"#
        )
        .bind(resolved.producto_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    if provider_id.is_none() {
        provider_id = sqlx::query_scalar::<_, i32>(
            "SELECT id FROM proveedores ORDER BY id ASC LIMIT 1"
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let provider_id = match provider_id {
        Some(id) => id,
        None => {
            return Ok(RegistrarIngresoResult {
                status: "error".to_string(),
                message: "Error: No se encontró ningún proveedor en el sistema.".to_string(),
            });
        }
    };

    let insert_reception_res: Result<(uuid::Uuid, String), sqlx::Error> = sqlx::query_as(
        "INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
         VALUES ($1, 'AI-WA-GATEWAY', 'completa', NOW(), $2, 'Ingreso vía WhatsApp Agent')
         RETURNING id, numero_documento"
    )
    .bind(provider_id)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await;

    let (recepcion_id, numero_documento) = insert_reception_res.map_err(|e| AppError::Internal(format!("Falló la creación del registro de recepción: {}", e)))?;

    let insert_lot_res: Result<(uuid::Uuid, String), sqlx::Error> = sqlx::query_as(
        r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno)
           VALUES ($1, $2, $3, $4, 'L' || LPAD(nextval('seq_lot_numero')::text, 6, '0'))
           ON CONFLICT (producto_id, proveedor_id, numero_lote)
           DO UPDATE SET fecha_vencimiento = EXCLUDED.fecha_vencimiento
           RETURNING id, codigo_interno"#
    )
    .bind(resolved.producto_id)
    .bind(provider_id)
    .bind(&args.lote)
    .bind(expiry_date)
    .fetch_one(&mut *tx)
    .await;

    let (lote_id, lot_codigo_interno) = insert_lot_res.map_err(|e| AppError::Internal(format!("Falló el registro del lote: {}", e)))?;

    let cantidad_base = args.cantidad * resolved.factor_conversion;

    sqlx::query(
        r#"INSERT INTO recepcion_detalle 
           (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id, cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#
    )
    .bind(recepcion_id)
    .bind(resolved.producto_id)
    .bind(lote_id)
    .bind(resolved.presentacion_id)
    .bind(args.area_id)
    .bind(args.cantidad)
    .bind(resolved.factor_conversion)
    .bind(cantidad_base)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("Falló el registro del detalle de la recepción: {}", e)))?;

    sqlx::query(
        "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(resolved.producto_id)
    .bind(args.area_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("Falló el enlace de producto y área: {}", e)))?;

    crate::services::stock_ops::aplicar_ingreso(
        &mut tx,
        lote_id,
        args.area_id,
        cantidad_base,
        user.id,
        "INGRESO",
        Some(recepcion_id),
        Some("Ingreso vía WhatsApp Agent"),
        Some("RECEPCION"),
    )
    .await?;

    tx.commit().await.map_err(|e| AppError::Internal(format!("Falló el commit de la transacción: {}", e)))?;

    let success_msg = format!(
        "Recepción {} registrada exitosamente.\n\
         Producto: {}\n\
         Cantidad: {} {}\n\
         Lote: {} ({})\n\
         Área ID: {}",
        numero_documento,
        resolved.producto_nombre,
        args.cantidad,
        resolved.unidad_basica_nombre,
        args.lote,
        lot_codigo_interno,
        args.area_id
    );

    Ok(RegistrarIngresoResult {
        status: "success".to_string(),
        message: success_msg,
    })
}

pub async fn execute_crear_solicitud_compra(
    pool: &sqlx::PgPool,
    user: &ActiveUser,
    args: CrearSolicitudCompraArgs,
) -> Result<CrearSolicitudCompraResult, AppError> {
    if args.cantidad <= rust_decimal::Decimal::ZERO {
        return Ok(CrearSolicitudCompraResult {
            status: "error".to_string(),
            message: "Error: La cantidad sugerida debe ser mayor a cero.".to_string(),
        });
    }

    let resolved_opt = sqlx::query_as::<_, ProductResolution>(
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
    .bind(&args.producto)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let resolved = match resolved_opt {
        Some(res) => res,
        None => {
            let pres_opt = sqlx::query_as::<_, ProductResolution>(
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
            .bind(&args.producto)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

            match pres_opt {
                Some(res) => res,
                None => {
                    return Ok(CrearSolicitudCompraResult {
                        status: "error".to_string(),
                        message: format!("Error: No se encontró un producto activo con código o código de barras '{}'.", args.producto),
                    });
                }
            }
        }
    };

    let mut tx = pool.begin().await.map_err(|e| AppError::Internal(e.to_string()))?;

    let solicitud_id_res = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM solicitudes_compra WHERE usuario_id = $1 AND estado = 'borrador'"
    )
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let nota_db = match &args.nota {
        Some(n) if !n.trim().is_empty() => format!("Borrador WhatsApp: {}", n.trim()),
        _ => "Borrador WhatsApp".to_string(),
    };

    let solicitud_id = match solicitud_id_res {
        Some(id) => id,
        None => {
            sqlx::query_scalar::<_, uuid::Uuid>(
                "INSERT INTO solicitudes_compra (usuario_id, nota, estado) VALUES ($1, $2, 'borrador') RETURNING id"
            )
            .bind(user.id)
            .bind(&nota_db)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        }
    };

    let existing_qty = sqlx::query_scalar::<_, rust_decimal::Decimal>(
        "SELECT cantidad_sugerida FROM solicitud_compra_detalle WHERE solicitud_id = $1 AND producto_id = $2"
    )
    .bind(solicitud_id)
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if existing_qty.is_some() {
        sqlx::query(
            "UPDATE solicitud_compra_detalle SET cantidad_sugerida = cantidad_sugerida + $3 WHERE solicitud_id = $1 AND producto_id = $2"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(args.cantidad)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    } else {
        sqlx::query(
            "INSERT INTO solicitud_compra_detalle (solicitud_id, producto_id, cantidad_sugerida, unidad) VALUES ($1, $2, $3, $4)"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(args.cantidad)
        .bind(&resolved.unidad_basica_nombre)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tx.commit().await.map_err(|e| AppError::Internal(e.to_string()))?;

    let success_msg = format!(
        "Solicitud de compra borrador actualizada exitosamente.\n\
         Producto: {}\n\
         Cantidad Agregada: {} {}",
        resolved.producto_nombre,
        args.cantidad,
        resolved.unidad_basica_nombre
    );

    Ok(CrearSolicitudCompraResult {
        status: "success".to_string(),
        message: success_msg,
    })
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

    // Load AI Agent config
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
                &msg.raw_payload,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e);
        }
    };

    // Create LlmClient
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
                &msg.raw_payload,
                None,
                "DB_ERROR",
                Some(error_msg),
            ).await;
            let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
            return Err(e);
        }
    };

    let system_prompt = crate::services::llm::get_system_prompt();

    // Call AI Agent loop
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
            &msg.raw_payload,
            None,
            "DB_ERROR",
            Some(error_msg),
        ).await;
        let _ = send_whatsapp_reply(&state.config, &msg.from, error_msg).await;
        return Err(e);
    }

    Ok(())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WebhookLogEntry {
    pub id: uuid::Uuid,
    pub message_id: String,
    pub sender_phone: String,
    pub usuario_id: Option<uuid::Uuid>,
    pub request_body: String,
    pub command_type: Option<String>,
    pub status: String,
    pub response_body: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn get_logs_handler(
    State(state): State<AppState>,
) -> Result<axum::Json<Vec<WebhookLogEntry>>, AppError> {
    let logs = sqlx::query_as::<_, WebhookLogEntry>(
        "SELECT id, message_id, sender_phone, usuario_id, request_body, command_type, status, response_body, created_at 
         FROM whatsapp_webhook_logs 
         ORDER BY created_at DESC 
         LIMIT 50"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::Sqlx(e))?;

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
            "INSERT INTO producto_proveedor (producto_id, proveedor_id, es_principal, activo) \
             VALUES ($1, $2, true, true)"
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
}

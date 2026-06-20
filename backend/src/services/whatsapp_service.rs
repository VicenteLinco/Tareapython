use sqlx::PgPool;
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::str::FromStr;
use crate::errors::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct WhatsappSettings {
    pub api_url: String,
    pub api_key: String,
    pub webhook_secret: String,
    pub bot_phone: String,
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
    stock_total: Decimal,
    unidad: String,
    proximo_vencimiento: Option<chrono::NaiveDate>,
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub struct ProductResolution {
    pub producto_id: uuid::Uuid,
    pub producto_nombre: String,
    pub presentacion_id: Option<i32>,
    pub factor_conversion: Decimal,
    pub unidad_basica_nombre: String,
    pub unidad_base_id: i32,
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
    pub stock_total: Decimal,
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
    pub cantidad: Decimal,
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
    pub cantidad: Decimal,
    pub nota: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrearSolicitudCompraResult {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistrarConsumoArgs {
    pub producto: String,
    pub cantidad: Decimal,
    pub lote: Option<String>,
    pub area_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoteSelectionDetail {
    pub lote_id: uuid::Uuid,
    pub numero_lote: String,
    pub fecha_vencimiento: chrono::NaiveDate,
    pub area_nombre: String,
    pub area_id: i32,
    pub cantidad_disponible: Decimal,
}

#[derive(Debug, sqlx::FromRow)]
struct StockQueryRow {
    stock_id: i32,
    lote_id: uuid::Uuid,
    cantidad: Decimal,
    area_id: i32,
    numero_lote: String,
    fecha_vencimiento: chrono::NaiveDate,
    area_nombre: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
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

pub async fn load_whatsapp_settings(pool: &PgPool) -> Result<WhatsappSettings, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN ('whatsapp_api_url', 'whatsapp_api_key', 'whatsapp_webhook_secret', 'whatsapp_bot_phone')"
    )
    .fetch_all(pool)
    .await?;

    let mut api_url = std::env::var("WHATSAPP_API_URL").unwrap_or_else(|_| "http://localhost:8008".to_string());
    let mut api_key = std::env::var("WHATSAPP_API_KEY").unwrap_or_else(|_| "mock_whatsapp_api_key_for_dev".to_string());
    let mut webhook_secret = std::env::var("WHATSAPP_WEBHOOK_SECRET").unwrap_or_else(|_| "mock_webhook_secret_for_dev".to_string());
    let mut bot_phone = std::env::var("WHATSAPP_BOT_PHONE").unwrap_or_default();

    for (clave, valor) in rows {
        let trimmed = valor.trim();
        if !trimmed.is_empty() {
            match clave.as_str() {
                "whatsapp_api_url" => api_url = trimmed.to_string(),
                "whatsapp_api_key" => api_key = trimmed.to_string(),
                "whatsapp_webhook_secret" => webhook_secret = trimmed.to_string(),
                "whatsapp_bot_phone" => bot_phone = trimmed.to_string(),
                _ => {}
            }
        }
    }

    Ok(WhatsappSettings {
        api_url,
        api_key,
        webhook_secret,
        bot_phone,
    })
}

pub async fn webhook_log_exists(pool: &PgPool, message_id: &str) -> Result<bool, AppError> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM whatsapp_webhook_logs WHERE message_id = $1)"
    )
    .bind(message_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    Ok(exists)
}

pub async fn get_active_user_by_phone(pool: &PgPool, phone: &str) -> Result<Option<ActiveUser>, AppError> {
    let user = sqlx::query_as::<_, ActiveUser>(
        "SELECT id, rol FROM usuarios WHERE whatsapp_phone = $1 AND activo = true"
    )
    .bind(phone)
    .fetch_optional(pool)
    .await?;
    Ok(user)
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

pub async fn get_logs(pool: &PgPool) -> Result<Vec<WebhookLogEntry>, AppError> {
    let logs = sqlx::query_as::<_, WebhookLogEntry>(
        "SELECT id, message_id, sender_phone, usuario_id, request_body, command_type, status, response_body, created_at 
         FROM whatsapp_webhook_logs 
         ORDER BY created_at DESC 
         LIMIT 50"
    )
    .fetch_all(pool)
    .await?;
    Ok(logs)
}

pub async fn resolve_product_by_code(
    pool: &PgPool,
    ident: &str,
) -> Result<Result<ProductResolution, String>, AppError> {
    let ident = ident.trim();
    
    // 1. Try exact internal code
    let exact_code = sqlx::query_as::<_, ProductResolution>(
        r#"SELECT 
            p.id AS producto_id, 
            p.nombre AS producto_nombre,
            NULL::INT AS presentacion_id, 
            1.0::NUMERIC AS factor_conversion, 
            ub.nombre AS unidad_basica_nombre,
            p.unidad_base_id
        FROM productos p
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE UPPER(p.codigo_interno) = UPPER($1) AND p.activo = true AND p.deleted_at IS NULL"#
    )
    .bind(ident)
    .fetch_optional(pool)
    .await?;

    if let Some(res) = exact_code {
        return Ok(Ok(res));
    }

    // 2. Try exact barcode/presentation
    let exact_barcode = sqlx::query_as::<_, ProductResolution>(
        r#"SELECT 
            pres.producto_id AS producto_id, 
            p.nombre AS producto_nombre,
            pres.id AS presentacion_id, 
            pres.factor_conversion, 
            ub.nombre AS unidad_basica_nombre,
            p.unidad_base_id
        FROM presentaciones pres
        JOIN productos p ON p.id = pres.producto_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE UPPER(pres.codigo_barras) = UPPER($1) AND pres.activa = true AND p.activo = true AND p.deleted_at IS NULL"#
    )
    .bind(ident)
    .fetch_optional(pool)
    .await?;

    if let Some(res) = exact_barcode {
        return Ok(Ok(res));
    }

    // 3. Try name match (ILIKE and similarity)
    let candidates = sqlx::query_as::<_, ProductResolution>(
        r#"SELECT 
            p.id AS producto_id, 
            p.nombre AS producto_nombre,
            NULL::INT AS presentacion_id,
            1.0::NUMERIC AS factor_conversion,
            ub.nombre AS unidad_basica_nombre,
            p.unidad_base_id
        FROM productos p
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE (p.nombre ILIKE $1 OR similarity(p.nombre, $2) > 0.3)
          AND p.activo = true AND p.deleted_at IS NULL
        ORDER BY similarity(p.nombre, $2) DESC, p.nombre ASC
        LIMIT 5"#
    )
    .bind(format!("%{}%", ident))
    .bind(ident)
    .fetch_all(pool)
    .await?;

    if candidates.is_empty() {
        return Ok(Err(format!("Error: No se encontró ningún producto activo con código, código de barras o nombre '{}'.", ident)));
    }

    if candidates.len() == 1 {
        let cand = &candidates[0];
        return Ok(Ok(ProductResolution {
            producto_id: cand.producto_id,
            producto_nombre: cand.producto_nombre.clone(),
            presentacion_id: None,
            factor_conversion: Decimal::ONE,
            unidad_basica_nombre: cand.unidad_basica_nombre.clone(),
            unidad_base_id: cand.unidad_base_id,
        }));
    }

    // Multiple candidates found, build a selection message
    let mut msg = format!("Se encontraron múltiples productos que coinciden con '{}'. Por favor, indica el código exacto:\n", ident);
    for cand in candidates {
        let code: String = sqlx::query_scalar("SELECT codigo_interno FROM productos WHERE id = $1")
            .bind(cand.producto_id)
            .fetch_one(pool)
            .await
            .unwrap_or_else(|_| "N/A".to_string());
        msg.push_str(&format!("* `{}` - {}\n", code, cand.producto_nombre));
    }

    Ok(Err(msg))
}

pub async fn buscar_stock_tool(
    pool: &PgPool,
    user: &ActiveUser,
    args: BuscarStockArgs,
) -> Result<BuscarStockResult, AppError> {
    if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
        return Err(AppError::Forbidden("No autorizado: Requiere rol tecnologo o admin para buscar stock.".to_string()));
    }

    let clean_query = args.busqueda.trim();
    let ilike_query = format!("%{}%", clean_query);

    let rows = sqlx::query_as::<_, StockRow>(
        r#"SELECT
            p.codigo_interno,
            p.nombre AS producto_nombre,
            COALESCE(v.area_nombre, 'N/A') AS area_nombre,
            COALESCE(v.stock_total, 0::numeric) AS stock_total,
            ub.nombre AS unidad,
            v.proximo_vencimiento
           FROM productos p
           JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
           LEFT JOIN v_stock_por_producto_area v ON v.producto_id = p.id
           WHERE p.activo = true AND p.deleted_at IS NULL
             AND (
                 p.codigo_interno ILIKE $1 
                 OR p.nombre ILIKE $1
                 OR similarity(p.nombre, $4) > 0.3
             )
             AND (
                 $2 = 'admin' OR $2 = 'tecnologo' OR 
                 v.area_id IS NULL OR
                 EXISTS (
                     SELECT 1 FROM usuario_area ua 
                     WHERE ua.usuario_id = $3 AND ua.area_id = v.area_id
                 )
             )
           ORDER BY 
             CASE 
                 WHEN p.codigo_interno = $4 THEN 1
                 WHEN p.nombre ILIKE $1 THEN 2
                 ELSE 3
             END,
             similarity(p.nombre, $4) DESC,
             p.nombre, 
             p.codigo_interno, 
             v.area_nombre"#
    )
    .bind(&ilike_query)
    .bind(&user.rol)
    .bind(user.id)
    .bind(clean_query)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let items = rows
        .into_iter()
        .map(|r| StockItemResult {
            codigo_interno: r.codigo_interno,
            producto_nombre: r.producto_nombre,
            area_nombre: r.area_nombre,
            stock_total: r.stock_total.round().normalize(),
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

pub async fn registrar_recepcion_tool(
    pool: &PgPool,
    user: &ActiveUser,
    args: RegistrarIngresoArgs,
) -> Result<RegistrarIngresoResult, AppError> {
    if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: "No autorizado: Requiere rol tecnologo o admin para registrar ingreso.".to_string(),
        });
    }

    if args.cantidad.fract() != Decimal::ZERO {
        return Ok(RegistrarIngresoResult {
            status: "error".to_string(),
            message: "Error: La cantidad debe ser un número entero (sin decimales).".to_string(),
        });
    }
    if args.cantidad <= Decimal::ZERO {
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

    let resolved = match resolve_product_by_code(pool, &args.producto).await? {
        Ok(res) => res,
        Err(err_msg) => {
            return Ok(RegistrarIngresoResult {
                status: "error".to_string(),
                message: err_msg,
            });
        }
    };

    let mut tx = pool.begin().await.map_err(|e| AppError::Internal(e.to_string()))?;

    let mut provider_id: Option<i32> = sqlx::query_scalar::<_, i32>(
        r#"SELECT p.proveedor_id
           FROM productos p
           JOIN proveedores prov ON prov.id = p.proveedor_id
           WHERE p.id = $1 AND prov.activa = true"#
    )
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

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

    let lote_id: uuid::Uuid = sqlx::query_scalar(
        r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (producto_id, proveedor_id, numero_lote)
           DO UPDATE SET fecha_vencimiento = EXCLUDED.fecha_vencimiento
           RETURNING id"#
    )
    .bind(resolved.producto_id)
    .bind(provider_id)
    .bind(&args.lote)
    .bind(expiry_date)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(format!("Falló el registro del lote: {}", e)))?;

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
        None,
    )
    .await?;

    tx.commit().await.map_err(|e| AppError::Internal(format!("Falló el commit de la transacción: {}", e)))?;

    let success_msg = format!(
        "Recepción {} registrada exitosamente.\n\
         Producto: {}\n\
         Cantidad: {} {}\n\
         Lote: {}\n\
         Área ID: {}",
        numero_documento,
        resolved.producto_nombre,
        args.cantidad.normalize(),
        resolved.unidad_basica_nombre,
        args.lote,
        args.area_id
    );

    Ok(RegistrarIngresoResult {
        status: "success".to_string(),
        message: success_msg,
    })
}

pub async fn add_to_purchase_request_tool(
    pool: &PgPool,
    user: &ActiveUser,
    args: CrearSolicitudCompraArgs,
) -> Result<CrearSolicitudCompraResult, AppError> {
    if args.cantidad <= Decimal::ZERO {
        return Ok(CrearSolicitudCompraResult {
            status: "error".to_string(),
            message: "Error: La cantidad sugerida debe ser mayor a cero.".to_string(),
        });
    }

    let resolved = match resolve_product_by_code(pool, &args.producto).await? {
        Ok(res) => res,
        Err(err_msg) => {
            return Ok(CrearSolicitudCompraResult {
                status: "error".to_string(),
                message: err_msg,
            });
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

    let existing_qty = sqlx::query_scalar::<_, Decimal>(
        "SELECT cantidad_sugerida FROM solicitud_compra_detalle WHERE solicitud_id = $1 AND producto_id = $2"
    )
    .bind(solicitud_id)
    .bind(resolved.producto_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let (unidad_basica_id, presentacion_id, cantidad_sugerida, cantidad_presentaciones) = if let Some(pres_id) = resolved.presentacion_id {
        (None, Some(pres_id), args.cantidad * resolved.factor_conversion, Some(args.cantidad))
    } else {
        (Some(resolved.unidad_base_id), None, args.cantidad, None)
    };

    if existing_qty.is_some() {
        sqlx::query(
            "UPDATE solicitud_compra_detalle SET \
             cantidad_sugerida = cantidad_sugerida + $3, \
             cantidad_presentaciones = CASE WHEN presentacion_id IS NOT NULL THEN COALESCE(cantidad_presentaciones, 0::numeric) + $4 ELSE NULL END \
             WHERE solicitud_id = $1 AND producto_id = $2"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(cantidad_sugerida)
        .bind(cantidad_presentaciones)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    } else {
        sqlx::query(
            "INSERT INTO solicitud_compra_detalle \
             (solicitud_id, producto_id, cantidad_sugerida, unidad_basica_id, presentacion_id, cantidad_presentaciones) \
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(solicitud_id)
        .bind(resolved.producto_id)
        .bind(cantidad_sugerida)
        .bind(unidad_basica_id)
        .bind(presentacion_id)
        .bind(cantidad_presentaciones)
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
        args.cantidad.normalize(),
        resolved.unidad_basica_nombre
    );

    Ok(CrearSolicitudCompraResult {
        status: "success".to_string(),
        message: success_msg,
    })
}

pub async fn registrar_consumo_fefo_tool(
    pool: &PgPool,
    user: &ActiveUser,
    args: RegistrarConsumoArgs,
) -> Result<serde_json::Value, AppError> {
    if !matches!(user.rol.as_str(), "admin" | "tecnologo") {
        return Ok(serde_json::json!({
            "status": "error",
            "message": "Error: No autorizado. Rol no permitido."
        }));
    }

    if args.cantidad.fract() != Decimal::ZERO {
        return Ok(serde_json::json!({
            "status": "error",
            "message": "Error: La cantidad debe ser un número entero (sin decimales)."
        }));
    }
    if args.cantidad <= Decimal::ZERO {
        return Ok(serde_json::json!({
            "status": "error",
            "message": "Error: La cantidad debe ser mayor a cero."
        }));
    }

    let resolved = match resolve_product_by_code(pool, &args.producto).await? {
        Ok(res) => res,
        Err(err_msg) => {
            return Ok(serde_json::json!({
                "status": "error",
                "message": err_msg,
            }));
        }
    };

    let cantidad_base = args.cantidad * resolved.factor_conversion;
    let lote_ident = args.lote.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());

    if lote_ident.is_none() {
        let rows = sqlx::query_as::<_, StockQueryRow>(
            r#"SELECT 
                s.id as stock_id,
                s.lote_id,
                s.cantidad,
                s.area_id,
                l.numero_lote,
                l.fecha_vencimiento,
                a.nombre as area_nombre
            FROM stock s
            JOIN lotes l ON l.id = s.lote_id
            JOIN areas a ON a.id = s.area_id
            WHERE l.producto_id = $1 AND s.cantidad > 0
            ORDER BY l.fecha_vencimiento ASC"#
        )
        .bind(resolved.producto_id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

        if rows.is_empty() {
            return Ok(serde_json::json!({
                "status": "error",
                "message": "Error: No hay stock disponible para este producto."
            }));
        }

        if rows.len() == 1 {
            let row = &rows[0];
            let mut tx = pool.begin().await.map_err(|e| AppError::Internal(e.to_string()))?;

            let current_qty = sqlx::query_scalar::<_, Decimal>(
                "SELECT cantidad FROM stock WHERE id = $1 FOR UPDATE"
            )
            .bind(row.stock_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

            if current_qty < cantidad_base {
                return Ok(serde_json::json!({
                    "status": "error",
                    "message": format!("Error: Stock insuficiente. Cantidad disponible: {}.", current_qty)
                }));
            }

            let lotes_fefo = vec![crate::services::stock_ops::LoteFefo {
                stock_id: row.stock_id,
                lote_id: row.lote_id,
                cantidad: current_qty,
                area_id: row.area_id,
            }];

            let virtual_consumed_id: Option<i32> = sqlx::query_scalar(
                "SELECT id FROM areas WHERE nombre = 'VIRTUAL_CONSUMED'"
            )
            .fetch_optional(pool)
            .await?;

            let _movimientos = crate::services::stock_ops::aplicar_salida_fefo(
                &mut tx,
                &lotes_fefo,
                cantidad_base,
                user.id,
                "CONSUMO",
                uuid::Uuid::new_v4(),
                Some("Consumo vía WhatsApp Agent"),
                None,
                virtual_consumed_id,
            )
            .await?;

            tx.commit().await.map_err(|e| AppError::Internal(e.to_string()))?;

            return Ok(serde_json::json!({
                "status": "success",
                "message": format!(
                    "Consumo registrado con éxito: se descontaron {} unidades del Lote {} (vence: {}) en el área {}.",
                    args.cantidad,
                    row.numero_lote,
                    row.fecha_vencimiento,
                    row.area_nombre
                )
            }));
        } else {
            let first_row = &rows[0];
            let fefo_lote = LoteSelectionDetail {
                lote_id: first_row.lote_id,
                numero_lote: first_row.numero_lote.clone(),
                fecha_vencimiento: first_row.fecha_vencimiento,
                area_nombre: first_row.area_nombre.clone(),
                area_id: first_row.area_id,
                cantidad_disponible: first_row.cantidad,
            };

            let alternativas = rows[1..]
                .iter()
                .map(|r| LoteSelectionDetail {
                    lote_id: r.lote_id,
                    numero_lote: r.numero_lote.clone(),
                    fecha_vencimiento: r.fecha_vencimiento,
                    area_nombre: r.area_nombre.clone(),
                    area_id: r.area_id,
                    cantidad_disponible: r.cantidad,
                })
                .collect::<Vec<_>>();

            return Ok(serde_json::json!({
                "status": "needs_lote_selection",
                "producto_nombre": resolved.producto_nombre,
                "cantidad": args.cantidad,
                "fefo_lote": fefo_lote,
                "alternativas": alternativas
            }));
        }
    } else {
        let lote_str = lote_ident.unwrap();

        let rows = if let Some(aid) = args.area_id {
            sqlx::query_as::<_, StockQueryRow>(
                r#"SELECT 
                    s.id as stock_id,
                    s.lote_id,
                    s.cantidad,
                    s.area_id,
                    l.numero_lote,
                    l.fecha_vencimiento,
                    a.nombre as area_nombre
                FROM stock s
                JOIN lotes l ON l.id = s.lote_id
                JOIN areas a ON a.id = s.area_id
                WHERE l.producto_id = $1
                  AND (l.numero_lote = $2 OR l.id::text = $2)
                  AND s.cantidad > 0
                  AND s.area_id = $3"#
            )
            .bind(resolved.producto_id)
            .bind(lote_str)
            .bind(aid)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            sqlx::query_as::<_, StockQueryRow>(
                r#"SELECT 
                    s.id as stock_id,
                    s.lote_id,
                    s.cantidad,
                    s.area_id,
                    l.numero_lote,
                    l.fecha_vencimiento,
                    a.nombre as area_nombre
                FROM stock s
                JOIN lotes l ON l.id = s.lote_id
                JOIN areas a ON a.id = s.area_id
                WHERE l.producto_id = $1
                  AND (l.numero_lote = $2 OR l.id::text = $2)
                  AND s.cantidad > 0"#
            )
            .bind(resolved.producto_id)
            .bind(lote_str)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        };

        if rows.is_empty() {
            return Ok(serde_json::json!({
                "status": "error",
                "message": "Error: El lote especificado no existe o no tiene stock disponible."
            }));
        }

        let row = if rows.len() > 1 {
            return Ok(serde_json::json!({
                "status": "error",
                "message": "Error: El lote especificado está presente en múltiples áreas. Por favor indica el ID de área."
            }));
        } else {
            &rows[0]
        };

        let mut tx = pool.begin().await.map_err(|e| AppError::Internal(e.to_string()))?;

        let current_qty = sqlx::query_scalar::<_, Decimal>(
            "SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = $2 FOR UPDATE"
        )
        .bind(row.lote_id)
        .bind(row.area_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

        if current_qty < cantidad_base {
            return Ok(serde_json::json!({
                "status": "error",
                "message": format!("Error: Stock insuficiente. Cantidad disponible: {}.", current_qty)
            }));
        }

        let lotes_fefo = vec![crate::services::stock_ops::LoteFefo {
            stock_id: row.stock_id,
            lote_id: row.lote_id,
            cantidad: current_qty,
            area_id: row.area_id,
        }];

        let virtual_consumed_id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM areas WHERE nombre = 'VIRTUAL_CONSUMED'"
        )
        .fetch_optional(pool)
        .await?;

        let _movimientos = crate::services::stock_ops::aplicar_salida_fefo(
            &mut tx,
            &lotes_fefo,
            cantidad_base,
            user.id,
            "CONSUMO",
            uuid::Uuid::new_v4(),
            Some("Consumo vía WhatsApp Agent"),
            None,
            virtual_consumed_id,
        )
        .await?;

        tx.commit().await.map_err(|e| AppError::Internal(e.to_string()))?;

        return Ok(serde_json::json!({
            "status": "success",
            "message": format!(
                "Consumo registrado con éxito: se descontaron {} unidades del Lote {} (vence: {}) en el área {}.",
                args.cantidad,
                row.numero_lote,
                row.fecha_vencimiento,
                row.area_nombre
            )
        }));
    }
}

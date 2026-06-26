use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::domain::EstadoRecepcion;
use crate::dto::recepcion::{CreateRecepcion, RecepcionQuery, SubirFotoInput};
use crate::errors::AppError;
use crate::services::{idempotency, llm, recepcion_service, storage};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct RecepcionConProveedor {
    pub id: Uuid,
    pub numero_documento: String,
    pub proveedor_id: i32,
    pub proveedor_nombre: String,
    pub proveedor_icono: Option<String>,
    pub guia_despacho: Option<String>,
    pub estado: EstadoRecepcion,
    pub fecha_recepcion: DateTime<Utc>,
    pub usuario_id: Uuid,
    pub usuario_nombre: String,
    pub nota: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub guia_despacho_archivo: Option<String>,
    pub foto_actualizada_at: Option<DateTime<Utc>>,
}

async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<RecepcionQuery>,
) -> Result<Json<crate::dto::recepcion::PaginatedRecepciones>, AppError> {
    let res = recepcion_service::listar(&state.pool, params, claims.sub, &claims.rol).await?;
    Ok(Json(res))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let recepcion = sqlx::query_as::<_, RecepcionConProveedor>(
        "SELECT 
            r.id, 
            r.numero_documento, 
            r.proveedor_id, 
            p.nombre as proveedor_nombre, 
            p.icono as proveedor_icono,
            r.guia_despacho, 
            r.estado::text AS estado, 
            r.fecha_recepcion, 
            r.usuario_id, 
            u.nombre as usuario_nombre,
            r.nota, 
            r.solicitud_id, 
            r.created_at,
            r.guia_despacho_archivo,
            r.foto_actualizada_at 
         FROM recepciones r 
         JOIN proveedores p ON p.id = r.proveedor_id 
         JOIN usuarios u ON u.id = r.usuario_id
         WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let detalles = recepcion_service::obtener_detalles(&state.pool, id).await?;
    let reconciliacion = recepcion_service::obtener_reconciliacion(&state.pool, id).await?;

    Ok(Json(serde_json::json!({
        "recepcion": recepcion,
        "detalle": detalles,
        "reconciliacion": reconciliacion
    })))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<CreateRecepcion>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let estado = req.estado.clone().unwrap_or_else(|| "completa".to_string());
    let idem_key = if estado == "borrador" && !headers.contains_key("X-Idempotency-Key") {
        None
    } else {
        Some(idempotency::extract_idempotency_key(&headers)?)
    };

    if let Some(key) = &idem_key
        && let Some((_status, body)) =
            idempotency::try_claim(&state.pool, key, "POST /recepciones", claims.sub).await?
    {
        return Ok((StatusCode::CREATED, Json(body)));
    }

    let (id, lotes) = match recepcion_service::crear_recepcion(&state.pool, req, claims.sub).await {
        Ok(result) => result,
        Err(e) => {
            if let Some(key) = &idem_key {
                idempotency::cleanup_on_error(&state.pool, key).await?;
            }
            return Err(e);
        }
    };

    let response = serde_json::json!({ "id": id, "estado": estado, "lotes": lotes });
    if let Some(key) = &idem_key {
        idempotency::save_response(&state.pool, key, 201, &response).await?;
    }

    Ok((StatusCode::CREATED, Json(response)))
}

async fn subir_foto(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<SubirFotoInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM recepciones WHERE id = $1)")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;
    if !exists {
        return Err(AppError::NotFound("Recepción no encontrada".into()));
    }

    let path = storage::save_base64_image(&req.data_url, "recepciones", &id.to_string()).await?;

    sqlx::query("UPDATE recepciones SET guia_despacho_archivo = $1, foto_actualizada_at = NOW() WHERE id = $2")
        .bind(&path)
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({ "path": path })))
}

async fn crear_scanner_session(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let token: (Uuid, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "INSERT INTO scanner_sessions (expires_at) VALUES (NOW() + INTERVAL '10 minutes')
         RETURNING token, expires_at",
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "token": token.0,
        "expires_at": token.1,
    })))
}

#[derive(Debug, Deserialize)]
struct ScanInput {
    codigo: String,
}

async fn scan_codigo(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
    Json(body): Json<ScanInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let valid = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM scanner_sessions WHERE token = $1 AND expires_at > NOW())",
    )
    .bind(token)
    .fetch_one(&state.pool)
    .await?;
    if !valid {
        return Err(AppError::Forbidden("Sesión expirada o inválida".into()));
    }

    let producto: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT p.id, p.nombre FROM productos p \
         WHERE (p.codigo_interno = $1 OR p.sku = $1) AND p.activo = true LIMIT 1"
    )
    .bind(&body.codigo)
    .fetch_optional(&state.pool)
    .await?;

    let (producto_id, producto_nombre) = match producto {
        Some(p) => (Some(p.0), Some(p.1)),
        None => (None, None),
    };

    sqlx::query(
        "INSERT INTO scanner_items (session_token, codigo, producto_id, producto_nombre) VALUES ($1, $2, $3, $4)"
    )
    .bind(token)
    .bind(&body.codigo)
    .bind(producto_id)
    .bind(&producto_nombre)
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "producto_id": producto_id,
        "producto_nombre": producto_nombre,
    })))
}

async fn get_scanner_items(
    State(state): State<AppState>,
    Path(token): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items: Vec<(uuid::Uuid, String, Option<uuid::Uuid>, Option<String>)> = sqlx::query_as(
        "UPDATE scanner_items SET fetched = TRUE
         WHERE session_token = $1 AND fetched = FALSE
         RETURNING id, codigo, producto_id, producto_nombre",
    )
    .bind(token)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "items": items.iter().map(|(id, codigo, pid, pnombre)| serde_json::json!({
            "id": id,
            "codigo": codigo,
            "producto_id": pid,
            "producto_nombre": pnombre,
        })).collect::<Vec<_>>()
    })))
}

async fn confirmar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;
    let id = recepcion_service::confirmar_borrador(&state.pool, id, claims.sub).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn eliminar_borrador_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    recepcion_service::eliminar_borrador(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn normalize_date(date_str: &str) -> Option<String> {
    let trimmed = date_str.trim();
    let yyyy_mm_dd = regex::Regex::new(r"^(\d{4})[-/](\d{2})[-/](\d{2})$").ok()?;
    if let Some(caps) = yyyy_mm_dd.captures(trimmed) {
        return Some(format!("{}-{}-{}", &caps[1], &caps[2], &caps[3]));
    }
    let dd_mm_yyyy = regex::Regex::new(r"^(\d{2})[-/](\d{2})[-/](\d{4})$").ok()?;
    if let Some(caps) = dd_mm_yyyy.captures(trimmed) {
        return Some(format!("{}-{}-{}", &caps[3], &caps[2], &caps[1]));
    }
    None
}

#[derive(Debug, Deserialize)]
pub struct ParseGuiaInput {
    pub raw_text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemGuiaParseado {
    #[serde(alias = "nombreProducto", alias = "nombre")]
    pub nombre_producto: String,
    #[serde(alias = "skuRef", alias = "sku", alias = "referencia")]
    pub sku_ref: String,
    pub lote: Option<String>,
    #[serde(alias = "fechaVencimiento", alias = "fechaVto", alias = "vencimiento", alias = "fecha_vencimiento")]
    pub fecha_vencimiento: Option<String>,
    pub cantidad: f64,
    #[serde(alias = "precioUnitario", alias = "precio", alias = "precio_unitario")]
    pub precio_unitario: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GuiaParseada {
    pub proveedor: String,
    pub items: Vec<ItemGuiaParseado>,
}

pub fn parse_guia_regex(raw_text: &str) -> Option<GuiaParseada> {
    let lower_text = raw_text.to_lowercase();
    let proveedor = if lower_text.contains("valtek") {
        "Valtek SA".to_string()
    } else if lower_text.contains("roche") {
        "Roche Diagnostics".to_string()
    } else if lower_text.contains("abbott") {
        "Abbott Laboratories".to_string()
    } else if lower_text.contains("bd ") || lower_text.contains("becton") {
        "BD".to_string()
    } else {
        "Proveedor Genérico".to_string()
    };

    let mut items = Vec::new();
    let re = regex::Regex::new(
        r"(?i)\b(?P<sku>[a-z0-9\-]{3,20})\b\s+(?P<desc>.+?)\s+(?P<qty>\d+(?:\.\d+)?)\s+(?:lote:?\s*)?(?P<lote>[a-z0-9\-]+)\s+(?:vence:?\s*)?(?P<vto>\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4}|\d{2}-\d{2}-\d{4})(?:\s+(?P<price>\d+(?:\.\d+)?))?"
    ).ok()?;

    for line in raw_text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(caps) = re.captures(line) {
            let sku = caps.name("sku").map(|m| m.as_str().to_string()).unwrap_or_default();
            let desc = caps.name("desc").map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let qty_str = caps.name("qty").map(|m| m.as_str()).unwrap_or("0");
            let qty = qty_str.parse::<f64>().unwrap_or(0.0);
            let lote = caps.name("lote").map(|m| m.as_str().to_string());
            let vto_raw = caps.name("vto").map(|m| m.as_str());
            let fecha_vencimiento = vto_raw.and_then(|v| normalize_date(v));
            let price = caps.name("price").and_then(|m| m.as_str().parse::<f64>().ok());

            items.push(ItemGuiaParseado {
                nombre_producto: desc,
                sku_ref: sku,
                lote,
                fecha_vencimiento,
                cantidad: qty,
                precio_unitario: price,
            });
        }
    }

    if items.is_empty() {
        None
    } else {
        Some(GuiaParseada {
            proveedor,
            items,
        })
    }
}

async fn parse_guia(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<ParseGuiaInput>,
) -> Result<Json<GuiaParseada>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    if let Some(parsed) = parse_guia_regex(&payload.raw_text) {
        return Ok(Json(parsed));
    }

    let llm_json = crate::services::llm::parse_guia_con_llm(&state.pool, &payload.raw_text).await?;
    let parsed_guia: GuiaParseada = serde_json::from_value(llm_json)
        .map_err(|e| AppError::Internal(format!("LLM response did not match GuiaParseada schema: {}", e)))?;

    Ok(Json(parsed_guia))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/parse-guia", post(parse_guia))
        .route("/parse-guia-imagen", post(parse_guia_imagen))
        .route("/{id}", get(obtener).delete(eliminar_borrador_handler))
        .route("/{id}/confirmar", post(confirmar))
        .route("/{id}/foto", post(subir_foto).put(subir_foto))
        .route("/scanner-session", post(crear_scanner_session))
        .route("/scanner-session/{token}/scan", post(scan_codigo))
        .route("/scanner-session/{token}/items", get(get_scanner_items))
}

#[derive(Debug, Serialize)]
pub struct GuiaParseadaConArchivo {
    pub proveedor: String,
    pub items: Vec<ItemGuiaParseado>,
    pub archivo_url: String,
    pub source: String,
}

async fn parse_guia_imagen(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<GuiaParseadaConArchivo>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut file_mime: Option<String> = None;
    let mut file_name: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Error leyendo multipart: {}", e)))?
    {
        let name = field.name().unwrap_or_default().to_string();
        if name == "file" {
            file_mime = field.content_type().map(|s| s.to_string());
            file_name = field.file_name().map(|s| s.to_string());
            file_bytes = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::Validation(format!("Error leyendo archivo: {}", e)))?
                    .to_vec(),
            );
        }
    }

    let bytes = file_bytes.ok_or_else(|| {
        AppError::Validation("No se encontró el campo 'file' en el formulario".into())
    })?;

    let mime = file_mime.unwrap_or_default();
    let allowed_mimes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    ];
    if !allowed_mimes.contains(&mime.as_str()) {
        return Err(AppError::Validation(format!(
            "Tipo de archivo no soportado: {}. Se aceptan: JPEG, PNG, WebP y PDF",
            mime
        )));
    }

    let extension = match mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        _ => "bin",
    };

    let archivo_url = storage::save_file_bytes(
        &bytes,
        extension,
        "guias",
        &format!("guia_{}", claims.sub),
    )
    .await?;

    let vision_result = llm::parse_guia_con_vision(&state.pool, &bytes, &mime).await;

    match vision_result {
        Ok(parsed_json) => {
            let parsed_guia: GuiaParseada = serde_json::from_value(parsed_json).map_err(|e| {
                AppError::Internal(format!(
                    "La respuesta de Vision no coincide con el esquema GuiaParseada: {}",
                    e
                ))
            })?;

            Ok(Json(GuiaParseadaConArchivo {
                proveedor: parsed_guia.proveedor,
                items: parsed_guia.items,
                archivo_url,
                source: "vision".to_string(),
            }))
        }
        Err(e) => {
            tracing::warn!(
                "Vision parse failed for file {:?}: {}. File saved at {}",
                file_name,
                e,
                archivo_url
            );
            Err(AppError::Internal(format!(
                "No se pudo extraer datos de la imagen. El archivo fue guardado en {}. Error: {}",
                archivo_url, e
            )))
        }
    }
}

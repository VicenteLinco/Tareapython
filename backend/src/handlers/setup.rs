use axum::extract::{Multipart, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;

// --- DTOs para Mapeo Dinámico ---

#[derive(Debug, Deserialize)]
pub struct ImportConfig {
    pub mapping: HashMap<String, String>, // key: campo_sistema, valor: nombre_columna_csv
    pub dry_run: bool,                    // Si es true, solo valida y no guarda
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total_filas: usize,
    pub importados: usize,
    pub errores: Vec<ImportError>,
    pub preview: Vec<serde_json::Value>,
    pub valido: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportError {
    pub fila: usize,
    pub mensaje: String,
}

// === Helpers ===

async fn is_setup_finalizado(pool: &sqlx::PgPool) -> Result<bool, AppError> {
    let valor: String = sqlx::query_scalar(
        "SELECT valor_texto FROM configuracion WHERE clave = 'setup_finalizado'",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "false".to_string());
    Ok(valor == "true")
}

async fn require_setup_mode(pool: &sqlx::PgPool) -> Result<(), AppError> {
    if is_setup_finalizado(pool).await? {
        return Err(AppError::BusinessLogic(
            "El modo setup ya fue finalizado.".into(),
            "SETUP_FINALIZADO".into(),
        ));
    }
    Ok(())
}

/// Extrae el archivo y la configuración del Multipart
async fn extract_import_data(mut multipart: Multipart) -> Result<(Vec<u8>, ImportConfig), AppError> {
    let mut file_bytes = None;
    let mut config = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::Validation(e.to_string()))? {
        match field.name() {
            Some("file") => file_bytes = Some(field.bytes().await.map_err(|e| AppError::Validation(e.to_string()))?.to_vec()),
            Some("config") => {
                let text = field.text().await.map_err(|e| AppError::Validation(e.to_string()))?;
                config = Some(serde_json::from_str::<ImportConfig>(&text).map_err(|e| AppError::Validation(format!("Configuración inválida: {}", e)))?);
            }
            _ => {}
        }
    }

    let b = file_bytes.ok_or(AppError::Validation("Archivo no encontrado".into()))?;
    let c = config.ok_or(AppError::Validation("Configuración no encontrada".into()))?;
    Ok((b, c))
}

// === Handlers ===

/// GET /api/v1/setup/estado
async fn estado(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let finalizado = is_setup_finalizado(&state.pool).await?;
    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos").fetch_one(&state.pool).await?;
    Ok(Json(serde_json::json!({ "carga_inicial_completada": finalizado, "productos_cargados": productos.0 })))
}

/// POST /api/v1/setup/importar-productos (Mapeador Inteligente)
async fn importar_productos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> Result<Json<ImportResult>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    let (bytes, config) = extract_import_data(multipart).await?;
    let mut reader = csv::ReaderBuilder::new().trim(csv::Trim::All).from_reader(&bytes[..]);
    
    // Obtener cabeceras y mapear índices
    let headers = reader.headers().map_err(|e| AppError::Validation(format!("Error en cabeceras CSV: {}", e)))?.clone();
    let mut col_map = HashMap::new();
    for (name, target) in &config.mapping {
        if let Some(idx) = headers.iter().position(|h| h == target) {
            col_map.insert(name.as_str(), idx);
        }
    }

    let mut importados = 0;
    let mut errores = Vec::new();
    let mut preview = Vec::new();
    let mut total_filas = 0;

    // Transacción para Atomic Validation
    let mut tx = state.pool.begin().await?;

    for (idx, result) in reader.records().enumerate() {
        total_filas += 1;
        let fila_num = idx + 2; // +1 header, +1 0-based
        let record = match result {
            Ok(r) => r,
            Err(e) => { 
                errores.push(ImportError { fila: fila_num, mensaje: format!("Error de formato: {}", e) });
                continue;
            }
        };

        let get_val = |key: &str| col_map.get(key).and_then(|&i| record.get(i)).unwrap_or("");

        let nombre = get_val("nombre");
        let descripcion = get_val("descripcion");
        let unidad_nombre = get_val("unidad");
        let stock_minimo_str = get_val("stock_minimo");

        if nombre.is_empty() {
            errores.push(ImportError { fila: fila_num, mensaje: "El nombre es obligatorio".into() });
            continue;
        }

        // Validación de Unidad
        let unidad_id: Option<i32> = sqlx::query_scalar("SELECT id FROM unidades_basicas WHERE nombre = $1 OR nombre_plural = $1")
            .bind(unidad_nombre).fetch_optional(&mut *tx).await?;

        let u_id = match unidad_id {
            Some(id) => id,
            None => { 
                errores.push(ImportError { fila: fila_num, mensaje: format!("Unidad '{}' no existe", unidad_nombre) });
                continue;
            }
        };

        let stock_min = Decimal::from_str(stock_minimo_str).unwrap_or(Decimal::ZERO);

        if preview.len() < 50 {
            preview.push(serde_json::json!({
                "fila": fila_num,
                "nombre": nombre,
                "unidad": unidad_nombre,
                "stock_minimo": stock_min
            }));
        }

        if !config.dry_run && errores.is_empty() {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM productos WHERE nombre = $1)")
                .bind(nombre).fetch_one(&mut *tx).await?;
            
            if !exists {
                let codigo: String = sqlx::query_scalar("SELECT generar_codigo_producto()").fetch_one(&mut *tx).await?;
                sqlx::query("INSERT INTO productos (codigo_interno, nombre, descripcion, unidad_base_id, stock_minimo) VALUES ($1, $2, NULLIF($3, ''), $4, $5)")
                    .bind(&codigo).bind(nombre).bind(descripcion).bind(u_id).bind(stock_min).execute(&mut *tx).await?;
                importados += 1;
            }
        }
    }

    if config.dry_run || !errores.is_empty() {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }

    Ok(Json(ImportResult {
        total_filas,
        importados,
        errores: errores.clone(),
        preview,
        valido: total_filas > 0 && importados + errores.len() == total_filas && errores.is_empty(),
    }))
}

/// POST /api/v1/setup/importar-stock
async fn importar_stock(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    let mut file_bytes = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::Validation(e.to_string()))? {
        if field.name() == Some("file") {
            file_bytes = Some(field.bytes().await.map_err(|e| AppError::Validation(e.to_string()))?.to_vec());
        }
    }

    let bytes = file_bytes.ok_or(AppError::Validation("Archivo no encontrado".into()))?;
    let mut reader = csv::ReaderBuilder::new().trim(csv::Trim::All).from_reader(&bytes[..]);

    let mut importados = 0;
    let mut errores = Vec::new();
    let mut total_filas = 0;

    let mut tx = state.pool.begin().await?;

    for (idx, result) in reader.records().enumerate() {
        total_filas += 1;
        let fila_num = idx + 2;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Error de formato: {}", e) }));
                continue;
            }
        };

        // producto_nombre_o_codigo, numero_lote, fecha_vencimiento, area, cantidad, costo_unitario
        let prod_ref = record.get(0).unwrap_or("");
        let num_lote = record.get(1).unwrap_or("");
        let fecha_venc_str = record.get(2).unwrap_or("");
        let area_nombre = record.get(3).unwrap_or("");
        let cantidad_str = record.get(4).unwrap_or("");
        let costo_str = record.get(5).unwrap_or("");

        if prod_ref.is_empty() || num_lote.is_empty() || area_nombre.is_empty() {
            errores.push(serde_json::json!({ "fila": fila_num, "error": "Producto, Lote y Área son requeridos" }));
            continue;
        }

        // 1. Buscar producto
        let producto_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM productos WHERE nombre = $1 OR codigo_interno = $1"
        ).bind(prod_ref).fetch_optional(&mut *tx).await?;

        let p_id = match producto_id {
            Some(id) => id,
            None => {
                errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Producto '{}' no encontrado", prod_ref) }));
                continue;
            }
        };

        // 2. Buscar/Crear área
        let area_id: i32 = match sqlx::query_scalar("SELECT id FROM areas WHERE nombre = $1").bind(area_nombre).fetch_optional(&mut *tx).await? {
            Some(id) => id,
            None => {
                sqlx::query_scalar("INSERT INTO areas (nombre) VALUES ($1) RETURNING id").bind(area_nombre).fetch_one(&mut *tx).await?
            }
        };

        // 3. Validar fecha
        let fecha_venc = match chrono::NaiveDate::parse_from_str(fecha_venc_str, "%Y-%m-%d")
            .or_else(|_| chrono::NaiveDate::parse_from_str(fecha_venc_str, "%d/%m/%Y")) {
                Ok(d) => d,
                Err(_) => {
                    errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Fecha '{}' inválida (usar YYYY-MM-DD o DD/MM/YYYY)", fecha_venc_str) }));
                    continue;
                }
            };

        let cantidad = Decimal::from_str(cantidad_str).unwrap_or(Decimal::ZERO);
        let costo = Decimal::from_str(costo_str).ok();

        // 4. Buscar/Crear Lote
        let lote_id: uuid::Uuid = match sqlx::query_scalar(
            "SELECT id FROM lotes WHERE producto_id = $1 AND numero_lote = $2"
        ).bind(p_id).bind(num_lote).fetch_optional(&mut *tx).await? {
            Some(id) => id,
            None => {
                let cod_lote: String = sqlx::query_scalar("SELECT generar_codigo_lote()").fetch_one(&mut *tx).await?;
                sqlx::query_scalar(
                    "INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario) VALUES ($1, $2, $3, $4, $5) RETURNING id"
                ).bind(p_id).bind(num_lote).bind(fecha_venc).bind(&cod_lote).bind(costo).fetch_one(&mut *tx).await?
            }
        };

        // 5. Insertar/Actualizar Stock
        sqlx::query(
            "INSERT INTO stock (lote_id, area_id, cantidad) VALUES ($1, $2, $3)
             ON CONFLICT (lote_id, area_id) DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad"
        ).bind(lote_id).bind(area_id).bind(cantidad).execute(&mut *tx).await?;

        importados += 1;
    }

    if !errores.is_empty() {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }

    Ok(Json(serde_json::json!({
        "total_filas": total_filas,
        "importados": importados,
        "errores": errores.len(),
        "detalle_errores": errores
    })))
}

/// GET /api/v1/setup/resumen
async fn resumen(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    
    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos").fetch_one(&state.pool).await?;
    let presentaciones: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM presentaciones").fetch_one(&state.pool).await?;
    let lotes: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM lotes").fetch_one(&state.pool).await?;
    let stock_registros: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM stock WHERE cantidad > 0").fetch_one(&state.pool).await?;
    let categorias: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM categorias").fetch_one(&state.pool).await?;
    let areas: (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT area_id) FROM stock WHERE cantidad > 0").fetch_one(&state.pool).await?;

    Ok(Json(serde_json::json!({
        "productos": productos.0,
        "presentaciones": presentaciones.0,
        "lotes": lotes.0,
        "stock_registros": stock_registros.0,
        "categorias_creadas": categorias.0,
        "areas_con_stock": areas.0
    })))
}

/// POST /api/v1/setup/finalizar
async fn finalizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    sqlx::query(
        "INSERT INTO configuracion (clave, valor_texto) VALUES ('setup_finalizado', 'true')
         ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
    )
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "mensaje": "Configuración finalizada" })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/estado", get(estado))
        .route("/importar-productos", post(importar_productos))
        .route("/importar-stock", post(importar_stock))
        .route("/resumen", get(resumen))
        .route("/finalizar", post(finalizar))
}

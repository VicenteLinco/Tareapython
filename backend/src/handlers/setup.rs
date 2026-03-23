use axum::extract::{Multipart, Query, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::str::FromStr;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;
use crate::services::stock_ops;

// === Helpers ===

async fn is_setup_finalizado(pool: &sqlx::PgPool) -> Result<bool, AppError> {
    let valor: String = sqlx::query_scalar(
        "SELECT valor FROM configuracion_sistema WHERE clave = 'setup_finalizado'",
    )
    .fetch_one(pool)
    .await?;
    Ok(valor == "true")
}

async fn require_setup_mode(pool: &sqlx::PgPool) -> Result<(), AppError> {
    if is_setup_finalizado(pool).await? {
        return Err(AppError::BusinessLogic(
            "El modo setup ya fue finalizado. No se pueden realizar más cambios de carga inicial."
                .into(),
            "SETUP_FINALIZADO".into(),
        ));
    }
    Ok(())
}

const MAX_CSV_SIZE: usize = 5 * 1024 * 1024; // 5 MB

/// Extrae el contenido CSV del multipart upload (máximo 5 MB)
async fn extract_csv_bytes(mut multipart: Multipart) -> Result<Vec<u8>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Error leyendo multipart: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" || name == "archivo" {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::Validation(format!("Error leyendo archivo: {}", e)))?;
            if bytes.len() > MAX_CSV_SIZE {
                return Err(AppError::Validation(
                    "El archivo CSV excede el tamaño máximo de 5 MB".into(),
                ));
            }
            return Ok(bytes.to_vec());
        }
    }
    Err(AppError::Validation(
        "No se encontró campo 'file' en el upload".into(),
    ))
}

// === Handlers ===

/// GET /api/v1/setup/estado
async fn estado(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let finalizado = is_setup_finalizado(&state.pool).await?;

    let productos: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM productos")
            .fetch_one(&state.pool)
            .await?;

    let lotes: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM lotes")
            .fetch_one(&state.pool)
            .await?;

    Ok(Json(serde_json::json!({
        "carga_inicial_completada": finalizado,
        "productos_cargados": productos.0,
        "lotes_cargados": lotes.0,
    })))
}

/// POST /api/v1/setup/importar-productos
///
/// CSV esperado: nombre,descripcion,categoria,unidad_base,stock_minimo,presentacion_nombre,factor_conversion,codigo_barras
///
/// - Si la categoría no existe, se crea automáticamente.
/// - Si la unidad no existe, se reporta como error.
/// - Si el producto ya existe (por nombre), se omite.
/// - Presentaciones se agregan al producto.
async fn importar_productos(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    let csv_bytes = extract_csv_bytes(multipart).await?;
    let csv_str = String::from_utf8(csv_bytes)
        .map_err(|_| AppError::Validation("El archivo no es UTF-8 válido".into()))?;

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(csv_str.as_bytes());

    let mut importados = 0u32;
    let mut omitidos = 0u32;
    let mut errores: Vec<serde_json::Value> = Vec::new();
    let mut fila = 1u32; // 1-based, header es 0

    for result in reader.records() {
        fila += 1;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Error parseando CSV: {}", e)}));
                continue;
            }
        };

        // Campos: nombre, descripcion, categoria, unidad_base, stock_minimo, presentacion_nombre, factor_conversion, codigo_barras
        let nombre = record.get(0).unwrap_or("").trim();
        let descripcion = record.get(1).unwrap_or("").trim();
        let categoria_nombre = record.get(2).unwrap_or("").trim();
        let unidad_abrev = record.get(3).unwrap_or("").trim();
        let stock_minimo_str = record.get(4).unwrap_or("0").trim();
        let pres_nombre = record.get(5).unwrap_or("").trim();
        let factor_str = record.get(6).unwrap_or("").trim();
        let codigo_barras = record.get(7).unwrap_or("").trim();

        if nombre.is_empty() {
            errores.push(serde_json::json!({"fila": fila, "error": "Nombre vacío"}));
            continue;
        }

        // Buscar unidad
        let unidad_id: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM unidades_basicas WHERE nombre = $1 OR nombre_plural = $1",
        )
        .bind(unidad_abrev)
        .fetch_optional(&state.pool)
        .await?;

        let unidad_id = match unidad_id {
            Some(id) => id,
            None => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Unidad '{}' no reconocida", unidad_abrev)}));
                continue;
            }
        };

        // Buscar o crear categoría
        let categoria_id = if !categoria_nombre.is_empty() {
            let existing: Option<i32> =
                sqlx::query_scalar("SELECT id FROM categorias WHERE nombre = $1")
                    .bind(categoria_nombre)
                    .fetch_optional(&state.pool)
                    .await?;

            match existing {
                Some(id) => Some(id),
                None => {
                    let id: i32 = sqlx::query_scalar(
                        "INSERT INTO categorias (nombre) VALUES ($1) RETURNING id",
                    )
                    .bind(categoria_nombre)
                    .fetch_one(&state.pool)
                    .await?;
                    Some(id)
                }
            }
        } else {
            None
        };

        let stock_minimo = Decimal::from_str(stock_minimo_str).unwrap_or(Decimal::ZERO);

        // Verificar si producto ya existe
        let existing_id: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM productos WHERE nombre = $1")
                .bind(nombre)
                .fetch_optional(&state.pool)
                .await?;

        let producto_id = if let Some(id) = existing_id {
            omitidos += 1;
            id
        } else {
            // Generar código y crear
            let codigo: String = sqlx::query_scalar("SELECT generar_codigo_producto()")
                .fetch_one(&state.pool)
                .await?;

            let id: Uuid = sqlx::query_scalar(
                r#"INSERT INTO productos (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, stock_minimo)
                   VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6) RETURNING id"#,
            )
            .bind(&codigo)
            .bind(nombre)
            .bind(descripcion)
            .bind(categoria_id)
            .bind(unidad_id)
            .bind(stock_minimo)
            .fetch_one(&state.pool)
            .await?;

            importados += 1;
            id
        };

        // Crear presentación si se especificó
        if !pres_nombre.is_empty() && !factor_str.is_empty() {
            let factor = match Decimal::from_str(factor_str) {
                Ok(f) if f > Decimal::ZERO => f,
                _ => {
                    errores.push(serde_json::json!({"fila": fila, "error": format!("Factor de conversión inválido: '{}'", factor_str)}));
                    continue;
                }
            };

            // Verificar si ya existe la presentación para este producto
            let pres_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM presentaciones WHERE producto_id = $1 AND nombre = $2)",
            )
            .bind(producto_id)
            .bind(pres_nombre)
            .fetch_one(&state.pool)
            .await?;

            if !pres_exists {
                let cb = if codigo_barras.is_empty() {
                    None
                } else {
                    Some(codigo_barras)
                };
                let pres_plural = format!("{}s", pres_nombre);
                sqlx::query(
                    "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras) VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(producto_id)
                .bind(pres_nombre)
                .bind(&pres_plural)
                .bind(factor)
                .bind(cb)
                .execute(&state.pool)
                .await?;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "importados": importados,
        "omitidos": omitidos,
        "errores": errores.len(),
        "detalle_errores": errores,
    })))
}

/// POST /api/v1/setup/importar-stock
///
/// CSV esperado: producto_nombre_o_codigo,numero_lote,fecha_vencimiento,area,cantidad,costo_unitario
///
/// Genera movimientos tipo CARGA_INICIAL
async fn importar_stock(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    let csv_bytes = extract_csv_bytes(multipart).await?;
    let csv_str = String::from_utf8(csv_bytes)
        .map_err(|_| AppError::Validation("El archivo no es UTF-8 válido".into()))?;

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(csv_str.as_bytes());

    let mut importados = 0u32;
    let mut errores: Vec<serde_json::Value> = Vec::new();
    let mut fila = 1u32;
    let grupo = Uuid::new_v4();

    let mut tx = state.pool.begin().await?;

    for result in reader.records() {
        fila += 1;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Error CSV: {}", e)}));
                continue;
            }
        };

        let producto_ref = record.get(0).unwrap_or("").trim();
        let numero_lote = record.get(1).unwrap_or("").trim();
        let fecha_str = record.get(2).unwrap_or("").trim();
        let area_nombre = record.get(3).unwrap_or("").trim();
        let cantidad_str = record.get(4).unwrap_or("0").trim();
        let costo_str = record.get(5).unwrap_or("").trim();

        if producto_ref.is_empty() || numero_lote.is_empty() || fecha_str.is_empty() || area_nombre.is_empty() {
            errores.push(serde_json::json!({"fila": fila, "error": "Campos requeridos vacíos (producto, lote, fecha, área)"}));
            continue;
        }

        // Buscar producto por nombre o código
        let producto: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM productos WHERE nombre = $1 OR codigo_interno = $1",
        )
        .bind(producto_ref)
        .fetch_optional(&mut *tx)
        .await?;

        let producto_id = match producto {
            Some((id,)) => id,
            None => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Producto '{}' no encontrado", producto_ref)}));
                continue;
            }
        };

        // Parsear fecha
        let fecha_vencimiento = match NaiveDate::parse_from_str(fecha_str, "%Y-%m-%d") {
            Ok(f) => f,
            Err(_) => match NaiveDate::parse_from_str(fecha_str, "%d/%m/%Y") {
                Ok(f) => f,
                Err(_) => {
                    errores.push(serde_json::json!({"fila": fila, "error": format!("Fecha inválida: '{}'. Use YYYY-MM-DD o DD/MM/YYYY", fecha_str)}));
                    continue;
                }
            },
        };

        // Buscar área
        let area_id: Option<i32> =
            sqlx::query_scalar("SELECT id FROM areas WHERE nombre = $1")
                .bind(area_nombre)
                .fetch_optional(&mut *tx)
                .await?;

        let area_id = match area_id {
            Some(id) => id,
            None => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Área '{}' no encontrada", area_nombre)}));
                continue;
            }
        };

        let cantidad = match Decimal::from_str(cantidad_str) {
            Ok(c) if c > Decimal::ZERO => c,
            _ => {
                errores.push(serde_json::json!({"fila": fila, "error": format!("Cantidad inválida: '{}'", cantidad_str)}));
                continue;
            }
        };

        let costo = if costo_str.is_empty() {
            None
        } else {
            Decimal::from_str(costo_str).ok()
        };

        // Crear o reutilizar lote
        let lote_id = {
            let existing: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM lotes WHERE producto_id = $1 AND numero_lote = $2",
            )
            .bind(producto_id)
            .bind(numero_lote)
            .fetch_optional(&mut *tx)
            .await?;

            match existing {
                Some(id) => id,
                None => {
                    let codigo: String = sqlx::query_scalar("SELECT generar_codigo_lote()")
                        .fetch_one(&mut *tx)
                        .await?;

                    sqlx::query_scalar(
                        r#"INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
                           VALUES ($1, $2, $3, $4, $5) RETURNING id"#,
                    )
                    .bind(producto_id)
                    .bind(numero_lote)
                    .bind(fecha_vencimiento)
                    .bind(&codigo)
                    .bind(costo)
                    .fetch_one(&mut *tx)
                    .await?
                }
            }
        };

        // Aplicar ingreso tipo CARGA_INICIAL
        stock_ops::aplicar_ingreso(
            &mut tx,
            lote_id,
            area_id,
            cantidad,
            claims.sub,
            "CARGA_INICIAL",
            Some(grupo),
            None,
            Some("carga_inicial"),
        )
        .await?;

        // Auto-populate producto_area
        sqlx::query(
            "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(producto_id)
        .bind(area_id)
        .execute(&mut *tx)
        .await?;

        importados += 1;
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "importados": importados,
        "errores": errores.len(),
        "detalle_errores": errores,
        "grupo_movimiento": grupo,
    })))
}

/// GET /api/v1/setup/resumen
async fn resumen(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos")
        .fetch_one(&state.pool)
        .await?;
    let presentaciones: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM presentaciones")
        .fetch_one(&state.pool)
        .await?;
    let lotes: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM lotes")
        .fetch_one(&state.pool)
        .await?;
    let stock_registros: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM stock WHERE cantidad > 0")
            .fetch_one(&state.pool)
            .await?;
    let categorias: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM categorias")
        .fetch_one(&state.pool)
        .await?;
    let areas_con_stock: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT area_id) FROM stock WHERE cantidad > 0",
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "productos": productos.0,
        "presentaciones": presentaciones.0,
        "lotes": lotes.0,
        "stock_registros": stock_registros.0,
        "categorias_creadas": categorias.0,
        "areas_con_stock": areas_con_stock.0,
    })))
}

#[derive(Debug, Deserialize)]
struct ReiniciarQuery {
    confirmar: Option<bool>,
}

/// DELETE /api/v1/setup/reiniciar?confirmar=true
async fn reiniciar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ReiniciarQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    if params.confirmar != Some(true) {
        return Err(AppError::Validation(
            "Debe confirmar con ?confirmar=true".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    // Eliminar en orden inverso de dependencias
    sqlx::query("DELETE FROM recepcion_detalle").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM recepciones").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM movimientos").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM stock").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM lotes").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM producto_area").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM presentaciones").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM productos").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM idempotency_keys").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM audit_log").execute(&mut *tx).await?;

    // Reset secuencias
    sqlx::query("ALTER SEQUENCE seq_prd_numero RESTART WITH 1").execute(&mut *tx).await?;
    sqlx::query("ALTER SEQUENCE seq_lot_numero RESTART WITH 1").execute(&mut *tx).await?;
    sqlx::query("ALTER SEQUENCE seq_mov_numero RESTART WITH 1").execute(&mut *tx).await?;
    sqlx::query("ALTER SEQUENCE seq_rec_numero RESTART WITH 1").execute(&mut *tx).await?;

    tx.commit().await?;

    Ok(Json(serde_json::json!({
        "mensaje": "Setup reiniciado. Todos los datos importados fueron eliminados."
    })))
}

/// POST /api/v1/setup/finalizar
async fn finalizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    require_setup_mode(&state.pool).await?;

    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos")
        .fetch_one(&state.pool)
        .await?;
    let lotes: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM lotes")
        .fetch_one(&state.pool)
        .await?;

    sqlx::query(
        "UPDATE configuracion_sistema SET valor = 'true', updated_at = NOW() WHERE clave = 'setup_finalizado'",
    )
    .execute(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "mensaje": "Carga inicial completada",
        "total_productos": productos.0,
        "total_lotes": lotes.0,
    })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/estado", get(estado))
        .route("/importar-productos", post(importar_productos))
        .route("/importar-stock", post(importar_stock))
        .route("/resumen", get(resumen))
        .route("/reiniciar", axum::routing::delete(reiniciar))
        .route("/finalizar", post(finalizar))
}

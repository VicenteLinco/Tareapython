use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::{validate_text_length, AppError};
use crate::services::idempotency;
use crate::services::stock_ops;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct RecepcionQuery {
    proveedor_id: Option<i32>,
    estado: Option<String>,
    desde: Option<NaiveDate>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct RecepcionListItem {
    id: Uuid,
    numero_documento: String,
    proveedor_nombre: String,
    guia_despacho: Option<String>,
    estado: String,
    fecha_recepcion: DateTime<Utc>,
    usuario_nombre: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct CreateRecepcion {
    proveedor_id: i32,
    guia_despacho: Option<String>,
    estado: Option<String>, // "completa" o "borrador", default "completa"
    fecha_recepcion: DateTime<Utc>,
    nota: Option<String>,
    detalle: Vec<DetalleRecepcionInput>,
}

#[derive(Debug, Deserialize)]
struct DetalleRecepcionInput {
    producto_id: Uuid,
    numero_lote: String,
    fecha_vencimiento: NaiveDate,
    presentacion_id: Option<i32>,   // None = unidad base (factor 1)
    cantidad_presentaciones: Decimal,
    area_destino_id: i32,
    costo_unitario: Option<Decimal>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct DetalleRecepcionRow {
    id: i32,
    producto_nombre: String,
    numero_lote: String,
    presentacion_nombre: String,
    cantidad_presentaciones: Decimal,
    factor_conversion_usado: Decimal,
    cantidad_unidades_base: Decimal,
    area_destino: String,
}

// === Handlers ===

/// GET /api/v1/recepciones
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<RecepcionQuery>,
) -> Result<Json<Vec<RecepcionListItem>>, AppError> {
    let mut conditions = Vec::new();
    let mut param_idx = 0u32;

    if params.proveedor_id.is_some() {
        param_idx += 1;
        conditions.push(format!("r.proveedor_id = ${}", param_idx));
    }
    if params.estado.is_some() {
        param_idx += 1;
        conditions.push(format!("r.estado = ${}", param_idx));
    }
    if params.desde.is_some() {
        param_idx += 1;
        conditions.push(format!("r.fecha_recepcion >= ${}::date", param_idx));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        r#"SELECT r.id, r.numero_documento, p.nombre as proveedor_nombre,
                  r.guia_despacho, r.estado, r.fecha_recepcion,
                  u.nombre as usuario_nombre, r.created_at
           FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           {}
           ORDER BY r.created_at DESC
           LIMIT 100"#,
        where_clause
    );

    let mut query = sqlx::query_as::<_, RecepcionListItem>(&sql);
    if let Some(v) = params.proveedor_id {
        query = query.bind(v);
    }
    if let Some(v) = &params.estado {
        query = query.bind(v);
    }
    if let Some(v) = params.desde {
        query = query.bind(v);
    }

    let recepciones = query.fetch_all(&state.pool).await?;
    Ok(Json(recepciones))
}

/// GET /api/v1/recepciones/:id
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rec = sqlx::query_as::<_, RecepcionListItem>(
        r#"SELECT r.id, r.numero_documento, p.nombre as proveedor_nombre,
                  r.guia_despacho, r.estado, r.fecha_recepcion,
                  u.nombre as usuario_nombre, r.created_at
           FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           WHERE r.id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let detalle = sqlx::query_as::<_, DetalleRecepcionRow>(
        r#"SELECT rd.id, p.nombre as producto_nombre, l.numero_lote,
                  pr.nombre as presentacion_nombre,
                  rd.cantidad_presentaciones, rd.factor_conversion_usado,
                  rd.cantidad_unidades_base, a.nombre as area_destino
           FROM recepcion_detalle rd
           JOIN productos p ON p.id = rd.producto_id
           JOIN lotes l ON l.id = rd.lote_id
           JOIN presentaciones pr ON pr.id = rd.presentacion_id
           JOIN areas a ON a.id = rd.area_destino_id
           WHERE rd.recepcion_id = $1
           ORDER BY rd.id"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    // Nota de la recepción
    let nota: Option<String> = sqlx::query_scalar("SELECT nota FROM recepciones WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(serde_json::json!({
        "recepcion": rec,
        "nota": nota,
        "detalle": detalle,
    })))
}

/// POST /api/v1/recepciones — Crear recepción completa
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Json(req): Json<CreateRecepcion>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    if req.detalle.is_empty() {
        return Err(AppError::Validation("El detalle no puede estar vacío".into()));
    }
    if let Some(ref nota) = req.nota { validate_text_length(nota, "nota", 1000)?; }
    if let Some(ref guia) = req.guia_despacho { validate_text_length(guia, "guia_despacho", 100)?; }
    for det in &req.detalle {
        validate_text_length(&det.numero_lote, "numero_lote", 100)?;
    }

    let estado = req.estado.as_deref().unwrap_or("completa");
    let es_borrador = estado == "borrador";

    // Idempotency solo para recepciones completas
    let idem_key = if !es_borrador {
        let key = idempotency::extract_idempotency_key(&headers)?;
        if let Some((_status, body)) = idempotency::try_claim(&state.pool, &key, "POST /recepciones", claims.sub).await? {
            return Ok((StatusCode::CREATED, Json(body)));
        }
        Some(key)
    } else {
        None
    };

    // Validar duplicados de lote en el request
    let mut lotes_vistos = std::collections::HashSet::new();
    for det in &req.detalle {
        let key = (det.producto_id, det.numero_lote.clone());
        if !lotes_vistos.insert(key) {
            if let Some(ref k) = idem_key {
                idempotency::cleanup_on_error(&state.pool, k).await?;
            }
            return Err(AppError::BusinessLogic(
                format!("Lote duplicado en request: {}", det.numero_lote),
                "LOTE_DUPLICADO_EN_REQUEST".into(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;

    // Crear cabecera
    let recepcion_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id"#,
    )
    .bind(req.proveedor_id)
    .bind(&req.guia_despacho)
    .bind(estado)
    .bind(req.fecha_recepcion)
    .bind(claims.sub)
    .bind(&req.nota)
    .fetch_one(&mut *tx)
    .await?;

    let grupo = Uuid::new_v4();

    for det in &req.detalle {
        // Obtener factor de conversión (None = unidad base, factor 1)
        let factor: Decimal = if let Some(pres_id) = det.presentacion_id {
            sqlx::query_scalar(
                "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND activa = true",
            )
            .bind(pres_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound(format!(
                "Presentación {} no encontrada",
                pres_id
            )))?
        } else {
            Decimal::ONE
        };

        let cantidad_base = det.cantidad_presentaciones * factor;

        // Crear o reutilizar lote
        let lote_id = crear_o_reutilizar_lote(
            &mut tx,
            det.producto_id,
            &det.numero_lote,
            det.fecha_vencimiento,
            req.proveedor_id,
            det.costo_unitario,
        )
        .await?;

        // Insertar detalle
        sqlx::query(
            r#"INSERT INTO recepcion_detalle
               (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
                cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(recepcion_id)
        .bind(det.producto_id)
        .bind(lote_id)
        .bind(det.presentacion_id)   // Option<i32>, NULL si unidad base
        .bind(det.area_destino_id)
        .bind(det.cantidad_presentaciones)
        .bind(factor)
        .bind(cantidad_base)
        .execute(&mut *tx)
        .await?;

        // Solo generar stock y movimientos si NO es borrador
        if !es_borrador {
            stock_ops::aplicar_ingreso(
                &mut tx,
                lote_id,
                det.area_destino_id,
                cantidad_base,
                claims.sub,
                "INGRESO",
                Some(grupo),
                req.nota.as_deref(),
                Some("recepcion"),
            )
            .await?;

            // Auto-populate producto_area
            sqlx::query(
                r#"INSERT INTO producto_area (producto_id, area_id)
                   VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
            )
            .bind(det.producto_id)
            .bind(det.area_destino_id)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;

    let numero_doc: String =
        sqlx::query_scalar("SELECT numero_documento FROM recepciones WHERE id = $1")
            .bind(recepcion_id)
            .fetch_one(&state.pool)
            .await?;

    let response = serde_json::json!({
        "id": recepcion_id,
        "numero_documento": numero_doc,
        "estado": estado,
    });

    if let Some(ref k) = idem_key {
        idempotency::save_response(&state.pool, k, 201, &response).await?;
    }

    Ok((StatusCode::CREATED, Json(response)))
}

/// POST /api/v1/recepciones/borrador/:id/confirmar — Confirmar un borrador
async fn confirmar_borrador(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let idem_key = idempotency::extract_idempotency_key(&headers)?;
    if let Some((_status, body)) = idempotency::try_claim(&state.pool, &idem_key, "POST /recepciones/borrador/confirmar", claims.sub).await? {
        return Ok(Json(body));
    }

    let mut tx = state.pool.begin().await?;

    // Verificar que existe y es borrador
    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let estado = estado.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;
    if estado != "borrador" {
        tx.rollback().await?;
        idempotency::cleanup_on_error(&state.pool, &idem_key).await?;
        return Err(AppError::BusinessLogic(
            "Solo se pueden confirmar recepciones en estado borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    // Obtener detalle
    #[derive(sqlx::FromRow)]
    struct DetalleLine {
        producto_id: Uuid,
        lote_id: Uuid,
        area_destino_id: i32,
        cantidad_unidades_base: Decimal,
    }

    let lineas = sqlx::query_as::<_, DetalleLine>(
        "SELECT producto_id, lote_id, area_destino_id, cantidad_unidades_base FROM recepcion_detalle WHERE recepcion_id = $1",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    let grupo = Uuid::new_v4();
    let nota: Option<String> = sqlx::query_scalar("SELECT nota FROM recepciones WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;

    for linea in &lineas {
        stock_ops::aplicar_ingreso(
            &mut tx,
            linea.lote_id,
            linea.area_destino_id,
            linea.cantidad_unidades_base,
            claims.sub,
            "INGRESO",
            Some(grupo),
            nota.as_deref(),
            Some("recepcion"),
        )
        .await?;

        // Auto-populate producto_area
        sqlx::query(
            "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(linea.producto_id)
        .bind(linea.area_destino_id)
        .execute(&mut *tx)
        .await?;
    }

    // Actualizar estado
    sqlx::query("UPDATE recepciones SET estado = 'completa' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let response = serde_json::json!({
        "id": id,
        "estado": "completa",
        "grupo_movimiento": grupo,
    });

    idempotency::save_response(&state.pool, &idem_key, 200, &response).await?;

    Ok(Json(response))
}

/// DELETE /api/v1/recepciones/borrador/:id — Eliminar borrador
async fn eliminar_borrador(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let estado: Option<String> =
        sqlx::query_scalar("SELECT estado FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    let estado = estado.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;
    if estado != "borrador" {
        return Err(AppError::BusinessLogic(
            "Solo se pueden eliminar recepciones en estado borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    sqlx::query("DELETE FROM recepciones WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Helper: Crea lote o reutiliza si ya existe (mismo producto + numero_lote)
async fn crear_o_reutilizar_lote(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    producto_id: Uuid,
    numero_lote: &str,
    fecha_vencimiento: NaiveDate,
    proveedor_id: i32,
    costo_unitario: Option<Decimal>,
) -> Result<Uuid, AppError> {
    // Intentar encontrar lote existente
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM lotes WHERE producto_id = $1 AND numero_lote = $2",
    )
    .bind(producto_id)
    .bind(numero_lote)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(lote_id) = existing {
        return Ok(lote_id);
    }

    // Crear nuevo lote
    let codigo: String = sqlx::query_scalar("SELECT generar_codigo_lote()")
        .fetch_one(&mut **tx)
        .await?;

    let lote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id"#,
    )
    .bind(producto_id)
    .bind(proveedor_id)
    .bind(numero_lote)
    .bind(fecha_vencimiento)
    .bind(&codigo)
    .bind(costo_unitario)
    .fetch_one(&mut **tx)
    .await?;

    Ok(lote_id)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener))
        .route("/borrador/{id}/confirmar", post(confirmar_borrador))
        .route("/borrador/{id}", axum::routing::delete(eliminar_borrador))
}

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
use crate::services::storage;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct RecepcionQuery {
    proveedor_id: Option<i32>,
    estado: Option<String>,
    desde: Option<NaiveDate>,
    hasta: Option<NaiveDate>,
    busqueda: Option<String>,
    area_id: Option<i32>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize)]
struct PaginatedRecepciones {
    data: Vec<RecepcionListItem>,
    total: i64,
    page: i64,
    per_page: i64,
    total_pages: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct RecepcionListItem {
    id: Uuid,
    numero_documento: String,
    proveedor_nombre: String,
    proveedor_icono: Option<String>,
    guia_despacho: Option<String>,
    estado: String,
    fecha_recepcion: DateTime<Utc>,
    usuario_nombre: String,
    created_at: DateTime<Utc>,
    areas_destino: Option<String>,
    tiene_foto: bool,
    solicitud_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
struct SubirFotoInput {
    data_url: String,
}

#[derive(Debug, Deserialize)]
struct CreateRecepcion {
    proveedor_id: i32,
    guia_despacho: Option<String>,
    estado: Option<String>, // "completa" o "borrador", default "completa"
    fecha_recepcion: DateTime<Utc>,
    nota: Option<String>,
    solicitud_id: Option<Uuid>,
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
    fecha_vencimiento: NaiveDate,
    presentacion_nombre: String,
    cantidad_presentaciones: Decimal,
    factor_conversion_usado: Decimal,
    cantidad_unidades_base: Decimal,
    unidad_base_nombre: String,
    unidad_base_nombre_plural: String,
    area_destino: String,
}

// === Handlers ===

/// GET /api/v1/recepciones
async fn listar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<RecepcionQuery>,
) -> Result<Json<PaginatedRecepciones>, AppError> {
    if let Some(aid) = params.area_id {
        stock_ops::validar_acceso_area(&state.pool, claims.sub, aid, &claims.rol).await?;
    }

    let per_page = params.per_page.unwrap_or(15).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

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
    if params.hasta.is_some() {
        param_idx += 1;
        conditions.push(format!("r.fecha_recepcion < (${}::date + 1)", param_idx));
    }
    if params.busqueda.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "(r.numero_documento ILIKE ${0} OR p.nombre ILIKE ${0} OR r.guia_despacho ILIKE ${0})",
            param_idx
        ));
    }
    if params.area_id.is_some() {
        param_idx += 1;
        conditions.push(format!(
            "r.id IN (SELECT rd2.recepcion_id FROM recepcion_detalle rd2 WHERE rd2.area_destino_id = ${})",
            param_idx
        ));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // COUNT query
    let count_sql = format!(
        r#"SELECT COUNT(*) FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           {}"#,
        where_clause
    );

    let data_sql = format!(
        r#"SELECT r.id, r.numero_documento, p.nombre as proveedor_nombre,
                  p.icono as proveedor_icono, r.guia_despacho, r.estado, r.fecha_recepcion,
                  u.nombre as usuario_nombre, r.created_at,
                  (SELECT string_agg(DISTINCT a2.nombre, ', ' ORDER BY a2.nombre)
                   FROM recepcion_detalle rd2
                   JOIN areas a2 ON a2.id = rd2.area_destino_id
                   WHERE rd2.recepcion_id = r.id) as areas_destino,
                  (r.foto_documento IS NOT NULL) as tiene_foto,
                  r.solicitud_id
           FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           {}
           ORDER BY r.created_at DESC
           LIMIT {} OFFSET {}"#,
        where_clause, per_page, offset
    );

    // Bind parameters helper macro via closure
    macro_rules! bind_params {
        ($q:expr) => {{
            let mut q = $q;
            if let Some(v) = params.proveedor_id { q = q.bind(v); }
            if let Some(ref v) = params.estado { q = q.bind(v.clone()); }
            if let Some(v) = params.desde { q = q.bind(v); }
            if let Some(v) = params.hasta { q = q.bind(v); }
            if let Some(ref v) = params.busqueda { q = q.bind(format!("%{}%", v)); }
            if let Some(v) = params.area_id { q = q.bind(v); }
            q
        }};
    }

    let total: i64 = bind_params!(sqlx::query_scalar::<_, i64>(&count_sql))
        .fetch_one(&state.pool)
        .await?;

    let data = bind_params!(sqlx::query_as::<_, RecepcionListItem>(&data_sql))
        .fetch_all(&state.pool)
        .await?;

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    Ok(Json(PaginatedRecepciones { data, total, page, per_page, total_pages }))
}

/// GET /api/v1/recepciones/:id
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rec = sqlx::query_as::<_, RecepcionListItem>(
        r#"SELECT r.id, r.numero_documento, p.nombre as proveedor_nombre,
                  p.icono as proveedor_icono, r.guia_despacho, r.estado, r.fecha_recepcion,
                  u.nombre as usuario_nombre, r.created_at,
                  NULL::text as areas_destino,
                  (r.foto_documento IS NOT NULL) as tiene_foto,
                  r.solicitud_id
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
        r#"SELECT rd.id, p.nombre as producto_nombre, l.numero_lote, l.fecha_vencimiento,
                  COALESCE(pr.nombre, 'Unidad base') as presentacion_nombre,
                  rd.cantidad_presentaciones, rd.factor_conversion_usado,
                  rd.cantidad_unidades_base,
                  ub.nombre as unidad_base_nombre,
                  ub.nombre_plural as unidad_base_nombre_plural,
                  a.nombre as area_destino
           FROM recepcion_detalle rd
           JOIN productos p ON p.id = rd.producto_id
           JOIN lotes l ON l.id = rd.lote_id
           LEFT JOIN presentaciones pr ON pr.id = rd.presentacion_id
           JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
           JOIN areas a ON a.id = rd.area_destino_id
           WHERE rd.recepcion_id = $1
           ORDER BY rd.id"#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    // Nota, foto y timestamp de foto
    let (nota, foto_documento, foto_actualizada_at): (Option<String>, Option<String>, Option<DateTime<Utc>>) =
        sqlx::query_as("SELECT nota, foto_documento, foto_actualizada_at FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    Ok(Json(serde_json::json!({
        "recepcion": rec,
        "nota": nota,
        "foto_documento": foto_documento,
        "foto_actualizada_at": foto_actualizada_at,
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

    // Ordenar detalle por producto_id para prevenir deadlocks
    let mut detalle_ordenado = req.detalle;
    detalle_ordenado.sort_by_key(|d| d.producto_id);

    // Crear cabecera
    let recepcion_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota, solicitud_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
    )
    .bind(req.proveedor_id)
    .bind(&req.guia_despacho)
    .bind(estado)
    .bind(req.fecha_recepcion)
    .bind(claims.sub)
    .bind(&req.nota)
    .bind(req.solicitud_id)
    .fetch_one(&mut *tx)
    .await?;

    let grupo = Uuid::new_v4();

    for det in &detalle_ordenado {
        // Obtener factor de conversión (None = unidad base, factor 1)
        let factor: Decimal = if let Some(pres_id) = det.presentacion_id {
            sqlx::query_scalar(
                "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND producto_id = $2 AND activa = true",
            )
            .bind(pres_id)
            .bind(det.producto_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::Validation(format!(
                "La presentación {} no pertenece al producto {}",
                pres_id, det.producto_id
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

    // Si es completa y viene de una solicitud, marcarla como completada
    if !es_borrador && let Some(sid) = req.solicitud_id {
            sqlx::query("UPDATE solicitudes_compra SET estado = 'completada' WHERE id = $1")
                .bind(sid)
                .execute(&mut *tx)
                .await?;
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
    let res: Option<(String, Option<Uuid>)> =
        sqlx::query_as("SELECT estado, solicitud_id FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

    let (estado, solicitud_id) = res.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;
    
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

    let mut lineas = sqlx::query_as::<_, DetalleLine>(
        "SELECT producto_id, lote_id, area_destino_id, cantidad_unidades_base FROM recepcion_detalle WHERE recepcion_id = $1",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;

    // Ordenar por producto_id para evitar deadlocks
    lineas.sort_by_key(|l| l.producto_id);

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

    // Si viene de una solicitud, marcarla como completada
    if let Some(sid) = solicitud_id {
        sqlx::query("UPDATE solicitudes_compra SET estado = 'completada' WHERE id = $1")
            .bind(sid)
            .execute(&mut *tx)
            .await?;
    }

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

/// PUT /api/v1/recepciones/:id/foto — Subir o reemplazar foto de factura/guía
async fn subir_foto(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<SubirFotoInput>,
) -> Result<StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    // 1. Obtener la ruta de la foto actual (si existe) para eliminarla
    let old_foto: Option<String> = sqlx::query_scalar("SELECT foto_documento FROM recepciones WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .flatten();

    // 2. Guardar la nueva imagen en disco
    let file_path = storage::save_base64_image(&req.data_url, "recepciones", &format!("rec_{}", id)).await?;

    // 3. Actualizar la base de datos con la RUTA relativa
    let rows = sqlx::query(
        "UPDATE recepciones SET foto_documento = $1, foto_actualizada_at = NOW() WHERE id = $2",
    )
    .bind(&file_path)
    .bind(id)
    .execute(&state.pool)
    .await?;

    if rows.rows_affected() == 0 {
        // Si no se actualizó nada, limpiar el archivo recién creado para no dejar basura
        let _ = storage::delete_image(&file_path).await;
        return Err(AppError::NotFound("Recepción no encontrada".into()));
    }

    // 4. Si la actualización fue exitosa, intentar borrar la foto vieja del disco
    if let Some(old) = old_foto {
        // Solo borrar si es una ruta (no un base64 heredado)
        if !old.starts_with("data:image") {
            let _ = storage::delete_image(&old).await;
        }
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('recepciones', $1, 'UPDATE', $2)"
    )
    .bind(id.to_string())
    .bind(claims.sub)
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
    // Generar código siempre; si hay conflicto, el INSERT lo descarta
    let codigo: String = sqlx::query_scalar("SELECT generar_codigo_lote()")
        .fetch_one(&mut **tx)
        .await?;

    // ON CONFLICT garantiza atomicidad: no hay race condition entre SELECT e INSERT
    // DO UPDATE con SET no-op asegura que RETURNING siempre devuelva el id
    let lote_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (producto_id, numero_lote) DO UPDATE SET numero_lote = EXCLUDED.numero_lote
           RETURNING id"#,
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
        // Foto: body limit propio de 15MB (base64 de imagen)
        .route(
            "/{id}/foto",
            axum::routing::put(subir_foto)
                .layer(axum::extract::DefaultBodyLimit::max(15 * 1024 * 1024)),
        )
        .route("/borrador/{id}/confirmar", post(confirmar_borrador))
        .route("/borrador/{id}", axum::routing::delete(eliminar_borrador))
}

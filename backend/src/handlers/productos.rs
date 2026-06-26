use axum::extract::{Multipart, Path, Query, State};
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::domain::{ControlLote, EstadoCatalogo, OrigenRegistro};
use crate::dto::pagination::{PaginatedResponse, PaginationParams};
use crate::errors::{AppError, validate_text_length};
use crate::models::producto::Producto;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct ProductoQuery {
    q: Option<String>,
    categoria_id: Option<i32>,
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    activo: Option<bool>,
    sort_by: Option<String>,
    sort_dir: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type)]
struct ProductoListItem {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
    categoria: Option<CategoriaRef>,
    unidad_base: UnidadRef,
    area: Option<AreaRef>,
    lead_time_propio: Option<i32>,
    activo: bool,
    estado_stock: String,
    imagen_url: Option<String>,
    control_lote: ControlLote,
    mpn: Option<String>,
    alias_unidad_clinica: Option<String>,
    es_kit: bool,
    stock_minimo_global: Decimal,
    codigo_loinc_cpt: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct CategoriaRef {
    pub id: i32,
    pub nombre: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct UnidadRef {
    pub id: i32,
    pub nombre: String,
    pub nombre_plural: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct AreaRef {
    pub id: i32,
    pub nombre: String,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreatePresentacionInline {
    pub nombre: String,
    pub nombre_plural: String,
    pub factor_conversion: Decimal,
    pub codigo_barras: Option<String>,
    pub gtin: Option<String>,
    pub gs1_habilitado: Option<bool>,
    pub sku: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
struct CreateProducto {
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    ubicacion: Option<String>,
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    fabricante: Option<String>,
    mpn: Option<String>,
    alias_unidad_clinica: Option<String>,
    es_kit: Option<bool>,
    stock_minimo_global: Option<Decimal>,
    codigo_loinc_cpt: Option<String>,
    // Política de lote (default 'con_vto' si se omite)
    control_lote: Option<ControlLote>,
    // Extra presentations still supported
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
    estado_catalogo: Option<EstadoCatalogo>,
    origen_registro: Option<OrigenRegistro>,
}

#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    ubicacion: Option<String>,
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    fabricante: Option<String>,
    mpn: Option<String>,
    alias_unidad_clinica: Option<String>,
    es_kit: Option<bool>,
    stock_minimo_global: Option<Decimal>,
    codigo_loinc_cpt: Option<String>,
    control_lote: Option<ControlLote>,
    area_ids: Option<Vec<i32>>,
    version: i32,
}

// === Barcode alias structs ===

#[derive(Deserialize)]
struct AgregarCodigoRequest {
    codigo: String,
}

#[derive(Deserialize)]
struct AsignarCodigoRequest {
    codigo: String,
    producto_id: Uuid,
}

use crate::services::producto_service::{
    CodigoBarras, ListarProductosParams, ProductoRow, ProductoService,
};

// === Handlers ===

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProductoQuery>,
) -> Result<Json<PaginatedResponse<ProductoListItem>>, AppError> {
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();

    let (rows, total) = ProductoService::listar(
        &state.pool,
        ListarProductosParams {
            q: params.q,
            categoria_id: params.categoria_id,
            area_id: params.area_id,
            proveedor_id: params.proveedor_id,
            activo: params.activo.unwrap_or(true),
            sort_by: params.sort_by,
            sort_dir: params.sort_dir,
            limit,
            offset: pagination.offset(),
        },
    )
    .await?;

    let data: Vec<ProductoListItem> = rows
        .into_iter()
        .map(|r: ProductoRow| ProductoListItem {
            id: r.id,
            codigo_interno: r.codigo_interno,
            nombre: r.nombre,
            categoria: r.cat_id.map(|id| CategoriaRef {
                id,
                nombre: r.cat_nombre.unwrap_or_default(),
            }),
            unidad_base: UnidadRef {
                id: r.um_id,
                nombre: r.um_nombre,
                nombre_plural: r.um_nombre_plural,
            },
            area: r.area_id.map(|id| AreaRef {
                id,
                nombre: r.area_nombre.unwrap_or_default(),
            }),
            lead_time_propio: r.lead_time_propio,
            activo: r.activo,
            estado_stock: r.estado_stock,
            imagen_url: r.imagen_url,
            control_lote: r.control_lote,
            mpn: r.mpn,
            alias_unidad_clinica: r.alias_unidad_clinica,
            es_kit: r.es_kit,
            stock_minimo_global: r.stock_minimo_global,
            codigo_loinc_cpt: r.codigo_loinc_cpt,
        })
        .collect();

    Ok(Json(PaginatedResponse {
        data,
        total,
        page: pagination.page(),
        per_page: limit,
    }))
}

async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut detalle = ProductoService::obtener_detalle(&state.pool, id).await?;

    let codigos_barras = ProductoService::listar_codigos(&state.pool, id).await?;
    detalle["codigos_barras"] = json!(codigos_barras);

    Ok(Json(detalle))
}

async fn historial_precios(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let historial = ProductoService::historial_precios(&state.pool, id).await?;
    Ok(Json(historial))
}

async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateProducto>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), AppError> {
    // Si el producto se registra en cuarentena (pendiente_aprobacion), permitimos que un tecnólogo también lo cree.
    // Esto es necesario para el flujo de recepción automatizada (Zero-Friction).
    if req.estado_catalogo == Some(crate::domain::EstadoCatalogo::PendienteAprobacion) {
        crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;
    } else {
        crate::auth::middleware::require_role(&["admin"])(&claims)?;
    }

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    if let Some(ref desc) = req.descripcion {
        validate_text_length(desc, "descripcion", 1000)?;
    }

    let producto = ProductoService::crear_producto(
        &state.pool,
        crate::services::producto_service::CrearProductoParams {
            nombre,
            descripcion: req.descripcion,
            categoria_id: req.categoria_id,
            unidad_base_id: req.unidad_base_id,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio.unwrap_or(false),
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            fabricante: req.fabricante,
            mpn: req.mpn,
            alias_unidad_clinica: req.alias_unidad_clinica,
            es_kit: req.es_kit.unwrap_or(false),
            stock_minimo_global: req.stock_minimo_global.unwrap_or(Decimal::ZERO),
            codigo_loinc_cpt: req.codigo_loinc_cpt,
            presentaciones: req.presentaciones,
            control_lote: req.control_lote.unwrap_or(ControlLote::ConVto),
            area_ids: req.area_ids,
            usuario_id: claims.sub,
            estado_catalogo: req.estado_catalogo,
            origen_registro: req.origen_registro,
        },
    )
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "id": producto.id,
            "codigo_interno": producto.codigo_interno,
            "nombre": producto.nombre,
        })),
    ))
}

async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateProducto>,
) -> Result<Json<Producto>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or("");
    if req.nombre.is_some() && nombre.is_empty() {
        return Err(AppError::Validation(
            "El nombre no puede estar vacío".into(),
        ));
    }

    let producto = ProductoService::actualizar_producto(
        &state.pool,
        crate::services::producto_service::ActualizarProductoParams {
            id,
            nombre: nombre.to_string(),
            descripcion: req.descripcion,
            categoria_id: req.categoria_id,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio,
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            fabricante: req.fabricante,
            mpn: req.mpn,
            alias_unidad_clinica: req.alias_unidad_clinica,
            es_kit: req.es_kit,
            stock_minimo_global: req.stock_minimo_global,
            codigo_loinc_cpt: req.codigo_loinc_cpt,
            control_lote: req.control_lote,
            area_ids: req.area_ids,
            version_esperada: req.version,
            usuario_id: claims.sub,
        },
    )
    .await?;

    Ok(Json(producto))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    ProductoService::eliminar_producto(&state.pool, id, claims.sub).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn reactivar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Producto>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let producto = ProductoService::reactivar_producto(&state.pool, id, claims.sub).await?;

    Ok(Json(producto))
}

/// GET /api/v1/productos/scan?codigo=<barcode>
/// Looks up a product by presentation barcode or internal code
async fn scan_barcode(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ScanQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let codigo = params.codigo.as_deref().unwrap_or("");
    let resultado = ProductoService::buscar_por_codigo(&state.pool, codigo, claims.sub).await?;
    Ok(Json(resultado))
}

/// GET /api/v1/productos/scan/lookup?codigo=<barcode>
/// Read-only lookup check for manual dialogs
async fn scan_lookup(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(params): Query<ScanQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let codigo = params.codigo.as_deref().unwrap_or("");
    let resultado = ProductoService::lookup_gtin(&state.pool, codigo).await?;
    Ok(Json(resultado))
}

#[derive(Debug, Deserialize)]
struct ScanQuery {
    codigo: Option<String>,
}

async fn subir_imagen(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let imagen_actual = match ProductoService::imagen_actual(&state.pool, id).await? {
        None => return Err(AppError::NotFound("Producto no encontrado".into())),
        Some(url) => url,
    };

    if let Some(ref path) = imagen_actual {
        crate::services::storage::delete_image(path).await?;
    }

    let mut path = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError::Validation("Multipart invalido".into()))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let content_type = field.content_type().map(str::to_string);
        let bytes = field
            .bytes()
            .await
            .map_err(|_| AppError::Validation("No se pudo leer la imagen".into()))?;
        path = Some(
            crate::services::storage::save_image_bytes(
                &bytes,
                content_type.as_deref(),
                "productos",
                &id.to_string(),
            )
            .await?,
        );
        break;
    }

    let path = path.ok_or_else(|| AppError::Validation("Archivo requerido".into()))?;

    ProductoService::set_imagen(&state.pool, id, &path).await?;

    Ok(Json(json!({
        "imagen_url": format!("/api/v1/uploads/{}", path)
    })))
}

async fn quitar_imagen(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let imagen_actual = ProductoService::imagen_actual(&state.pool, id)
        .await?
        .flatten();

    if let Some(ref path) = imagen_actual {
        crate::services::storage::delete_image(path).await?;
        ProductoService::limpiar_imagen(&state.pool, id).await?;
    }

    Ok(Json(json!({ "ok": true })))
}

async fn listar_codigos(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<CodigoBarras>>, AppError> {
    let rows = ProductoService::listar_codigos(&state.pool, id).await?;
    Ok(Json(rows))
}

async fn agregar_codigo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<AgregarCodigoRequest>,
) -> Result<(axum::http::StatusCode, Json<CodigoBarras>), AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let row = ProductoService::agregar_codigo(&state.pool, id, &req.codigo).await?;
    Ok((axum::http::StatusCode::CREATED, Json(row)))
}

async fn eliminar_codigo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((id, codigo_id)): Path<(Uuid, i32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    ProductoService::eliminar_codigo(&state.pool, id, codigo_id).await?;
    Ok(Json(json!({})))
}

async fn asignar_codigo(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AsignarCodigoRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let row = ProductoService::agregar_codigo(&state.pool, req.producto_id, &req.codigo).await?;
    Ok(Json(json!({
        "id": row.id,
        "codigo": row.codigo,
        "producto_id": req.producto_id,
    })))
}

#[derive(Debug, Deserialize)]
pub struct ApproveProductInput {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: i32,
    pub unidad_base_id: i32,
    pub control_lote: ControlLote,
    pub fabricante: Option<String>,
    pub ubicacion: Option<String>,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: Option<bool>,
    pub stock_minimo_global: Option<Decimal>,
    pub codigo_loinc_cpt: Option<String>,
    pub pres_nombre: Option<String>,
    pub pres_nombre_plural: Option<String>,
    pub pres_factor: Option<Decimal>,
}

async fn list_quarantine(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<Producto>>, AppError> {
    crate::auth::middleware::require_role(&["admin", "tecnologo"])(&claims)?;

    let rows = sqlx::query_as::<_, Producto>(
        "SELECT * FROM productos WHERE estado_catalogo = 'pendiente_aprobacion' AND activo = true ORDER BY created_at DESC"
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

async fn approve_product(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(input): Json<ApproveProductInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    // Validation
    if input.nombre.trim().is_empty() {
        return Err(AppError::Validation(
            "El campo nombre es requerido".to_string(),
        ));
    }
    if input.nombre.chars().count() > 300 {
        return Err(AppError::Validation(
            "El nombre no puede superar los 300 caracteres".to_string(),
        ));
    }
    if let Some(ref desc) = input.descripcion {
        if desc.chars().count() > 2000 {
            return Err(AppError::Validation(
                "La descripción no puede superar los 2000 caracteres".to_string(),
            ));
        }
    }
    if let Some(ref fab) = input.fabricante {
        if fab.chars().count() > 300 {
            return Err(AppError::Validation(
                "El fabricante no puede superar los 300 caracteres".to_string(),
            ));
        }
    }
    if let Some(ref ubi) = input.ubicacion {
        if ubi.chars().count() > 200 {
            return Err(AppError::Validation(
                "La ubicación no puede superar los 200 caracteres".to_string(),
            ));
        }
    }

    // Co-dependency for presentation name and conversion factor
    if input.pres_factor.is_some() && input.pres_nombre.is_none() {
        return Err(AppError::Validation(
            "Se requiere nombre de presentación cuando se especifica el factor".to_string(),
        ));
    }
    if input.pres_nombre.is_some() && input.pres_factor.is_none() {
        return Err(AppError::Validation(
            "Se requiere factor de conversión cuando se especifica la presentación".to_string(),
        ));
    }

    if let Some(factor) = input.pres_factor {
        if factor <= Decimal::ZERO {
            return Err(AppError::Validation(
                "El factor de conversión debe ser mayor a 0".to_string(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;

    let prod_opt = sqlx::query_as::<_, Producto>("SELECT * FROM productos WHERE id = $1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;

    let prod = match prod_opt {
        Some(p) => p,
        None => return Err(AppError::NotFound("Producto no encontrado".to_string())),
    };

    if prod.estado_catalogo != crate::domain::EstadoCatalogo::PendienteAprobacion {
        return Err(AppError::Validation(
            "El producto ya está aprobado".to_string(),
        ));
    }

    // Stock scaling logic based on the existing presentation factor conversion
    let old_factor = sqlx::query_scalar::<_, Decimal>(
        "SELECT factor_conversion FROM presentaciones WHERE producto_id = $1 LIMIT 1"
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(Decimal::ONE);
    let old_factor = if old_factor.is_zero() { Decimal::ONE } else { old_factor };

    if let Some(new_factor) = input.pres_factor {
        if new_factor != old_factor {
            let multiplier = new_factor / old_factor;

            // Update stock
            sqlx::query(
                r#"UPDATE stock 
                   SET cantidad = (cantidad * $1)::NUMERIC(12,2)
                   WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $2)"#
            )
            .bind(multiplier)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(format!("Error al escalar stock: {}", e)))?;

            // Update movements
            sqlx::query(
                r#"UPDATE movimientos
                   SET cantidad = (cantidad * $1)::NUMERIC(12,2),
                       cantidad_resultante = (cantidad_resultante * $1)::NUMERIC(12,2)
                   WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $2)"#
            )
            .bind(multiplier)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(format!("Error al escalar stock: {}", e)))?;
        }
    }

    // Update product metadata in single update
    sqlx::query(
        r#"UPDATE productos 
           SET nombre = $1, descripcion = $2, categoria_id = $3, unidad_base_id = $4,
               control_lote = $5, fabricante = $6, ubicacion = $7,
               mpn = COALESCE($8, mpn),
               alias_unidad_clinica = COALESCE($9, alias_unidad_clinica),
               es_kit = COALESCE($10, es_kit),
               stock_minimo_global = COALESCE($11, stock_minimo_global),
               codigo_loinc_cpt = COALESCE($12, codigo_loinc_cpt),
               estado_catalogo = 'aprobado', updated_at = NOW()
           WHERE id = $13"#,
    )
    .bind(&input.nombre)
    .bind(&input.descripcion)
    .bind(input.categoria_id)
    .bind(input.unidad_base_id)
    .bind(&input.control_lote)
    .bind(&input.fabricante)
    .bind(&input.ubicacion)
    .bind(&input.mpn)
    .bind(&input.alias_unidad_clinica)
    .bind(input.es_kit)
    .bind(input.stock_minimo_global)
    .bind(&input.codigo_loinc_cpt)
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
            let msg = db_err.message();
            if msg.contains("categoria_id") {
                AppError::Validation("Categoría no válida".into())
            } else if msg.contains("unidad_base_id") {
                AppError::Validation("Unidad base no válida".into())
            } else {
                AppError::Validation("Categoría o unidad base no válida".into())
            }
        }
        _ => e.into(),
    })?;

    // Presentations sync
    if let (Some(pres_nombre), Some(pres_factor)) = (&input.pres_nombre, input.pres_factor) {
        let pres_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM presentaciones WHERE producto_id = $1)"
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;

        if pres_exists {
            sqlx::query(
                r#"UPDATE presentaciones 
                   SET nombre = $1, nombre_plural = $2, factor_conversion = $3
                   WHERE producto_id = $4"#
            )
            .bind(pres_nombre.trim())
            .bind(input.pres_nombre_plural.as_deref().unwrap_or(pres_nombre.as_str()).trim())
            .bind(pres_factor)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                r#"INSERT INTO presentaciones
                   (producto_id, nombre, nombre_plural, factor_conversion, activa)
                   VALUES ($1, $2, $3, $4, true)"#
            )
            .bind(id)
            .bind(pres_nombre.trim())
            .bind(input.pres_nombre_plural.as_deref().unwrap_or(pres_nombre.as_str()).trim())
            .bind(pres_factor)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;

    Ok(Json(
        json!({ "success": true, "message": "Producto aprobado con éxito" }),
    ))
}

async fn reject_product(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1 AND estado_catalogo = 'pendiente_aprobacion')"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    if !exists {
        return Err(AppError::NotFound(
            "Producto no encontrado o no está en cuarentena".to_string(),
        ));
    }

    ProductoService::eliminar_producto(&state.pool, id, claims.sub).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/quarantine", get(list_quarantine))
        .route("/scan", get(scan_barcode))
        .route("/scan/lookup", get(scan_lookup))
        .route("/scan/asignar", post(asignar_codigo))
        .route("/{id}/precios", get(historial_precios))
        .route("/{id}/codigos", get(listar_codigos).post(agregar_codigo))
        .route(
            "/{id}/codigos/{codigo_id}",
            axum::routing::delete(eliminar_codigo),
        )
        .route("/{id}/approve", post(approve_product))
        .route("/{id}/reject", post(reject_product))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
        .route("/{id}/reactivar", axum::routing::post(reactivar))
        .route(
            "/{id}/imagen",
            axum::routing::put(subir_imagen).delete(quitar_imagen),
        )
}

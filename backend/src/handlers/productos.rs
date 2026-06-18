use axum::extract::{Multipart, Path, Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
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
    sku: Option<String>,
    proveedor_id: Option<i32>,
    categoria: Option<CategoriaRef>,
    unidad_base: UnidadRef,
    proveedor: Option<ProveedorRef>,
    area: Option<AreaRef>,
    stock_minimo: Decimal,
    precio_unidad: Option<Decimal>,
    lead_time_propio: Option<i32>,
    activo: bool,
    estado_stock: String,
    imagen_url: Option<String>,
    pres_id: Option<i32>,
    pres_nombre: Option<String>,
    pres_nombre_plural: Option<String>,
    pres_factor: Option<Decimal>,
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

#[derive(Debug, Serialize, specta::Type)]
struct ProveedorRef {
    id: i32,
    nombre: String,
    icono: Option<String>,
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
    proveedor_id: Option<i32>,
    sku: Option<String>,
    precio_unidad: Option<Decimal>,
    stock_minimo: Option<Decimal>,
    ubicacion: Option<String>,
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    // Flat presentation
    pres_nombre: Option<String>,
    pres_nombre_plural: Option<String>,
    pres_factor: Option<Decimal>,
    pres_codigo_barras: Option<String>,
    pres_gtin: Option<String>,
    pres_gs1_habilitado: Option<bool>,
    // Extra presentations still supported
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    sku: Option<String>,
    precio_unidad: Option<Decimal>,
    stock_minimo: Option<Decimal>,
    ubicacion: Option<String>,
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    // Flat presentation
    pres_nombre: Option<String>,
    pres_nombre_plural: Option<String>,
    pres_factor: Option<Decimal>,
    pres_codigo_barras: Option<String>,
    pres_gtin: Option<String>,
    pres_gs1_habilitado: Option<bool>,
    area_ids: Option<Vec<i32>>,
    version: i32,
}

// === Row types for queries ===

#[derive(Debug, sqlx::FromRow)]
struct ProductoRow {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
    sku: Option<String>,
    stock_minimo: Decimal,
    precio_unidad: Option<Decimal>,
    lead_time_propio: Option<i32>,
    activo: bool,
    estado_stock: String,
    cat_id: Option<i32>,
    cat_nombre: Option<String>,
    um_id: i32,
    um_nombre: String,
    um_nombre_plural: String,
    prov_id: Option<i32>,
    prov_nombre: Option<String>,
    prov_icono: Option<String>,
    area_id: Option<i32>,
    area_nombre: Option<String>,
    imagen_url: Option<String>,
    pres_id: Option<i32>,
    pres_nombre: Option<String>,
    pres_nombre_plural: Option<String>,
    pres_factor: Option<Decimal>,
}

use crate::services::producto_service::ProductoService;

// === Handlers ===

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProductoQuery>,
) -> Result<Json<PaginatedResponse<ProductoListItem>>, AppError> {
    let activo = params.activo.unwrap_or(true);
    let pagination = PaginationParams {
        page: params.page,
        per_page: params.per_page,
    };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec!["p.activo = $1".to_string()];
    let mut param_idx = 2;

    if params.q.is_some() {
        conditions.push(format!(
            "(p.search_vector @@ plainto_tsquery('simple', ${0}) OR p.nombre ILIKE '%' || ${0} || '%' OR p.codigo_interno ILIKE '%' || ${0} || '%' OR p.sku ILIKE '%' || ${0} || '%')",
            param_idx
        ));
        param_idx += 1;
    }
    if params.categoria_id.is_some() {
        conditions.push(format!("p.categoria_id = ${}", param_idx));
        param_idx += 1;
    }
    if params.area_id.is_some() {
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM producto_area pa WHERE pa.producto_id = p.id AND pa.area_id = ${})",
            param_idx
        ));
        param_idx += 1;
    }
    if params.proveedor_id.is_some() {
        conditions.push(format!("p.proveedor_id = ${}", param_idx));
        param_idx += 1;
    }

    let where_clause = conditions.join(" AND ");
    let sort_col = match params.sort_by.as_deref() {
        Some("codigo") => "p.codigo_interno",
        Some("categoria") => "c.nombre",
        Some("proveedor") => "pr.nombre",
        Some("stock_minimo") => "p.stock_minimo",
        Some("estado") => "p.activo",
        _ => "p.nombre",
    };
    let sort_dir = match params.sort_dir.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM productos p WHERE {}",
        where_clause
    );
    let data_sql = format!(
        r#"SELECT p.id, p.codigo_interno, p.nombre, p.sku,
                  p.stock_minimo, p.precio_unidad, p.lead_time_propio, p.activo,
                  CASE
                      WHEN NOT p.activo THEN 'inactivo'
                      WHEN p.stock_minimo > 0
                           AND COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id), 0) <= 0
                           AND NOT EXISTS (SELECT 1 FROM movimientos m JOIN lotes lm ON lm.id = m.lote_id WHERE lm.producto_id = p.id)
                          THEN 'pendiente_inicializar'
                      WHEN p.stock_minimo > 0
                           AND COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id), 0) <= 0
                          THEN 'sin_stock'
                      ELSE 'activo'
                  END AS estado_stock,
                  p.imagen_url AS imagen_url,
                  c.id as cat_id, c.nombre as cat_nombre,
                  um.id as um_id, um.nombre as um_nombre, um.nombre_plural as um_nombre_plural,
                  pr.id as prov_id, pr.nombre as prov_nombre, pr.icono as prov_icono,
                  (SELECT a.id FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_id,
                  (SELECT a.nombre FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_nombre,
                  (SELECT id FROM presentaciones WHERE producto_id = p.id AND activa = true ORDER BY factor_conversion DESC LIMIT 1) as pres_id,
                  p.pres_nombre,
                  p.pres_nombre_plural,
                  p.pres_factor
           FROM productos p
           LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
           LEFT JOIN categorias c ON c.id = p.categoria_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           WHERE {}
           ORDER BY {} {} NULLS LAST, p.nombre ASC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        sort_col,
        sort_dir,
        param_idx,
        param_idx + 1
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql).bind(activo);
    let mut data_query = sqlx::query_as::<_, ProductoRow>(&data_sql).bind(activo);

    if let Some(q) = &params.q {
        count_query = count_query.bind(q.clone());
        data_query = data_query.bind(q.clone());
    }
    if let Some(cat_id) = params.categoria_id {
        count_query = count_query.bind(cat_id);
        data_query = data_query.bind(cat_id);
    }
    if let Some(area_id) = params.area_id {
        count_query = count_query.bind(area_id);
        data_query = data_query.bind(area_id);
    }
    if let Some(prov_id) = params.proveedor_id {
        count_query = count_query.bind(prov_id);
        data_query = data_query.bind(prov_id);
    }

    data_query = data_query.bind(limit).bind(offset);

    let total = count_query.fetch_one(&state.pool).await?;
    let rows = data_query.fetch_all(&state.pool).await?;

    let data: Vec<ProductoListItem> = rows
        .into_iter()
        .map(|r| ProductoListItem {
            id: r.id,
            codigo_interno: r.codigo_interno,
            nombre: r.nombre,
            sku: r.sku,
            proveedor_id: r.prov_id,
            categoria: r.cat_id.map(|id| CategoriaRef {
                id,
                nombre: r.cat_nombre.unwrap_or_default(),
            }),
            unidad_base: UnidadRef {
                id: r.um_id,
                nombre: r.um_nombre,
                nombre_plural: r.um_nombre_plural,
            },
            proveedor: r.prov_id.map(|id| ProveedorRef {
                id,
                nombre: r.prov_nombre.unwrap_or_default(),
                icono: r.prov_icono,
            }),
            area: r.area_id.map(|id| AreaRef {
                id,
                nombre: r.area_nombre.unwrap_or_default(),
            }),
            stock_minimo: r.stock_minimo,
            precio_unidad: r.precio_unidad,
            lead_time_propio: r.lead_time_propio,
            activo: r.activo,
            estado_stock: r.estado_stock,
            imagen_url: r.imagen_url,
            pres_id: r.pres_id,
            pres_nombre: r.pres_nombre,
            pres_nombre_plural: r.pres_nombre_plural,
            pres_factor: r.pres_factor,
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
    let detalle = ProductoService::obtener_detalle(&state.pool, id).await?;
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
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

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
            proveedor_id: req.proveedor_id,
            sku: req.sku,
            precio_unidad: req.precio_unidad,
            stock_minimo: req.stock_minimo,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio.unwrap_or(false),
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            pres_nombre: req.pres_nombre,
            pres_nombre_plural: req.pres_nombre_plural,
            pres_factor: req.pres_factor,
            pres_codigo_barras: req.pres_codigo_barras,
            pres_gtin: req.pres_gtin,
            pres_gs1_habilitado: req.pres_gs1_habilitado.unwrap_or(false),
            presentaciones: req.presentaciones,
            area_ids: req.area_ids,
            usuario_id: claims.sub,
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
            proveedor_id: req.proveedor_id,
            sku: req.sku,
            precio_unidad: req.precio_unidad,
            stock_minimo: req.stock_minimo,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio,
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            pres_nombre: req.pres_nombre,
            pres_nombre_plural: req.pres_nombre_plural,
            pres_factor: req.pres_factor,
            pres_codigo_barras: req.pres_codigo_barras,
            pres_gtin: req.pres_gtin,
            pres_gs1_habilitado: req.pres_gs1_habilitado,
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
    Query(params): Query<ScanQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let codigo = params.codigo.as_deref().unwrap_or("");
    let resultado = ProductoService::buscar_por_codigo(&state.pool, codigo).await?;
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

    let imagen_actual: Option<String> =
        sqlx::query_scalar("SELECT imagen_url FROM productos WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();

    if imagen_actual.is_none() {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1)")
                .bind(id)
                .fetch_one(&state.pool)
                .await?;
        if !exists {
            return Err(AppError::NotFound("Producto no encontrado".into()));
        }
    }

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

    sqlx::query("UPDATE productos SET imagen_url = $1 WHERE id = $2")
        .bind(&path)
        .bind(id)
        .execute(&state.pool)
        .await?;

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

    let imagen_actual: Option<String> =
        sqlx::query_scalar("SELECT imagen_url FROM productos WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();

    if let Some(ref path) = imagen_actual {
        crate::services::storage::delete_image(path).await?;
        sqlx::query("UPDATE productos SET imagen_url = NULL WHERE id = $1")
            .bind(id)
            .execute(&state.pool)
            .await?;
    }

    Ok(Json(json!({ "ok": true })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/scan", get(scan_barcode))
        .route("/{id}/precios", get(historial_precios))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
        .route("/{id}/reactivar", axum::routing::post(reactivar))
        .route(
            "/{id}/imagen",
            axum::routing::put(subir_imagen).delete(quitar_imagen),
        )
}

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Extension, Json, Router};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::dto::pagination::{PaginatedResponse, PaginationParams};
use crate::errors::{validate_text_length, AppError};
use crate::models::producto::Producto;

// === DTOs ===

#[derive(Debug, Deserialize)]
struct ProductoQuery {
    q: Option<String>,
    categoria_id: Option<i32>,
    area_id: Option<i32>,
    proveedor_id: Option<i32>,
    activo: Option<bool>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type)]
struct ProductoListItem {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    categoria: Option<CategoriaRef>,
    unidad_base: UnidadRef,
    proveedor: Option<ProveedorRef>,
    area: Option<AreaRef>,
    stock_minimo: Decimal,
    activo: bool,
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
struct CreateProducto {
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreatePresentacionInline {
    pub nombre: String,
    pub nombre_plural: String,
    pub factor_conversion: Decimal,
    pub codigo_barras: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    area_ids: Option<Vec<i32>>,
    version: i32,
}

// === Row types for queries ===

#[derive(Debug, sqlx::FromRow)]
struct ProductoRow {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Decimal,
    activo: bool,
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
}

use crate::services::producto_service::ProductoService;

// === Handlers ===

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProductoQuery>,
) -> Result<Json<PaginatedResponse<ProductoListItem>>, AppError> {
    // ... (listar se mantendrá aquí por ahora ya que es muy específico de la UI,
    // pero en una fase 2 se podría mover a un QueryService)
    let activo = params.activo.unwrap_or(true);
    let pagination = PaginationParams { page: params.page, per_page: params.per_page };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec!["p.activo = $1".to_string()];
    let mut param_idx = 2;

    if params.q.is_some() {
        conditions.push(format!(
            "(p.nombre ILIKE ${0} OR p.codigo_interno ILIKE ${0} OR p.codigo_proveedor ILIKE ${0} OR p.codigo_maestro ILIKE ${0})",
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

    let count_sql = format!(
        "SELECT COUNT(*) FROM productos p WHERE {}",
        where_clause
    );
    let data_sql = format!(
        r#"SELECT p.id, p.codigo_interno, p.nombre, p.codigo_proveedor, p.codigo_maestro,
                  p.stock_minimo, p.activo,
                  c.id as cat_id, c.nombre as cat_nombre,
                  um.id as um_id, um.nombre as um_nombre, um.nombre_plural as um_nombre_plural,
                  pr.id as prov_id, pr.nombre as prov_nombre, pr.icono as prov_icono,
                  (SELECT a.id FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_id,
                  (SELECT a.nombre FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_nombre
           FROM productos p
           LEFT JOIN categorias c ON c.id = p.categoria_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
           WHERE {}
           ORDER BY p.nombre
           LIMIT ${} OFFSET ${}"#,
        where_clause, param_idx, param_idx + 1
    );

    let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql).bind(activo);
    let mut data_query = sqlx::query_as::<_, ProductoRow>(&data_sql).bind(activo);

    if let Some(q) = &params.q {
        let pattern = format!("%{}%", q);
        count_query = count_query.bind(pattern.clone());
        data_query = data_query.bind(pattern);
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
            codigo_proveedor: r.codigo_proveedor,
            codigo_maestro: r.codigo_maestro,
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
            activo: r.activo,
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
        nombre,
        req.descripcion,
        req.categoria_id,
        req.unidad_base_id,
        req.proveedor_id,
        req.codigo_proveedor,
        req.codigo_maestro,
        req.stock_minimo,
        req.presentaciones,
        req.area_ids,
        claims.sub,
    ).await?;

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
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }

    let producto = ProductoService::actualizar_producto(
        &state.pool,
        id,
        nombre.to_string(),
        req.descripcion,
        req.categoria_id,
        req.proveedor_id,
        req.codigo_proveedor,
        req.codigo_maestro,
        req.stock_minimo,
        req.area_ids,
        req.version,
        claims.sub,
    ).await?;

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
/// Busca un producto por código de barras de presentación o código interno
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

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/scan", get(scan_barcode))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
        .route("/{id}/reactivar", axum::routing::post(reactivar))
}

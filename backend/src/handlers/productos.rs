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
use crate::models::presentacion::Presentacion;
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

#[derive(Debug, Serialize)]
struct ProductoListItem {
    id: Uuid,
    codigo_interno: String,
    nombre: String,
    categoria: Option<CategoriaRef>,
    unidad_base: UnidadRef,
    proveedor: Option<ProveedorRef>,
    area: Option<AreaRef>,
    stock_minimo: Decimal,
    activo: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct CategoriaRef {
    id: i32,
    nombre: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct UnidadRef {
    id: i32,
    nombre: String,
    nombre_plural: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AreaRef {
    id: i32,
    nombre: String,
}

#[derive(Debug, Serialize)]
struct ProveedorRef {
    id: i32,
    nombre: String,
    icono: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateProducto {
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    proveedor_id: Option<i32>,
    stock_minimo: Option<Decimal>,
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
struct CreatePresentacionInline {
    nombre: String,
    factor_conversion: Decimal,
    codigo_barras: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
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

// === Handlers ===

async fn listar(
    State(state): State<AppState>,
    Query(params): Query<ProductoQuery>,
) -> Result<Json<PaginatedResponse<ProductoListItem>>, AppError> {
    let activo = params.activo.unwrap_or(true);
    let pagination = PaginationParams { page: params.page, per_page: params.per_page };
    let limit = pagination.per_page();
    let offset = pagination.offset();

    let mut conditions = vec!["p.activo = $1".to_string()];
    let mut param_idx = 2;

    if params.q.is_some() {
        conditions.push(format!(
            "(p.nombre ILIKE ${0} OR p.codigo_interno ILIKE ${0})",
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
        r#"SELECT p.id, p.codigo_interno, p.nombre, p.stock_minimo, p.activo,
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
    let producto = sqlx::query_as::<_, Producto>("SELECT * FROM productos WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

    let categoria = if let Some(cat_id) = producto.categoria_id {
        sqlx::query_as::<_, CategoriaRef>("SELECT id, nombre FROM categorias WHERE id = $1")
            .bind(cat_id)
            .fetch_optional(&state.pool)
            .await?
    } else {
        None
    };

    let unidad = sqlx::query_as::<_, UnidadRef>(
        "SELECT id, nombre, nombre_plural FROM unidades_basicas WHERE id = $1",
    )
    .bind(producto.unidad_base_id)
    .fetch_one(&state.pool)
    .await?;

    let proveedor = if let Some(prov_id) = producto.proveedor_id {
        #[derive(sqlx::FromRow, Serialize)]
        struct ProveedorDetailRef {
            id: i32,
            nombre: String,
            icono: Option<String>,
        }
        sqlx::query_as::<_, ProveedorDetailRef>(
            "SELECT id, nombre, icono FROM proveedores WHERE id = $1",
        )
        .bind(prov_id)
        .fetch_optional(&state.pool)
        .await?
        .map(|p| json!({"id": p.id, "nombre": p.nombre, "icono": p.icono}))
    } else {
        None
    };

    let presentaciones = sqlx::query_as::<_, Presentacion>(
        "SELECT * FROM presentaciones WHERE producto_id = $1 AND activa = true ORDER BY nombre",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    let areas: Vec<AreaRef> = sqlx::query_as(
        "SELECT a.id, a.nombre FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = $1 ORDER BY a.nombre",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "id": producto.id,
        "codigo_interno": producto.codigo_interno,
        "nombre": producto.nombre,
        "descripcion": producto.descripcion,
        "categoria": categoria,
        "unidad_base": unidad,
        "proveedor": proveedor,
        "stock_minimo": producto.stock_minimo,
        "presentaciones": presentaciones,
        "areas": areas,
        "activo": producto.activo,
        "version": producto.version,
        "created_at": producto.created_at,
        "updated_at": producto.updated_at,
    })))
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

    let mut tx = state.pool.begin().await?;

    let codigo: String =
        sqlx::query_scalar("SELECT generar_codigo_producto()")
            .fetch_one(&mut *tx)
            .await?;

    let producto = sqlx::query_as::<_, Producto>(
        r#"INSERT INTO productos (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, proveedor_id, stock_minimo)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *"#,
    )
    .bind(&codigo)
    .bind(&nombre)
    .bind(&req.descripcion)
    .bind(req.categoria_id)
    .bind(req.unidad_base_id)
    .bind(req.proveedor_id)
    .bind(req.stock_minimo.unwrap_or(Decimal::ZERO))
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
            AppError::Validation("Categoría, unidad, proveedor o área no existe".into())
        }
        _ => e.into(),
    })?;

    if let Some(presentaciones) = &req.presentaciones {
        for pres in presentaciones {
            sqlx::query(
                "INSERT INTO presentaciones (producto_id, nombre, factor_conversion, codigo_barras) VALUES ($1, $2, $3, $4)",
            )
            .bind(producto.id)
            .bind(pres.nombre.trim())
            .bind(pres.factor_conversion)
            .bind(&pres.codigo_barras)
            .execute(&mut *tx)
            .await?;
        }
    }

    if let Some(area_ids) = &req.area_ids {
        for area_id in area_ids {
            sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
                .bind(producto.id)
                .bind(area_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('productos', $1, 'CREATE', $2, $3)",
    )
    .bind(producto.id.to_string())
    .bind(json!({"codigo_interno": &producto.codigo_interno, "nombre": &producto.nombre}))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

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

    let anterior = sqlx::query_as::<_, Producto>("SELECT * FROM productos WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

    if req.version != anterior.version {
        return Err(AppError::Conflict(
            "El registro fue modificado por otro usuario".into(),
        ));
    }

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or(&anterior.nombre);
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }

    let new_proveedor_id = req.proveedor_id.or(anterior.proveedor_id);

    let mut tx = state.pool.begin().await?;

    let producto = sqlx::query_as::<_, Producto>(
        r#"UPDATE productos
           SET nombre = $1, descripcion = $2, categoria_id = $3, proveedor_id = $4, stock_minimo = $5,
               version = version + 1, updated_at = NOW()
           WHERE id = $6
           RETURNING *"#,
    )
    .bind(nombre)
    .bind(req.descripcion.as_deref().or(anterior.descripcion.as_deref()))
    .bind(req.categoria_id.or(anterior.categoria_id))
    .bind(new_proveedor_id)
    .bind(req.stock_minimo.unwrap_or(anterior.stock_minimo))
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(area_ids) = &req.area_ids {
        sqlx::query("DELETE FROM producto_area WHERE producto_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for area_id in area_ids {
            sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
                .bind(id)
                .bind(area_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('productos', $1, 'UPDATE', $2, $3, $4)",
    )
    .bind(id.to_string())
    .bind(json!({"nombre": &anterior.nombre, "version": anterior.version}))
    .bind(json!({"nombre": &producto.nombre, "version": producto.version}))
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(producto))
}

async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let stock_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = $1 AND s.cantidad > 0",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    if stock_count.0 > 0 {
        return Err(AppError::BusinessLogic(
            "No se puede eliminar: tiene stock activo".into(),
            "TIENE_STOCK".into(),
        ));
    }

    let result = sqlx::query(
        "UPDATE productos SET activo = false, updated_at = NOW() WHERE id = $1 AND activo = true",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Producto no encontrado".into()));
    }

    sqlx::query(
        "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('productos', $1, 'DELETE', $2)",
    )
    .bind(id.to_string())
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/{id}", get(obtener).put(actualizar).delete(eliminar))
}

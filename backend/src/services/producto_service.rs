use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::producto::Producto;

pub struct ProductoService;

pub struct CrearProductoParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub proveedor_id: Option<i32>,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_propio: Option<i32>,
    pub ubicacion: Option<String>,
    pub presentaciones: Option<Vec<crate::handlers::productos::CreatePresentacionInline>>,
    pub area_ids: Option<Vec<i32>>,
    pub usuario_id: Uuid,
}

pub struct ActualizarProductoParams {
    pub id: Uuid,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub proveedor_id: Option<i32>,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_propio: Option<i32>,
    pub ubicacion: Option<String>,
    pub area_ids: Option<Vec<i32>>,
    pub version_esperada: i32,
    pub usuario_id: Uuid,
}

impl ProductoService {
    /// Crea un nuevo producto con sus presentaciones y áreas asociadas
    pub async fn crear_producto(
        pool: &PgPool,
        params: CrearProductoParams,
    ) -> Result<Producto, AppError> {
        let mut tx = pool.begin().await?;

        let codigo: String = sqlx::query_scalar("SELECT generar_codigo_producto()")
            .fetch_one(&mut *tx)
            .await?;

        let producto = sqlx::query_as::<_, Producto>(
            r#"INSERT INTO productos (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, proveedor_id, codigo_proveedor, codigo_maestro, stock_minimo, precio_unidad, lead_time_propio, ubicacion)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *"#,
        )
        .bind(&codigo)
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.unidad_base_id)
        .bind(params.proveedor_id)
        .bind(&params.codigo_proveedor)
        .bind(&params.codigo_maestro)
        .bind(params.stock_minimo.unwrap_or(Decimal::ZERO))
        .bind(params.precio_unidad)
        .bind(params.lead_time_propio)
        .bind(&params.ubicacion)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                AppError::Validation("Categoría, unidad, proveedor o área no existe".into())
            }
            _ => e.into(),
        })?;

        if let Some(pres_list) = params.presentaciones {
            for pres in pres_list {
                sqlx::query(
                    "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras) VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(producto.id)
                .bind(pres.nombre.trim())
                .bind(pres.nombre_plural.trim())
                .bind(pres.factor_conversion)
                .bind(&pres.codigo_barras)
                .execute(&mut *tx)
                .await?;
            }
        }

        if let Some(ids) = params.area_ids {
            for area_id in ids {
                sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
                    .bind(producto.id)
                    .bind(area_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        // Auditoría
        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('productos', $1, 'CREATE', $2, $3)",
        )
        .bind(producto.id.to_string())
        .bind(json!({"codigo_interno": &producto.codigo_interno, "nombre": &producto.nombre}))
        .bind(params.usuario_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(producto)
    }

    /// Obtiene un producto por ID con todos sus detalles (Categoría, Unidad, Áreas, etc)
    pub async fn obtener_detalle(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<serde_json::Value, AppError> {
        let result: Option<serde_json::Value> = sqlx::query_scalar(
            r#"SELECT json_build_object(
                'id',              p.id,
                'codigo_interno',  p.codigo_interno,
                'nombre',          p.nombre,
                'descripcion',     p.descripcion,
                'codigo_proveedor',p.codigo_proveedor,
                'codigo_maestro',  p.codigo_maestro,
                'stock_minimo',    p.stock_minimo,
                'precio_unidad',   p.precio_unidad,
                'lead_time_propio',p.lead_time_propio,
                'ubicacion',       p.ubicacion,
                'activo',          p.activo,
                'version',         p.version,
                'created_at',      p.created_at,
                'updated_at',      p.updated_at,
                'categoria', CASE WHEN c.id IS NOT NULL
                    THEN json_build_object('id', c.id, 'nombre', c.nombre)
                    ELSE NULL
                END,
                'proveedor', CASE WHEN prov.id IS NOT NULL
                    THEN json_build_object('id', prov.id, 'nombre', prov.nombre)
                    ELSE NULL
                END,
                'unidad_base', json_build_object(
                    'id', ub.id,
                    'nombre', ub.nombre,
                    'nombre_plural', ub.nombre_plural
                ),
                'presentaciones', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id',               pr.id,
                            'producto_id',      pr.producto_id,
                            'nombre',           pr.nombre,
                            'nombre_plural',    pr.nombre_plural,
                            'factor_conversion',pr.factor_conversion,
                            'codigo_barras',    pr.codigo_barras,
                            'activa',           pr.activa,
                            'version',          pr.version,
                            'created_at',       pr.created_at
                        ) ORDER BY pr.nombre
                    ) FROM presentaciones pr
                    WHERE pr.producto_id = p.id AND pr.activa = true),
                    '[]'::json
                ),
                'areas', COALESCE(
                    (SELECT json_agg(
                        json_build_object('id', a.id, 'nombre', a.nombre)
                        ORDER BY a.nombre
                    ) FROM areas a
                    JOIN producto_area pa ON pa.area_id = a.id
                    WHERE pa.producto_id = p.id),
                    '[]'::json
                )
            )
            FROM productos p
            LEFT JOIN categorias c ON c.id = p.categoria_id
            LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
            JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
            WHERE p.id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        result.ok_or(AppError::NotFound("Producto no encontrado".into()))
    }

    /// Actualiza un producto existente con control de concurrencia (versión)
    pub async fn actualizar_producto(
        pool: &PgPool,
        params: ActualizarProductoParams,
    ) -> Result<Producto, AppError> {
        let anterior = sqlx::query_as::<_, Producto>("SELECT * FROM productos WHERE id = $1")
            .bind(params.id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

        if params.version_esperada != anterior.version {
            return Err(AppError::Conflict("El registro fue modificado por otro usuario".into()));
        }

        let mut tx = pool.begin().await?;

        let producto = sqlx::query_as::<_, Producto>(
            r#"UPDATE productos
               SET nombre = $1, descripcion = $2, categoria_id = $3, proveedor_id = $4, stock_minimo = $5,
                   codigo_proveedor = $6, codigo_maestro = $7, precio_unidad = $8, lead_time_propio = $9,
                   ubicacion = $10, version = version + 1, updated_at = NOW()
               WHERE id = $11 AND version = $12
               RETURNING *"#,
        )
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.proveedor_id)
        .bind(params.stock_minimo.unwrap_or(anterior.stock_minimo))
        .bind(&params.codigo_proveedor)
        .bind(&params.codigo_maestro)
        .bind(params.precio_unidad)
        .bind(params.lead_time_propio)
        .bind(&params.ubicacion)
        .bind(params.id)
        .bind(params.version_esperada)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::Conflict("Error de concurrencia al actualizar".into()))?;

        if let Some(ids) = params.area_ids {
            sqlx::query("DELETE FROM producto_area WHERE producto_id = $1")
                .bind(params.id)
                .execute(&mut *tx)
                .await?;
            for area_id in ids {
                sqlx::query("INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)")
                    .bind(params.id)
                    .bind(area_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('productos', $1, 'UPDATE', $2, $3, $4)",
        )
        .bind(params.id.to_string())
        .bind(json!({"nombre": &anterior.nombre, "version": anterior.version}))
        .bind(json!({"nombre": &producto.nombre, "version": producto.version}))
        .bind(params.usuario_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(producto)
    }

    /// Desactiva un producto (soft delete) si no tiene stock
    pub async fn eliminar_producto(
        pool: &PgPool,
        id: Uuid,
        usuario_id: Uuid,
    ) -> Result<(), AppError> {
        let stock_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = $1 AND s.cantidad > 0",
        )
        .bind(id)
        .fetch_one(pool)
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
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Producto no encontrado o ya inactivo".into()));
        }

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('productos', $1, 'DELETE', $2)",
        )
        .bind(id.to_string())
        .bind(usuario_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Reactiva un producto desactivado
    pub async fn reactivar_producto(
        pool: &PgPool,
        id: Uuid,
        usuario_id: Uuid,
    ) -> Result<Producto, AppError> {
        let producto = sqlx::query_as::<_, Producto>(
            "UPDATE productos SET activo = true, updated_at = NOW() WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('productos', $1, 'UPDATE', $2)",
        )
        .bind(id.to_string())
        .bind(usuario_id)
        .execute(pool)
        .await?;

        Ok(producto)
    }

    /// Busca un producto por código de barras o código interno para el escáner
    pub async fn buscar_por_codigo(
        pool: &PgPool,
        codigo: &str,
    ) -> Result<serde_json::Value, AppError> {
        let codigo = codigo.trim();
        if codigo.is_empty() {
            return Err(AppError::Validation("El código no puede estar vacío".into()));
        }

        #[derive(sqlx::FromRow)]
        struct Row1 {
            producto_id: Uuid,
            producto_nombre: String,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            presentacion_id: Uuid,
            presentacion_nombre: String,
            factor_conversion: Decimal,
            stock_total: Option<Decimal>,
            imagen_url: Option<String>,
        }

        // 1. Buscar por código de barras de presentación
        let row = sqlx::query_as::<_, Row1>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url
               FROM presentaciones pr
               JOIN productos p ON p.id = pr.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE pr.codigo_barras = $1 AND pr.activa = true AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row {
            return Ok(json!({
                "encontrado": true,
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": r.presentacion_id,
                "presentacion_nombre": r.presentacion_nombre,
                "factor_conversion": r.factor_conversion,
                "stock_total": r.stock_total,
                "imagen_url": r.imagen_url,
            }));
        }

        #[derive(sqlx::FromRow)]
        struct Row2 {
            producto_id: Uuid,
            producto_nombre: String,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            stock_total: Option<Decimal>,
            imagen_url: Option<String>,
        }

        // 2. Buscar por código interno
        let row2 = sqlx::query_as::<_, Row2>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url
               FROM productos p
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE p.codigo_interno = $1 AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row2 {
            return Ok(json!({
                "encontrado": true,
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": null,
                "presentacion_nombre": null,
                "factor_conversion": null,
                "stock_total": r.stock_total,
                "imagen_url": r.imagen_url,
            }));
        }

        Ok(json!({ "encontrado": false }))
    }
}

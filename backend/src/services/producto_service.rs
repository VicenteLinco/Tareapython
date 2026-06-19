use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::producto::Producto;

#[derive(Debug, Clone)]
struct Gs1Parsed {
    gtin: String,
    lote: Option<String>,
    vencimiento: Option<chrono::NaiveDate>,
}

fn parse_gs1(codigo: &str) -> Option<Gs1Parsed> {
    let raw = codigo.trim().replace(['(', ')'], "");
    let mut i = 0usize;
    let bytes = raw.as_bytes();
    let mut gtin = None;
    let mut lote = None;
    let mut vencimiento = None;

    while i + 2 <= raw.len() {
        let ai = &raw[i..i + 2];
        i += 2;
        match ai {
            "01" if i + 14 <= raw.len() => {
                gtin = Some(raw[i..i + 14].to_string());
                i += 14;
            }
            "17" if i + 6 <= raw.len() => {
                let val = &raw[i..i + 6];
                i += 6;
                let year = 2000 + val[0..2].parse::<i32>().ok()?;
                let month = val[2..4].parse::<u32>().ok()?;
                let day = val[4..6].parse::<u32>().ok()?;
                vencimiento = chrono::NaiveDate::from_ymd_opt(year, month, day);
            }
            "10" => {
                let start = i;
                while i + 2 <= raw.len() {
                    let maybe_ai = &raw[i..i + 2];
                    if matches!(maybe_ai, "01" | "17" | "21" | "30") {
                        break;
                    }
                    if bytes[i] == 29 {
                        break;
                    }
                    i += 1;
                }
                if i > start {
                    lote = Some(raw[start..i].trim_matches(char::from(29)).to_string());
                }
            }
            _ => break,
        }
    }

    gtin.map(|gtin| Gs1Parsed {
        gtin,
        lote,
        vencimiento,
    })
}

pub struct ProductoService;

pub struct CrearProductoParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub proveedor_id: Option<i32>,
    pub sku: Option<String>,
    pub precio_unidad: Option<Decimal>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub pres_nombre: Option<String>,
    pub pres_nombre_plural: Option<String>,
    pub pres_factor: Option<Decimal>,
    pub pres_codigo_barras: Option<String>,
    pub pres_gtin: Option<String>,
    pub pres_gs1_habilitado: bool,
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
    pub sku: Option<String>,
    pub precio_unidad: Option<Decimal>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub pres_nombre: Option<String>,
    pub pres_nombre_plural: Option<String>,
    pub pres_factor: Option<Decimal>,
    pub pres_codigo_barras: Option<String>,
    pub pres_gtin: Option<String>,
    pub pres_gs1_habilitado: Option<bool>,
    pub area_ids: Option<Vec<i32>>,
    pub version_esperada: i32,
    pub usuario_id: Uuid,
}

impl ProductoService {
    /// Creates a new product with its flat supplier/presentation fields and optional areas.
    /// Also upserts a row in `presentaciones` if pres_nombre is provided, so that
    /// recepcion_detalle and other tables that FK into presentaciones still work.
    pub async fn crear_producto(
        pool: &PgPool,
        params: CrearProductoParams,
    ) -> Result<Producto, AppError> {
        let mut tx = pool.begin().await?;

        let codigo: String = sqlx::query_scalar("SELECT generar_codigo_producto()")
            .fetch_one(&mut *tx)
            .await?;

        let producto = sqlx::query_as::<_, Producto>(
            r#"INSERT INTO productos
               (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id,
                proveedor_id, sku, precio_unidad,
                ubicacion,
                temperatura_almacenamiento, requiere_cadena_frio, dias_estabilidad_abierto, clase_riesgo,
                pres_nombre, pres_nombre_plural, pres_factor, pres_codigo_barras, pres_gtin, pres_gs1_habilitado)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
               RETURNING *"#,
        )
        .bind(&codigo)
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.unidad_base_id)
        .bind(params.proveedor_id)
        .bind(&params.sku)
        .bind(params.precio_unidad)
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(params.requiere_cadena_frio)
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .bind(&params.pres_nombre)
        .bind(&params.pres_nombre_plural)
        .bind(params.pres_factor)
        .bind(&params.pres_codigo_barras)
        .bind(&params.pres_gtin)
        .bind(params.pres_gs1_habilitado)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                AppError::Validation("Categoría, unidad o proveedor no existe".into())
            }
            _ => e.into(),
        })?;

        // Sync the primary presentation row in `presentaciones` (needed for recepcion_detalle FK)
        if let Some(ref pres_nombre) = params.pres_nombre {
            sqlx::query(
                r#"INSERT INTO presentaciones
                   (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado, activa)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, true)"#,
            )
            .bind(producto.id)
            .bind(pres_nombre.trim())
            .bind(params.pres_nombre_plural.as_deref().unwrap_or(pres_nombre.as_str()).trim())
            .bind(params.pres_factor.unwrap_or(Decimal::ONE))
            .bind(&params.pres_codigo_barras)
            .bind(&params.pres_gtin)
            .bind(params.pres_gs1_habilitado)
            .execute(&mut *tx)
            .await?;
        }

        // Extra presentations (if provided separately)
        if let Some(pres_list) = params.presentaciones {
            for pres in pres_list {
                sqlx::query(
                    "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado, sku) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                )
                .bind(producto.id)
                .bind(pres.nombre.trim())
                .bind(pres.nombre_plural.trim())
                .bind(pres.factor_conversion)
                .bind(&pres.codigo_barras)
                .bind(&pres.gtin)
                .bind(pres.gs1_habilitado.unwrap_or(false))
                .bind(&pres.sku)
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

        // Record initial price in history
        if let (Some(precio), Some(proveedor_id)) = (params.precio_unidad, params.proveedor_id) {
            sqlx::query(
                r#"INSERT INTO producto_precio_historial
                   (producto_id, proveedor_id, precio_unidad, usuario_id, fuente, nota)
                   VALUES ($1, $2, $3, $4, 'manual', 'Precio inicial de proveedor')"#,
            )
            .bind(producto.id)
            .bind(proveedor_id)
            .bind(precio)
            .bind(params.usuario_id)
            .execute(&mut *tx)
            .await?;
        }

        // Audit
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

    /// Gets a product by ID with all details (category, unit, areas, presentations).
    pub async fn obtener_detalle(pool: &PgPool, id: Uuid) -> Result<serde_json::Value, AppError> {
        let result: Option<serde_json::Value> = sqlx::query_scalar(
            r#"SELECT json_build_object(
                'id',              p.id,
                'codigo_interno',  p.codigo_interno,
                'nombre',          p.nombre,
                'descripcion',     p.descripcion,
                'sku',             p.sku,
                'ubicacion',       p.ubicacion,
                'temperatura_almacenamiento', p.temperatura_almacenamiento,
                'requiere_cadena_frio',       p.requiere_cadena_frio,
                'dias_estabilidad_abierto',   p.dias_estabilidad_abierto,
                'clase_riesgo',               p.clase_riesgo,
                'activo',          p.activo,
                'precio_unidad',   p.precio_unidad,
                'imagen_url',      p.imagen_url,
                'version',         p.version,
                'created_at',      p.created_at,
                'updated_at',      p.updated_at,
                'pres_nombre',         p.pres_nombre,
                'pres_nombre_plural',  p.pres_nombre_plural,
                'pres_factor',         p.pres_factor,
                'pres_codigo_barras',  p.pres_codigo_barras,
                'pres_gtin',           p.pres_gtin,
                'pres_gs1_habilitado', p.pres_gs1_habilitado,
                'categoria', CASE WHEN c.id IS NOT NULL
                    THEN json_build_object('id', c.id, 'nombre', c.nombre)
                    ELSE NULL
                END,
                'unidad_base', json_build_object(
                    'id', ub.id,
                    'nombre', ub.nombre,
                    'nombre_plural', ub.nombre_plural
                ),
                'proveedor', CASE WHEN prov.id IS NOT NULL
                    THEN json_build_object(
                        'id', prov.id,
                        'nombre', prov.nombre,
                        'icono', prov.icono
                    )
                    ELSE NULL
                END,
                'presentaciones', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id',               pr.id,
                            'producto_id',      pr.producto_id,
                            'nombre',           pr.nombre,
                            'nombre_plural',    pr.nombre_plural,
                            'factor_conversion',pr.factor_conversion,
                            'codigo_barras',    pr.codigo_barras,
                            'gtin',             pr.gtin,
                            'gs1_habilitado',   pr.gs1_habilitado,
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

    pub async fn historial_precios(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1)")
                .bind(id)
                .fetch_one(pool)
                .await?;
        if !exists {
            return Err(AppError::NotFound("Producto no encontrado".into()));
        }

        sqlx::query_scalar(
            r#"SELECT json_build_object(
                'id', h.id,
                'proveedor_id', h.proveedor_id,
                'proveedor_nombre', pr.nombre,
                'precio_unidad', h.precio_unidad,
                'presentacion_id', h.presentacion_id,
                'presentacion_nombre', pres.nombre,
                'precio_presentacion', h.precio_presentacion,
                'vigente_desde', h.vigente_desde,
                'fuente', h.fuente,
                'nota', h.nota,
                'created_at', h.created_at
            )
            FROM producto_precio_historial h
            LEFT JOIN proveedores pr ON pr.id = h.proveedor_id
            LEFT JOIN presentaciones pres ON pres.id = h.presentacion_id
            WHERE h.producto_id = $1
            ORDER BY h.vigente_desde DESC, h.created_at DESC, h.id DESC"#,
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
    }

    /// Updates an existing product with optimistic locking (version check).
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
            return Err(AppError::VersionConflict {
                esperada: params.version_esperada as i64,
                actual: anterior.version as i64,
            });
        }

        let mut tx = pool.begin().await?;

        let producto = sqlx::query_as::<_, Producto>(
            r#"UPDATE productos
               SET nombre = $1, descripcion = $2, categoria_id = $3,
                   proveedor_id = COALESCE($4, proveedor_id),
                   sku = COALESCE($5, sku),
                   precio_unidad = COALESCE($6, precio_unidad),
                   ubicacion = $7,
                   temperatura_almacenamiento = $8, requiere_cadena_frio = $9,
                   dias_estabilidad_abierto = $10, clase_riesgo = $11,
                   pres_nombre = COALESCE($12, pres_nombre),
                   pres_nombre_plural = COALESCE($13, pres_nombre_plural),
                   pres_factor = COALESCE($14, pres_factor),
                   pres_codigo_barras = COALESCE($15, pres_codigo_barras),
                   pres_gtin = COALESCE($16, pres_gtin),
                   pres_gs1_habilitado = COALESCE($17, pres_gs1_habilitado),
                   version = version + 1, updated_at = NOW()
               WHERE id = $18 AND version = $19
               RETURNING *"#,
        )
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.proveedor_id)
        .bind(&params.sku)
        .bind(params.precio_unidad)
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(
            params
                .requiere_cadena_frio
                .unwrap_or(anterior.requiere_cadena_frio),
        )
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .bind(&params.pres_nombre)
        .bind(&params.pres_nombre_plural)
        .bind(params.pres_factor)
        .bind(&params.pres_codigo_barras)
        .bind(&params.pres_gtin)
        .bind(params.pres_gs1_habilitado)
        .bind(params.id)
        .bind(params.version_esperada)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::VersionConflict {
            esperada: params.version_esperada as i64,
            actual: anterior.version as i64,
        })?;

        // Sync primary presentation row in presentaciones if pres_nombre changed
        if let Some(ref pres_nombre) = params.pres_nombre {
            let existing_id: Option<i32> = sqlx::query_scalar(
                "SELECT id FROM presentaciones WHERE producto_id = $1 AND activa = true ORDER BY factor_conversion DESC LIMIT 1"
            )
            .bind(params.id)
            .fetch_optional(&mut *tx)
            .await?;

            match existing_id {
                Some(pres_id) => {
                    sqlx::query(
                        r#"UPDATE presentaciones
                           SET nombre = $1, nombre_plural = $2,
                               factor_conversion = $3, codigo_barras = $4,
                               gtin = $5, gs1_habilitado = $6
                           WHERE id = $7"#,
                    )
                    .bind(pres_nombre.trim())
                    .bind(params.pres_nombre_plural.as_deref().unwrap_or(pres_nombre.as_str()).trim())
                    .bind(params.pres_factor.unwrap_or(Decimal::ONE))
                    .bind(&params.pres_codigo_barras)
                    .bind(&params.pres_gtin)
                    .bind(params.pres_gs1_habilitado.unwrap_or(false))
                    .bind(pres_id)
                    .execute(&mut *tx)
                    .await?;
                }
                None => {
                    sqlx::query(
                        r#"INSERT INTO presentaciones
                           (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado, activa)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, true)"#,
                    )
                    .bind(params.id)
                    .bind(pres_nombre.trim())
                    .bind(params.pres_nombre_plural.as_deref().unwrap_or(pres_nombre.as_str()).trim())
                    .bind(params.pres_factor.unwrap_or(Decimal::ONE))
                    .bind(&params.pres_codigo_barras)
                    .bind(&params.pres_gtin)
                    .bind(params.pres_gs1_habilitado.unwrap_or(false))
                    .execute(&mut *tx)
                    .await?;
                }
            }
        }

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

        // Record price change in history
        if let (Some(precio), Some(proveedor_id)) = (params.precio_unidad, params.proveedor_id.or(anterior.proveedor_id)) {
            if params.precio_unidad != anterior.precio_unidad {
                sqlx::query(
                    r#"INSERT INTO producto_precio_historial
                       (producto_id, proveedor_id, precio_unidad, usuario_id, fuente, nota)
                       VALUES ($1, $2, $3, $4, 'manual', 'Precio actualizado desde producto')"#,
                )
                .bind(params.id)
                .bind(proveedor_id)
                .bind(precio)
                .bind(params.usuario_id)
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

    /// Soft-deletes a product if it has no active stock.
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
            "UPDATE productos SET activo = false, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND activo = true",
        )
        .bind(id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound(
                "Producto no encontrado o ya inactivo".into(),
            ));
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

    /// Reactivates a soft-deleted product.
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

    /// Looks up a product by barcode, internal code, or lot number (for the scanner).
    pub async fn buscar_por_codigo(
        pool: &PgPool,
        codigo: &str,
    ) -> Result<serde_json::Value, AppError> {
        let codigo = codigo.trim();
        if codigo.is_empty() {
            return Err(AppError::Validation(
                "El código no puede estar vacío".into(),
            ));
        }

        #[derive(sqlx::FromRow)]
        struct Row1 {
            producto_id: Uuid,
            producto_nombre: String,
            proveedor_id: Option<i32>,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            presentacion_id: i32,
            presentacion_nombre: String,
            factor_conversion: Decimal,
            stock_total: Option<Decimal>,
            imagen_url: Option<String>,
            precio_unidad: Option<Decimal>,
        }

        // 1. Search by presentation barcode
        let gs1 = parse_gs1(codigo);
        let codigo_presentacion = gs1.as_ref().map(|g| g.gtin.as_str()).unwrap_or(codigo);

        let row = sqlx::query_as::<_, Row1>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre, p.proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 p.precio_unidad
               FROM presentaciones pr
               JOIN productos p ON p.id = pr.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE (pr.codigo_barras = $1 OR pr.gtin = $1) AND pr.activa = true AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo_presentacion)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row {
            let mut out = json!({
                "encontrado": true,
                "tipo": if gs1.is_some() { "gs1" } else { "presentacion" },
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "proveedor_id": r.proveedor_id,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": r.presentacion_id,
                "presentacion_nombre": r.presentacion_nombre,
                "factor_conversion": r.factor_conversion,
                "stock_total": r.stock_total,
                "imagen_url": r.imagen_url,
                "precio_unidad": r.precio_unidad,
            });
            if let Some(gs1) = gs1 {
                out["gs1"] = json!({
                    "gtin": gs1.gtin,
                    "numero_lote": gs1.lote,
                    "fecha_vencimiento": gs1.vencimiento,
                });
            }
            return Ok(out);
        }

        // 1.5. Search by alias barcode (producto_codigos_barras)
        // Uses codigo_presentacion (extracted GTIN when GS1) so GS1-encoded aliases resolve correctly.
        // LEFT JOIN on presentaciones: a product missing an active presentation still matches.
        #[derive(sqlx::FromRow)]
        struct AliasRow {
            producto_id: Uuid,
            producto_nombre: String,
            proveedor_id: Option<i32>,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            presentacion_id: Option<i32>,
            presentacion_nombre: Option<String>,
            factor_conversion: Option<Decimal>,
            stock_total: Option<Decimal>,
            imagen_url: Option<String>,
            precio_unidad: Option<Decimal>,
        }

        let alias_row = sqlx::query_as::<_, AliasRow>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre, p.proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 p.precio_unidad
               FROM producto_codigos_barras pcb
               JOIN productos p ON p.id = pcb.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               LEFT JOIN presentaciones pr ON pr.producto_id = p.id AND pr.activa = true
               WHERE pcb.codigo = $1 AND pcb.activo = true AND p.activo = true
               ORDER BY pr.factor_conversion DESC NULLS LAST
               LIMIT 1"#,
        )
        .bind(codigo_presentacion)
        .fetch_optional(pool)
        .await?;

        if let Some(ar) = alias_row {
            return Ok(json!({
                "encontrado": true,
                "tipo": "alias",
                "producto_id": ar.producto_id,
                "producto_nombre": ar.producto_nombre,
                "proveedor_id": ar.proveedor_id,
                "unidad_base_nombre": ar.unidad_base_nombre,
                "unidad_base_nombre_plural": ar.unidad_base_nombre_plural,
                "presentacion_id": ar.presentacion_id,
                "presentacion_nombre": ar.presentacion_nombre,
                "factor_conversion": ar.factor_conversion,
                "stock_total": ar.stock_total,
                "imagen_url": ar.imagen_url,
                "precio_unidad": ar.precio_unidad,
            }));
        }

        if parse_gs1(codigo).is_some() {
            return Ok(json!({
                "encontrado": false,
                "tipo": "gs1",
                "motivo": "GTIN no registrado",
            }));
        }

        #[derive(sqlx::FromRow)]
        struct Row2 {
            producto_id: Uuid,
            producto_nombre: String,
            proveedor_id: Option<i32>,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            stock_total: Option<Decimal>,
            imagen_url: Option<String>,
            precio_unidad: Option<Decimal>,
        }

        // 2. Search by product internal code
        let row2 = sqlx::query_as::<_, Row2>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre, p.proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 p.precio_unidad
               FROM productos p
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE UPPER(p.codigo_interno) = UPPER($1) AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row2 {
            return Ok(json!({
                "encontrado": true,
                "tipo": "producto",
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "proveedor_id": r.proveedor_id,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": null,
                "presentacion_nombre": null,
                "factor_conversion": null,
                "stock_total": r.stock_total,
                "imagen_url": r.imagen_url,
                "precio_unidad": r.precio_unidad,
            }));
        }

        // 3. Search by lot number
        #[derive(sqlx::FromRow)]
        struct Row3 {
            lote_id: Uuid,
            numero_lote: String,
            fecha_vencimiento: chrono::NaiveDate,
            producto_id: Uuid,
            producto_nombre: String,
            proveedor_id: Option<i32>,
            unidad_base_nombre: String,
            unidad_base_nombre_plural: String,
            presentacion_id: Option<i32>,
            presentacion_nombre: Option<String>,
            factor_conversion: Option<Decimal>,
            area_id: Option<i32>,
            area_nombre: Option<String>,
            imagen_url: Option<String>,
            precio_unidad: Option<Decimal>,
        }

        let row3 = sqlx::query_as::<_, Row3>(
            r#"SELECT
                 l.id as lote_id,
                 l.numero_lote,
                 l.fecha_vencimiento,
                 p.id as producto_id,
                 p.nombre as producto_nombre,
                 p.proveedor_id,
                 ub.nombre as unidad_base_nombre,
                 ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT pr.id FROM presentaciones pr
                  WHERE pr.producto_id = p.id AND pr.activa = true
                  ORDER BY pr.id ASC LIMIT 1) as presentacion_id,
                 (SELECT pr.nombre FROM presentaciones pr
                  WHERE pr.producto_id = p.id AND pr.activa = true
                  ORDER BY pr.id ASC LIMIT 1) as presentacion_nombre,
                 (SELECT pr.factor_conversion FROM presentaciones pr
                  WHERE pr.producto_id = p.id AND pr.activa = true
                  ORDER BY pr.id ASC LIMIT 1) as factor_conversion,
                 (SELECT s.area_id FROM stock s WHERE s.lote_id = l.id AND s.cantidad > 0
                  ORDER BY s.cantidad DESC LIMIT 1) as area_id,
                 (SELECT a.nombre FROM stock s JOIN areas a ON a.id = s.area_id
                  WHERE s.lote_id = l.id AND s.cantidad > 0
                  ORDER BY s.cantidad DESC LIMIT 1) as area_nombre,
                 p.imagen_url AS imagen_url,
                 p.precio_unidad
               FROM lotes l
               JOIN productos p ON p.id = l.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE UPPER(l.numero_lote) = UPPER($1) AND p.activo = true
               LIMIT 1"#,
        )
        .bind(codigo)
        .fetch_optional(pool)
        .await?;

        if let Some(r) = row3 {
            return Ok(json!({
                "encontrado": true,
                "tipo": "lote",
                "lote_id": r.lote_id,
                "numero_lote": r.numero_lote,
                "fecha_vencimiento": r.fecha_vencimiento,
                "producto_id": r.producto_id,
                "producto_nombre": r.producto_nombre,
                "proveedor_id": r.proveedor_id,
                "unidad_base_nombre": r.unidad_base_nombre,
                "unidad_base_nombre_plural": r.unidad_base_nombre_plural,
                "presentacion_id": r.presentacion_id,
                "presentacion_nombre": r.presentacion_nombre,
                "factor_conversion": r.factor_conversion,
                "area_id": r.area_id,
                "area_nombre": r.area_nombre,
                "imagen_url": r.imagen_url,
                "precio_unidad": r.precio_unidad,
            }));
        }

        Ok(json!({ "encontrado": false, "codigo": codigo }))
    }
}

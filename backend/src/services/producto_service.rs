use rust_decimal::Decimal;
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
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

async fn upsert_presentacion_proveedor(
    tx: &mut Transaction<'_, Postgres>,
    producto_id: Uuid,
    prov: &crate::handlers::productos::ProveedorProductoInput,
) -> Result<Option<i32>, AppError> {
    if let Some(pres) = &prov.presentacion {
        if let Some(id) = prov.presentacion_id {
            sqlx::query(
                r#"UPDATE presentaciones
                   SET nombre = $1, nombre_plural = $2, factor_conversion = $3,
                       codigo_barras = $4, gtin = $5, gs1_habilitado = $6
                   WHERE id = $7 AND producto_id = $8"#,
            )
            .bind(pres.nombre.trim())
            .bind(pres.nombre_plural.trim())
            .bind(pres.factor_conversion)
            .bind(&pres.codigo_barras)
            .bind(&pres.gtin)
            .bind(pres.gs1_habilitado.unwrap_or(false))
            .bind(id)
            .bind(producto_id)
            .execute(&mut **tx)
            .await?;

            return Ok(Some(id));
        }

        let id: i32 = sqlx::query_scalar(
            r#"INSERT INTO presentaciones
               (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id"#,
        )
        .bind(producto_id)
        .bind(pres.nombre.trim())
        .bind(pres.nombre_plural.trim())
        .bind(pres.factor_conversion)
        .bind(&pres.codigo_barras)
        .bind(&pres.gtin)
        .bind(pres.gs1_habilitado.unwrap_or(false))
        .fetch_one(&mut **tx)
        .await?;

        return Ok(Some(id));
    }

    Ok(prov.presentacion_id)
}

async fn guardar_imagen_proveedor(
    tx: &mut Transaction<'_, Postgres>,
    producto_id: Uuid,
    prov: &crate::handlers::productos::ProveedorProductoInput,
    imagen_previa: Option<String>,
) -> Result<Option<String>, AppError> {
    if let Some(data_url) = prov.imagen_data_url.as_deref() {
        if let Some(ref path) = imagen_previa {
            crate::services::storage::delete_image(path).await?;
        }

        let nombre_archivo = format!("{}-proveedor-{}", producto_id, prov.proveedor_id);
        let path =
            crate::services::storage::save_base64_image(data_url, "productos", &nombre_archivo)
                .await?;
        return Ok(Some(path));
    }

    let imagen_url = prov.imagen_url.clone().or(imagen_previa);
    if let Some(ref path) = imagen_url {
        sqlx::query("SELECT $1")
            .bind(path)
            .execute(&mut **tx)
            .await?;
    }

    Ok(imagen_url)
}

pub struct ProductoService;

pub struct CrearProductoParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub presentaciones: Option<Vec<crate::handlers::productos::CreatePresentacionInline>>,
    pub area_ids: Option<Vec<i32>>,
    pub proveedores: Option<Vec<crate::handlers::productos::ProveedorProductoInput>>,
    pub usuario_id: Uuid,
}

pub struct ActualizarProductoParams {
    pub id: Uuid,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub area_ids: Option<Vec<i32>>,
    pub proveedores: Option<Vec<crate::handlers::productos::ProveedorProductoInput>>,
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
            r#"INSERT INTO productos
               (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id,
                codigo_maestro, stock_minimo, ubicacion,
                temperatura_almacenamiento, requiere_cadena_frio, dias_estabilidad_abierto, clase_riesgo)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               RETURNING *"#,
        )
        .bind(&codigo)
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.unidad_base_id)
        .bind(&params.codigo_maestro)
        .bind(params.stock_minimo.unwrap_or(Decimal::ZERO))
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(params.requiere_cadena_frio)
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                AppError::Validation("Categoría, unidad o área no existe".into())
            }
            _ => e.into(),
        })?;

        if let Some(pres_list) = params.presentaciones {
            for pres in pres_list {
                sqlx::query(
                    "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(producto.id)
                .bind(pres.nombre.trim())
                .bind(pres.nombre_plural.trim())
                .bind(pres.factor_conversion)
                .bind(&pres.codigo_barras)
                .bind(&pres.gtin)
                .bind(pres.gs1_habilitado.unwrap_or(false))
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

        if let Some(provs) = params.proveedores {
            for prov in &provs {
                let presentacion_id =
                    upsert_presentacion_proveedor(&mut tx, producto.id, prov).await?;
                let imagen_url = guardar_imagen_proveedor(&mut tx, producto.id, prov, None).await?;

                sqlx::query(
                    r#"INSERT INTO producto_proveedor
                       (producto_id, proveedor_id, es_principal, codigo_proveedor, codigo_maestro, presentacion_id, precio_unidad, lead_time_dias, unidad_minima_pedido, imagen_url)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
                )
                .bind(producto.id)
                .bind(prov.proveedor_id)
                .bind(prov.es_principal)
                .bind(&prov.codigo_proveedor)
                .bind(&prov.codigo_maestro)
                .bind(presentacion_id)
                .bind(prov.precio_unidad)
                .bind(prov.lead_time_dias)
                .bind(prov.unidad_minima_pedido)
                .bind(&imagen_url)
                .execute(&mut *tx)
                .await?;

                if let Some(precio) = prov.precio_unidad {
                    sqlx::query(
                        r#"INSERT INTO producto_precio_historial
                           (producto_id, proveedor_id, precio_unidad, presentacion_id, usuario_id, fuente, nota)
                           VALUES ($1, $2, $3, $4, $5, 'manual', 'Precio inicial de proveedor')"#,
                    )
                    .bind(producto.id)
                    .bind(prov.proveedor_id)
                    .bind(precio)
                    .bind(presentacion_id)
                    .bind(params.usuario_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }

            if let Some(principal) = provs.iter().find(|p| p.es_principal) {
                sqlx::query(
                    "UPDATE productos SET proveedor_id = $1, codigo_proveedor = $2, precio_unidad = $3, lead_time_propio = $4 WHERE id = $5"
                )
                .bind(principal.proveedor_id)
                .bind(&principal.codigo_proveedor)
                .bind(principal.precio_unidad)
                .bind(principal.lead_time_dias)
                .bind(producto.id)
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
    pub async fn obtener_detalle(pool: &PgPool, id: Uuid) -> Result<serde_json::Value, AppError> {
        let result: Option<serde_json::Value> = sqlx::query_scalar(
            r#"SELECT json_build_object(
                'id',              p.id,
                'codigo_interno',  p.codigo_interno,
                'nombre',          p.nombre,
                'descripcion',     p.descripcion,
                'codigo_maestro',  p.codigo_maestro,
                'stock_minimo',    p.stock_minimo,
                'ubicacion',       p.ubicacion,
                'temperatura_almacenamiento', p.temperatura_almacenamiento,
                'requiere_cadena_frio',       p.requiere_cadena_frio,
                'dias_estabilidad_abierto',   p.dias_estabilidad_abierto,
                'clase_riesgo',               p.clase_riesgo,
                'activo',          p.activo,
                'precio_unidad',   p.precio_unidad,
                'version',         p.version,
                'created_at',      p.created_at,
                'updated_at',      p.updated_at,
                'categoria', CASE WHEN c.id IS NOT NULL
                    THEN json_build_object('id', c.id, 'nombre', c.nombre)
                    ELSE NULL
                END,
                'unidad_base', json_build_object(
                    'id', ub.id,
                    'nombre', ub.nombre,
                    'nombre_plural', ub.nombre_plural
                ),
                'proveedores', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id',               pp.id,
                            'proveedor_id',     pp.proveedor_id,
                            'proveedor_nombre', prov.nombre,
                            'proveedor_icono',  prov.icono,
                            'es_principal',     pp.es_principal,
                            'codigo_proveedor', pp.codigo_proveedor,
                            'codigo_maestro',   pp.codigo_maestro,
                            'presentacion_id',  pp.presentacion_id,
                            'presentacion', CASE WHEN pr.id IS NOT NULL THEN json_build_object(
                                'id', pr.id,
                                'producto_id', pr.producto_id,
                                'nombre', pr.nombre,
                                'nombre_plural', pr.nombre_plural,
                                'factor_conversion', pr.factor_conversion,
                                'codigo_barras', pr.codigo_barras,
                                'gtin', pr.gtin,
                                'gs1_habilitado', pr.gs1_habilitado,
                                'activa', pr.activa,
                                'version', pr.version,
                                'created_at', pr.created_at
                            ) ELSE NULL END,
                            'precio_unidad',    pp.precio_unidad,
                            'lead_time_dias',   pp.lead_time_dias,
                            'unidad_minima_pedido', pp.unidad_minima_pedido,
                            'imagen_url',       pp.imagen_url,
                            'activo',           pp.activo,
                            'version',          pp.version
                        ) ORDER BY pp.es_principal DESC, prov.nombre
                    ) FROM producto_proveedor pp
                    JOIN proveedores prov ON prov.id = pp.proveedor_id
                    LEFT JOIN presentaciones pr ON pr.id = pp.presentacion_id
                    WHERE pp.producto_id = p.id AND pp.activo = TRUE),
                    '[]'::json
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
            return Err(AppError::VersionConflict {
                esperada: params.version_esperada as i64,
                actual: anterior.version as i64,
            });
        }

        let mut tx = pool.begin().await?;

        let producto = sqlx::query_as::<_, Producto>(
            r#"UPDATE productos
               SET nombre = $1, descripcion = $2, categoria_id = $3,
                   stock_minimo = $4, codigo_maestro = $5, ubicacion = $6,
                   temperatura_almacenamiento = $7, requiere_cadena_frio = $8,
                   dias_estabilidad_abierto = $9, clase_riesgo = $10,
                   version = version + 1, updated_at = NOW()
               WHERE id = $11 AND version = $12
               RETURNING *"#,
        )
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.stock_minimo.unwrap_or(anterior.stock_minimo))
        .bind(&params.codigo_maestro)
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(
            params
                .requiere_cadena_frio
                .unwrap_or(anterior.requiere_cadena_frio),
        )
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .bind(params.id)
        .bind(params.version_esperada)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::VersionConflict {
            esperada: params.version_esperada as i64,
            actual: anterior.version as i64,
        })?;

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

        if let Some(provs) = params.proveedores {
            sqlx::query("DELETE FROM producto_proveedor WHERE producto_id = $1")
                .bind(params.id)
                .execute(&mut *tx)
                .await?;

            for prov in &provs {
                let imagen_previa: Option<String> = sqlx::query_scalar(
                    "SELECT imagen_url FROM producto_proveedor WHERE producto_id = $1 AND proveedor_id = $2",
                )
                .bind(params.id)
                .bind(prov.proveedor_id)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();
                let presentacion_id =
                    upsert_presentacion_proveedor(&mut tx, params.id, prov).await?;
                let imagen_url =
                    guardar_imagen_proveedor(&mut tx, params.id, prov, imagen_previa).await?;

                sqlx::query(
                    r#"INSERT INTO producto_proveedor
                       (producto_id, proveedor_id, es_principal, codigo_proveedor, codigo_maestro, presentacion_id, precio_unidad, lead_time_dias, unidad_minima_pedido, imagen_url)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
                )
                .bind(params.id)
                .bind(prov.proveedor_id)
                .bind(prov.es_principal)
                .bind(&prov.codigo_proveedor)
                .bind(&prov.codigo_maestro)
                .bind(presentacion_id)
                .bind(prov.precio_unidad)
                .bind(prov.lead_time_dias)
                .bind(prov.unidad_minima_pedido)
                .bind(&imagen_url)
                .execute(&mut *tx)
                .await?;

                if let Some(precio) = prov.precio_unidad {
                    sqlx::query(
                        r#"INSERT INTO producto_precio_historial
                           (producto_id, proveedor_id, precio_unidad, presentacion_id, usuario_id, fuente, nota)
                           VALUES ($1, $2, $3, $4, $5, 'manual', 'Precio actualizado desde producto')"#,
                    )
                    .bind(params.id)
                    .bind(prov.proveedor_id)
                    .bind(precio)
                    .bind(presentacion_id)
                    .bind(params.usuario_id)
                    .execute(&mut *tx)
                    .await?;
                }
            }

            if let Some(principal) = provs.iter().find(|p| p.es_principal) {
                sqlx::query(
                    "UPDATE productos SET proveedor_id = $1, codigo_proveedor = $2, precio_unidad = $3, lead_time_propio = $4 WHERE id = $5"
                )
                .bind(principal.proveedor_id)
                .bind(&principal.codigo_proveedor)
                .bind(principal.precio_unidad)
                .bind(principal.lead_time_dias)
                .bind(params.id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    "UPDATE productos SET proveedor_id = NULL, codigo_proveedor = NULL, precio_unidad = NULL, lead_time_propio = NULL WHERE id = $1"
                )
                .bind(params.id)
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

        // 1. Buscar por código de barras de presentación
        let gs1 = parse_gs1(codigo);
        let codigo_presentacion = gs1.as_ref().map(|g| g.gtin.as_str()).unwrap_or(codigo);

        let row = sqlx::query_as::<_, Row1>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre, p.proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_path AS imagen_url,
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

        // 2. Buscar por código interno del producto
        let row2 = sqlx::query_as::<_, Row2>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre, p.proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_path AS imagen_url,
                 p.precio_unidad
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

        // 3. Buscar por codigo_interno del lote (para escanear etiquetas impresas en recepción)
        #[derive(sqlx::FromRow)]
        struct Row3 {
            lote_id: Uuid,
            codigo_interno_lote: String,
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
                 l.codigo_interno as codigo_interno_lote,
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
                 p.imagen_path AS imagen_url,
                 p.precio_unidad
               FROM lotes l
               JOIN productos p ON p.id = l.producto_id
               JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
               WHERE l.codigo_interno = $1 AND p.activo = true
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
                "codigo_interno_lote": r.codigo_interno_lote,
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

        Ok(json!({ "encontrado": false }))
    }
}

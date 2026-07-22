use rust_decimal::Decimal;
use serde::Serialize;
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
    let trimmed = codigo
        .trim()
        .trim_start_matches(|c: char| c.is_control() || c.is_whitespace());
    if trimmed.is_empty() {
        return None;
    }

    let pairs = if trimmed.contains('(') {
        parse_gs1_bracketed(trimmed)
    } else {
        parse_gs1_plain(trimmed)
    }?;

    let mut gtin = None;
    let mut lote = None;
    let mut vencimiento = None;
    for (ai, data) in pairs {
        if data.is_empty() {
            continue;
        }
        match ai.as_str() {
            "01" => gtin = Some(data),
            "17" => vencimiento = parse_gs1_date(&data),
            "10" => lote = Some(data),
            _ => {}
        }
    }

    gtin.map(|gtin| Gs1Parsed {
        gtin,
        lote,
        vencimiento,
    })
}

/// Splits the bracketed notation `(01)...(17)...(10)...` into (AI, data) pairs.
/// Each data segment runs until the next `(`, so embedded digits never confuse it.
fn parse_gs1_bracketed(input: &str) -> Option<Vec<(String, String)>> {
    let mut pairs = Vec::new();
    let mut rest = input;
    while let Some(open) = rest.find('(') {
        let after_open = &rest[open + 1..];
        let close = after_open.find(')')?;
        let ai = after_open[..close].trim().to_string();
        let after_close = &after_open[close + 1..];
        let data_end = after_close.find('(').unwrap_or(after_close.len());
        let data = after_close[..data_end].trim().to_string();
        pairs.push((ai, data));
        rest = &after_close[data_end..];
    }
    if pairs.is_empty() { None } else { Some(pairs) }
}

/// Splits a concatenated / FNC1-separated string into (AI, data) pairs.
/// Fixed-length AIs (01, 11, 17) consume a known width; variable-length AIs run
/// until the FNC1 group separator (0x1d) or the end of the string.
fn parse_gs1_plain(input: &str) -> Option<Vec<(String, String)>> {
    let bytes = input.as_bytes();
    let mut pairs = Vec::new();
    let mut i = 0usize;
    while i + 2 <= input.len() {
        if bytes[i] < 32 || bytes[i] == 127 {
            i += 1;
            continue;
        }
        let ai = &input[i..i + 2];
        if !ai.bytes().all(|b| b.is_ascii_digit()) {
            break;
        }
        i += 2;
        let fixed = match ai {
            "01" => Some(14usize),
            "11" | "17" => Some(6usize),
            _ => None,
        };
        match fixed {
            Some(len) => {
                if i + len > input.len() {
                    break;
                }
                pairs.push((ai.to_string(), input[i..i + len].to_string()));
                i += len;
            }
            None => {
                let start = i;
                while i < input.len() && bytes[i] >= 32 && bytes[i] != 127 {
                    i += 1;
                }
                pairs.push((ai.to_string(), input[start..i].to_string()));
            }
        }
    }
    if pairs.is_empty() { None } else { Some(pairs) }
}

/// Converts a GS1 `YYMMDD` value to a date. `DD=00` means the last day of the month.
fn parse_gs1_date(val: &str) -> Option<chrono::NaiveDate> {
    if val.len() != 6 || !val.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let year = 2000 + val[0..2].parse::<i32>().ok()?;
    let month = val[2..4].parse::<u32>().ok()?;
    let day = val[4..6].parse::<u32>().ok()?;
    if day == 0 {
        let (ny, nm) = if month == 12 {
            (year + 1, 1)
        } else {
            (year, month + 1)
        };
        chrono::NaiveDate::from_ymd_opt(ny, nm, 1)?.pred_opt()
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month, day)
    }
}

#[cfg(test)]
mod gs1_tests {
    use super::parse_gs1;
    use chrono::NaiveDate;

    fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn parses_gtin_expiry_lot_bracketed() {
        let r = parse_gs1("(01)07501234567890(17)260815(10)LOTE123").unwrap();
        assert_eq!(r.gtin, "07501234567890");
        assert_eq!(r.vencimiento, Some(ymd(2026, 8, 15)));
        assert_eq!(r.lote.as_deref(), Some("LOTE123"));
    }

    #[test]
    fn expiry_day_zero_means_last_day_of_month() {
        let r = parse_gs1("(01)07501234567890(17)260800").unwrap();
        assert_eq!(r.vencimiento, Some(ymd(2026, 8, 31)));
    }

    #[test]
    fn expiry_day_zero_february_leap_year() {
        let r = parse_gs1("(01)07501234567890(17)240200").unwrap();
        assert_eq!(r.vencimiento, Some(ymd(2024, 2, 29)));
    }

    #[test]
    fn lot_with_embedded_ai_digits_is_not_truncated() {
        let r = parse_gs1("(01)07501234567890(10)AB01CD").unwrap();
        assert_eq!(r.lote.as_deref(), Some("AB01CD"));
    }

    #[test]
    fn parses_fnc1_separated_lot_then_expiry() {
        let code = format!("0107501234567890{}{}{}", "10LOTE123", "\u{1d}", "17260815");
        let r = parse_gs1(&code).unwrap();
        assert_eq!(r.gtin, "07501234567890");
        assert_eq!(r.lote.as_deref(), Some("LOTE123"));
        assert_eq!(r.vencimiento, Some(ymd(2026, 8, 15)));
    }

    #[test]
    fn parses_plain_concatenated_fixed_then_variable() {
        // 01(14) + 17(6) + 10(rest) with no separators (10 is last)
        let r = parse_gs1("01075012345678901726081510LOTE123").unwrap();
        assert_eq!(r.gtin, "07501234567890");
        assert_eq!(r.vencimiento, Some(ymd(2026, 8, 15)));
        assert_eq!(r.lote.as_deref(), Some("LOTE123"));
    }

    #[test]
    fn returns_none_without_gtin() {
        assert!(parse_gs1("(10)LOTE123").is_none());
        assert!(parse_gs1("").is_none());
    }
}

pub struct ProductoService;

pub struct CrearProductoParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: Option<i32>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub fabricante: Option<String>,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: bool,
    pub stock_minimo_global: Decimal,
    pub codigo_loinc_cpt: Option<String>,
    pub control_lote: crate::domain::ControlLote,
    pub presentaciones: Option<Vec<crate::dto::producto::CreatePresentacionInline>>,
    pub area_ids: Option<Vec<i32>>,
    pub usuario_id: Uuid,
    pub estado_catalogo: Option<crate::domain::EstadoCatalogo>,
    pub origen_registro: Option<crate::domain::OrigenRegistro>,
    pub promedio_uso_mensual_inicial: Option<Decimal>,
}

pub struct ActualizarProductoParams {
    pub id: Uuid,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub ubicacion: Option<String>,
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    pub fabricante: Option<String>,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: Option<bool>,
    pub stock_minimo_global: Option<Decimal>,
    pub codigo_loinc_cpt: Option<String>,
    pub control_lote: Option<crate::domain::ControlLote>,
    pub area_ids: Option<Vec<i32>>,
    pub version_esperada: i32,
    pub usuario_id: Uuid,
    pub promedio_uso_mensual_inicial: Option<Decimal>,
}

pub struct ListarProductosParams {
    pub q: Option<String>,
    pub categoria_id: Option<i32>,
    pub area_id: Option<i32>,
    pub proveedor_id: Option<i32>,
    pub activo: bool,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ProductoRow {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
    pub lead_time_propio: Option<i32>,
    pub activo: bool,
    pub estado_stock: String,
    pub cat_id: Option<i32>,
    pub cat_nombre: Option<String>,
    pub um_id: Option<i32>,
    pub um_nombre: Option<String>,
    pub um_nombre_plural: Option<String>,
    pub area_id: Option<i32>,
    pub area_nombre: Option<String>,
    pub imagen_url: Option<String>,
    pub control_lote: crate::domain::ControlLote,
    pub mpn: Option<String>,
    pub alias_unidad_clinica: Option<String>,
    pub es_kit: bool,
    pub stock_minimo_global: Decimal,
    pub codigo_loinc_cpt: Option<String>,
    pub promedio_uso_mensual: Decimal,
    pub promedio_uso_mensual_inicial: Decimal,
    pub prov_id: Option<i32>,
    pub prov_nombre: Option<String>,
    pub prov_icono: Option<String>,
}

/// A secondary barcode alias attached to a product (`producto_codigos_barras`).
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CodigoBarras {
    pub id: i32,
    pub codigo: String,
}

#[derive(Debug, Clone)]
pub struct ApproveProductParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: i32,
    pub unidad_base_id: i32,
    pub control_lote: crate::domain::ControlLote,
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
                ubicacion, temperatura_almacenamiento, requiere_cadena_frio, 
                dias_estabilidad_abierto, clase_riesgo, fabricante,
                mpn, alias_unidad_clinica, es_kit, stock_minimo_global, codigo_loinc_cpt,
                control_lote, estado_catalogo, origen_registro,
                promedio_uso_mensual_inicial, promedio_uso_mensual)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
               RETURNING *"#,
        )
        .bind(&codigo)
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(params.unidad_base_id)
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(params.requiere_cadena_frio)
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .bind(&params.fabricante)
        .bind(&params.mpn)
        .bind(&params.alias_unidad_clinica)
        .bind(params.es_kit)
        .bind(params.stock_minimo_global)
        .bind(&params.codigo_loinc_cpt)
        .bind(&params.control_lote)
        .bind(params.estado_catalogo.unwrap_or(crate::domain::EstadoCatalogo::Aprobado))
        .bind(params.origen_registro.unwrap_or(crate::domain::OrigenRegistro::Manual))
        .bind(params.promedio_uso_mensual_inicial.unwrap_or(Decimal::ZERO))
        .bind(params.promedio_uso_mensual_inicial.unwrap_or(Decimal::ZERO))
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                AppError::Validation("Categoría, unidad o proveedor no existe".into())
            }
            _ => e.into(),
        })?;

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
                'ubicacion',       p.ubicacion,
                'temperatura_almacenamiento', p.temperatura_almacenamiento,
                'requiere_cadena_frio',       p.requiere_cadena_frio,
                'dias_estabilidad_abierto',   p.dias_estabilidad_abierto,
                'clase_riesgo',               p.clase_riesgo,
                'activo',          p.activo,
                'imagen_url',      p.imagen_url,
                'version',         p.version,
                'created_at',      p.created_at,
                'updated_at',      p.updated_at,
                'mpn',                 p.mpn,
                'alias_unidad_clinica', p.alias_unidad_clinica,
                'stock_minimo_global', p.stock_minimo_global,
                'codigo_loinc_cpt',    p.codigo_loinc_cpt,
                'promedio_uso_mensual', p.promedio_uso_mensual,
                'promedio_uso_mensual_inicial', p.promedio_uso_mensual_inicial,
                'categoria', CASE WHEN c.id IS NOT NULL
                    THEN json_build_object('id', c.id, 'nombre', c.nombre)
                    ELSE NULL
                END,
                'unidad_base', CASE WHEN ub.id IS NOT NULL THEN json_build_object(
                    'id', ub.id,
                    'nombre', ub.nombre,
                    'nombre_plural', ub.nombre_plural
                ) ELSE NULL END,

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
            LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
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
                   ubicacion = $4,
                   temperatura_almacenamiento = $5, requiere_cadena_frio = $6,
                   dias_estabilidad_abierto = $7, clase_riesgo = $8,
                   mpn = COALESCE($9, mpn),
                   alias_unidad_clinica = COALESCE($10, alias_unidad_clinica),
                   es_kit = COALESCE($11, es_kit),
                   stock_minimo_global = COALESCE($12, stock_minimo_global),
                   codigo_loinc_cpt = COALESCE($13, codigo_loinc_cpt),
                   control_lote = COALESCE($14, control_lote),
                   fabricante = $15,
                   promedio_uso_mensual_inicial = COALESCE($18, promedio_uso_mensual_inicial),
                   version = version + 1, updated_at = NOW()
               WHERE id = $16 AND version = $17
               RETURNING *"#,
        )
        .bind(&params.nombre)
        .bind(&params.descripcion)
        .bind(params.categoria_id)
        .bind(&params.ubicacion)
        .bind(&params.temperatura_almacenamiento)
        .bind(
            params
                .requiere_cadena_frio
                .unwrap_or(anterior.requiere_cadena_frio),
        )
        .bind(params.dias_estabilidad_abierto)
        .bind(&params.clase_riesgo)
        .bind(&params.mpn)
        .bind(&params.alias_unidad_clinica)
        .bind(params.es_kit)
        .bind(params.stock_minimo_global)
        .bind(&params.codigo_loinc_cpt)
        .bind(&params.control_lote)
        .bind(&params.fabricante)
        .bind(params.id)
        .bind(params.version_esperada)
        .bind(params.promedio_uso_mensual_inicial)
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
        usuario_id: Uuid,
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
            control_lote: crate::domain::ControlLote,
            estado_catalogo: crate::domain::EstadoCatalogo,
        }

        // 1. Search by presentation barcode
        let gs1 = parse_gs1(codigo);
        let codigo_presentacion = gs1.as_ref().map(|g| g.gtin.as_str()).unwrap_or(codigo);

        let row = sqlx::query_as::<_, Row1>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 (SELECT op.proveedor_id FROM ofertas_proveedor op WHERE op.presentacion_id = pr.id LIMIT 1) as proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 (SELECT op.precio_adquisicion FROM ofertas_proveedor op WHERE op.presentacion_id = pr.id LIMIT 1) as precio_unidad,
                 p.control_lote,
                 p.estado_catalogo
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
                "control_lote": r.control_lote,
                "estado_catalogo": r.estado_catalogo,
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
            control_lote: crate::domain::ControlLote,
            estado_catalogo: crate::domain::EstadoCatalogo,
        }

        let alias_row = sqlx::query_as::<_, AliasRow>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 (SELECT op.proveedor_id FROM ofertas_proveedor op WHERE op.presentacion_id = pr.id LIMIT 1) as proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 pr.id as presentacion_id, pr.nombre as presentacion_nombre, pr.factor_conversion,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 (SELECT op.precio_adquisicion FROM ofertas_proveedor op WHERE op.presentacion_id = pr.id LIMIT 1) as precio_unidad,
                 p.control_lote,
                 p.estado_catalogo
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
                "control_lote": ar.control_lote,
                "estado_catalogo": ar.estado_catalogo,
            }));
        }

        // GS1 check is deferred to the end if not found locally

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
            control_lote: crate::domain::ControlLote,
            estado_catalogo: crate::domain::EstadoCatalogo,
        }

        // 2. Search by product internal code
        let row2 = sqlx::query_as::<_, Row2>(
            r#"SELECT
                 p.id as producto_id, p.nombre as producto_nombre,
                 (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pr ON op.presentacion_id = pr.id WHERE pr.producto_id = p.id AND pr.activa = true LIMIT 1) as proveedor_id,
                 ub.nombre as unidad_base_nombre, ub.nombre_plural as unidad_base_nombre_plural,
                 (SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id IN (SELECT l.id FROM lotes l WHERE l.producto_id = p.id)) as stock_total,
                 p.imagen_url AS imagen_url,
                 (SELECT op.precio_adquisicion FROM ofertas_proveedor op JOIN presentaciones pr ON op.presentacion_id = pr.id WHERE pr.producto_id = p.id AND pr.activa = true LIMIT 1) as precio_unidad,
                 p.control_lote,
                 p.estado_catalogo
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
                "control_lote": r.control_lote,
                "estado_catalogo": r.estado_catalogo,
            }));
        }

        // 3. Search by lot number
        #[derive(sqlx::FromRow)]
        struct Row3 {
            lote_id: Uuid,
            numero_lote: String,
            fecha_vencimiento: Option<chrono::NaiveDate>,
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
            control_lote: crate::domain::ControlLote,
            estado_catalogo: crate::domain::EstadoCatalogo,
        }

        let row3 = sqlx::query_as::<_, Row3>(
            r#"SELECT
                 l.id as lote_id,
                 l.numero_lote,
                 l.fecha_vencimiento,
                 p.id as producto_id,
                 p.nombre as producto_nombre,
                 (SELECT op.proveedor_id FROM ofertas_proveedor op JOIN presentaciones pr ON op.presentacion_id = pr.id WHERE pr.producto_id = p.id AND pr.activa = true LIMIT 1) as proveedor_id,
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
                 (SELECT op.precio_adquisicion FROM ofertas_proveedor op JOIN presentaciones pr ON op.presentacion_id = pr.id WHERE pr.producto_id = p.id AND pr.activa = true LIMIT 1) as precio_unidad,
                 p.control_lote,
                 p.estado_catalogo
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
                "control_lote": r.control_lote,
                "estado_catalogo": r.estado_catalogo,
            }));
        }

        // If not found locally, attempt cascade lookup in regulatory APIs
        match crate::services::api_regulatoria_service::lookup_dispositivo(
            pool,
            codigo_presentacion,
        )
        .await
        {
            Ok(dispositivo) => {
                let base_unit_opt: Option<(i32, String, String)> = sqlx::query_as(
                    "SELECT id, nombre, nombre_plural FROM unidades_basicas ORDER BY id ASC LIMIT 1"
                )
                .fetch_optional(pool)
                .await?;

                let base_unit = match base_unit_opt {
                    Some(u) => u,
                    None => {
                        sqlx::query_as(
                            "INSERT INTO unidades_basicas (nombre, nombre_plural, categoria) \
                             VALUES ('unidad', 'unidades', 'count') \
                             RETURNING id, nombre, nombre_plural",
                        )
                        .fetch_one(pool)
                        .await?
                    }
                };

                let params = CrearProductoParams {
                    nombre: dispositivo.nombre,
                    descripcion: dispositivo.descripcion,
                    categoria_id: None,
                    unidad_base_id: Some(base_unit.0),
                    ubicacion: Some("Estantería de cuarentena".to_string()),
                    temperatura_almacenamiento: None,
                    requiere_cadena_frio: false,
                    dias_estabilidad_abierto: None,
                    clase_riesgo: dispositivo.clase_riesgo,
                    fabricante: dispositivo.fabricante,
                    mpn: None,
                    alias_unidad_clinica: Some("Unidad".to_string()),
                    es_kit: false,
                    stock_minimo_global: Decimal::ZERO,
                    codigo_loinc_cpt: None,
                    control_lote: crate::domain::ControlLote::ConVto,
                    presentaciones: None,
                    area_ids: None,
                    usuario_id,
                    estado_catalogo: Some(crate::domain::EstadoCatalogo::PendienteAprobacion),
                    origen_registro: Some(crate::domain::OrigenRegistro::ApiRegulatoria),
                    promedio_uso_mensual_inicial: None,
                };

                let prod = Self::crear_producto(pool, params).await?;

                let pres: (i32, String) = sqlx::query_as(
                    "SELECT id, nombre FROM presentaciones WHERE producto_id = $1 LIMIT 1",
                )
                .bind(prod.id)
                .fetch_one(pool)
                .await
                .unwrap_or((0, "Unidad".to_string()));

                let mut out = json!({
                    "encontrado": true,
                    "tipo": if gs1.is_some() { "gs1" } else { "presentacion" },
                    "producto_id": prod.id,
                    "producto_nombre": prod.nombre,
                    "unidad_base_nombre": base_unit.1,
                    "unidad_base_nombre_plural": base_unit.2,
                    "presentacion_id": pres.0,
                    "presentacion_nombre": pres.1,
                    "factor_conversion": 1.0,
                    "stock_total": 0.0,
                    "imagen_url": prod.imagen_url,
                    "control_lote": prod.control_lote,
                    "estado_catalogo": prod.estado_catalogo,
                });
                if let Some(ref gs1_val) = gs1 {
                    out["gs1"] = json!({
                        "gtin": gs1_val.gtin,
                        "numero_lote": gs1_val.lote,
                        "fecha_vencimiento": gs1_val.vencimiento,
                    });
                }
                Ok(out)
            }
            Err(_) => {
                if gs1.is_some() {
                    Ok(json!({
                        "encontrado": false,
                        "tipo": "gs1",
                        "motivo": "GTIN no registrado",
                    }))
                } else {
                    Ok(json!({ "encontrado": false, "codigo": codigo }))
                }
            }
        }
    }

    pub async fn lookup_gtin(pool: &PgPool, code: &str) -> Result<serde_json::Value, AppError> {
        let code = code.trim();
        if code.is_empty() {
            return Err(AppError::Validation(
                "Se requiere un código para la búsqueda".into(),
            ));
        }

        // 1. Check local DB
        #[derive(sqlx::FromRow)]
        struct LocalFoundRow {
            id: Uuid,
            nombre: String,
            codigo_interno: String,
            estado_catalogo: crate::domain::EstadoCatalogo,
        }

        let local_match = sqlx::query_as::<_, LocalFoundRow>(
            r#"SELECT id, nombre, codigo_interno, estado_catalogo
               FROM productos
               WHERE (
                   id IN (SELECT producto_id FROM presentaciones WHERE (codigo_barras = $1 OR gtin = $1 OR sku = $1) AND activa = true)
                   OR id IN (SELECT producto_id FROM producto_codigos_barras WHERE codigo = $1 AND activo = true)
               )
               AND deleted_at IS NULL
               LIMIT 1"#
        )
        .bind(code)
        .fetch_optional(pool)
        .await?;

        if let Some(p) = local_match {
            return Ok(json!({
                "found": true,
                "source": "local",
                "existing_product": {
                    "id": p.id,
                    "nombre": p.nombre,
                    "codigo_interno": p.codigo_interno,
                    "estado_catalogo": p.estado_catalogo,
                },
                "data": null,
                "message": "Este producto ya existe en el catálogo"
            }));
        }

        // 2. Check external APIs via lookup_dispositivo
        match crate::services::api_regulatoria_service::lookup_dispositivo(pool, code).await {
            Ok(disp) => Ok(json!({
                "found": true,
                "source": "api_regulatoria",
                "existing_product": null,
                "data": {
                    "nombre": disp.nombre,
                    "fabricante": disp.fabricante,
                    "sku_ref": disp.sku_ref,
                    "clase_riesgo": disp.clase_riesgo,
                    "descripcion": disp.descripcion,
                }
            })),
            Err(AppError::NotFound(_)) => Ok(json!({
                "found": false,
                "source": null,
                "existing_product": null,
                "data": null,
                "message": "No se encontró información regulatoria para el código proporcionado"
            })),
            Err(e) => Err(e),
        }
    }

    /// Lists products with dynamic filtering (search, category, area, supplier),
    /// sorting and pagination. Returns the raw rows plus the total count for the
    /// current filters. The handler maps rows to the HTTP response DTO.
    pub async fn listar(
        pool: &PgPool,
        params: ListarProductosParams,
    ) -> Result<(Vec<ProductoRow>, i64), AppError> {
        let mut conditions = vec!["p.activo = $1".to_string()];
        let mut param_idx = 2;

        if params.q.is_some() {
            conditions.push(format!(
                "(p.search_vector @@ plainto_tsquery('simple', ${0}) OR p.nombre ILIKE '%' || ${0} || '%' OR p.codigo_interno ILIKE '%' || ${0} || '%' OR EXISTS (SELECT 1 FROM presentaciones pres WHERE pres.producto_id = p.id AND pres.sku ILIKE '%' || ${0} || '%'))",
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
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM lotes l WHERE l.producto_id = p.id AND l.proveedor_id = ${})",
                param_idx
            ));
            param_idx += 1;
        }

        let where_clause = conditions.join(" AND ");
        let sort_col = match params.sort_by.as_deref() {
            Some("codigo") => "p.codigo_interno",
            Some("categoria") => "c.nombre",
            Some("proveedor") => "prov_nombre",
            Some("estado") => "p.activo",
            _ => "p.nombre",
        };
        let sort_dir = match params.sort_dir.as_deref() {
            Some("desc") => "DESC",
            _ => "ASC",
        };

        let count_sql = format!("SELECT COUNT(*) FROM productos p WHERE {}", where_clause);
        let data_sql = format!(
            r#"SELECT p.id, p.codigo_interno, p.nombre,
                      p.lead_time_propio, p.activo,
                      CASE
                          WHEN NOT p.activo THEN 'inactivo'
                          WHEN COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id), 0) <= 0
                               AND NOT EXISTS (SELECT 1 FROM movimientos m JOIN lotes lm ON lm.id = m.lote_id WHERE lm.producto_id = p.id)
                              THEN 'pendiente_inicializar'
                          WHEN COALESCE((SELECT SUM(s.cantidad) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = p.id), 0) <= 0
                              THEN 'sin_stock'
                          ELSE 'activo'
                      END AS estado_stock,
                      p.imagen_url AS imagen_url,
                      c.id as cat_id, c.nombre as cat_nombre,
                      um.id as um_id, um.nombre as um_nombre, um.nombre_plural as um_nombre_plural,
                      (SELECT a.id FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_id,
                      (SELECT a.nombre FROM areas a JOIN producto_area pa ON pa.area_id = a.id WHERE pa.producto_id = p.id ORDER BY a.nombre LIMIT 1) as area_nombre,
                      p.control_lote,
                      p.mpn,
                      p.alias_unidad_clinica,
                      p.es_kit,
                      p.stock_minimo_global,
                      p.codigo_loinc_cpt,
                      p.promedio_uso_mensual,
                      p.promedio_uso_mensual_inicial,
                      (SELECT pr.id FROM lotes l JOIN proveedores pr ON pr.id = l.proveedor_id WHERE l.producto_id = p.id AND l.proveedor_id IS NOT NULL LIMIT 1) as prov_id,
                      (SELECT pr.nombre FROM lotes l JOIN proveedores pr ON pr.id = l.proveedor_id WHERE l.producto_id = p.id AND l.proveedor_id IS NOT NULL LIMIT 1) as prov_nombre,
                      (SELECT pr.icono FROM lotes l JOIN proveedores pr ON pr.id = l.proveedor_id WHERE l.producto_id = p.id AND l.proveedor_id IS NOT NULL LIMIT 1) as prov_icono
               FROM productos p
               LEFT JOIN categorias c ON c.id = p.categoria_id
               LEFT JOIN unidades_basicas um ON um.id = p.unidad_base_id
               WHERE {}
               ORDER BY {} {} NULLS LAST, p.nombre ASC, p.id ASC
               LIMIT ${} OFFSET ${}"#,
            where_clause,
            sort_col,
            sort_dir,
            param_idx,
            param_idx + 1
        );

        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql).bind(params.activo);
        let mut data_query = sqlx::query_as::<_, ProductoRow>(&data_sql).bind(params.activo);

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
        if let Some(proveedor_id) = params.proveedor_id {
            count_query = count_query.bind(proveedor_id);
            data_query = data_query.bind(proveedor_id);
        }

        data_query = data_query.bind(params.limit).bind(params.offset);

        let total = count_query.fetch_one(pool).await?;
        let rows = data_query.fetch_all(pool).await?;

        Ok((rows, total))
    }

    // === Códigos de barras secundarios (alias) ===

    /// Lists the active secondary barcodes of a product, ordered by id.
    pub async fn listar_codigos(
        pool: &PgPool,
        producto_id: Uuid,
    ) -> Result<Vec<CodigoBarras>, AppError> {
        let rows = sqlx::query_as::<_, CodigoBarras>(
            "SELECT id, codigo FROM producto_codigos_barras WHERE producto_id = $1 AND activo = TRUE ORDER BY id",
        )
        .bind(producto_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Registers a secondary barcode for a product. Trims the code, validates the
    /// product exists, rejects clashing with another product's primary barcode, and
    /// maps the unique-index violation to a friendly validation error.
    pub async fn agregar_codigo(
        pool: &PgPool,
        producto_id: Uuid,
        codigo_raw: &str,
    ) -> Result<CodigoBarras, AppError> {
        let codigo = codigo_raw.trim().to_string();
        if codigo.is_empty() {
            return Err(AppError::Validation(
                "El código no puede estar vacío".into(),
            ));
        }

        let product_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1 AND activo = TRUE)",
        )
        .bind(producto_id)
        .fetch_one(pool)
        .await?;
        if !product_exists {
            return Err(AppError::NotFound("Producto no encontrado".into()));
        }

        let primary_conflict: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM presentaciones WHERE codigo_barras = $1 AND activa = TRUE AND producto_id != $2)",
        )
        .bind(&codigo)
        .bind(producto_id)
        .fetch_one(pool)
        .await?;
        if primary_conflict {
            return Err(AppError::Validation(
                "Este código ya es el barcode primario de otro producto".into(),
            ));
        }

        let result = sqlx::query_as::<_, CodigoBarras>(
            "INSERT INTO producto_codigos_barras(producto_id, codigo) VALUES($1, $2) RETURNING id, codigo",
        )
        .bind(producto_id)
        .bind(&codigo)
        .fetch_one(pool)
        .await;

        match result {
            Ok(row) => Ok(row),
            Err(sqlx::Error::Database(e))
                if e.constraint() == Some("producto_codigos_barras_codigo_uidx") =>
            {
                Err(AppError::Validation(
                    "Este código ya está registrado para otro producto".into(),
                ))
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Soft-deletes a secondary barcode (sets `activo = FALSE`) scoped to its product.
    pub async fn eliminar_codigo(
        pool: &PgPool,
        producto_id: Uuid,
        codigo_id: i32,
    ) -> Result<(), AppError> {
        let result = sqlx::query(
            "UPDATE producto_codigos_barras SET activo = FALSE WHERE id = $1 AND producto_id = $2",
        )
        .bind(codigo_id)
        .bind(producto_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Código no encontrado".into()));
        }

        Ok(())
    }

    // === Imagen del producto ===

    /// Returns the product's existence and current image path in a single query.
    /// `Ok(None)` => the product does not exist.
    /// `Ok(Some(None))` => the product exists without an image.
    /// `Ok(Some(Some(path)))` => the product exists with an image at `path`.
    pub async fn imagen_actual(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<Option<Option<String>>, AppError> {
        let row = sqlx::query_scalar::<_, Option<String>>(
            "SELECT imagen_url FROM productos WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        Ok(row)
    }

    /// Sets the product's image path.
    pub async fn set_imagen(pool: &PgPool, id: Uuid, path: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE productos SET imagen_url = $1 WHERE id = $2")
            .bind(path)
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// Clears the product's image path (sets it to NULL).
    pub async fn limpiar_imagen(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
        sqlx::query("UPDATE productos SET imagen_url = NULL WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    // === Quarantine (Cuarentena) ===

    /// Lists all active products in quarantine (pendiente_aprobacion).
    pub async fn listar_quarantine(pool: &PgPool) -> Result<Vec<Producto>, AppError> {
        let rows = sqlx::query_as::<_, Producto>(
            "SELECT * FROM productos WHERE estado_catalogo = 'pendiente_aprobacion' AND activo = true ORDER BY created_at DESC"
        )
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Rejects (soft-deletes) a product in quarantine.
    pub async fn reject_product(pool: &PgPool, id: Uuid, usuario_id: Uuid) -> Result<(), AppError> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM productos WHERE id = $1 AND estado_catalogo = 'pendiente_aprobacion')"
        )
        .bind(id)
        .fetch_one(pool)
        .await?;

        if !exists {
            return Err(AppError::NotFound(
                "Producto no encontrado o no está en cuarentena".to_string(),
            ));
        }

        Self::eliminar_producto(pool, id, usuario_id).await?;
        Ok(())
    }

    /// Approves a product from quarantine, updating metadata, scaling stock if presentation factor changes,
    /// and updating/inserting the presentation.
    pub async fn approve_product(
        pool: &PgPool,
        id: Uuid,
        input: ApproveProductParams,
    ) -> Result<(), AppError> {
        let mut tx = pool.begin().await?;

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

        // Mark the product ready inside the transaction before touching gated
        // inventory history. Any later failure rolls this update back together
        // with the stock and presentation changes.
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

        // Stock scaling logic based on the existing presentation factor conversion
        let old_factor = sqlx::query_scalar::<_, Decimal>(
            "SELECT factor_conversion FROM presentaciones WHERE producto_id = $1 LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(Decimal::ONE);
        let old_factor = if old_factor.is_zero() {
            Decimal::ONE
        } else {
            old_factor
        };

        if let Some(new_factor) = input.pres_factor {
            if new_factor != old_factor {
                let multiplier = new_factor / old_factor;

                // Update stock
                sqlx::query(
                    r#"UPDATE stock 
                       SET cantidad = (cantidad * $1)::NUMERIC(12,2)
                       WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $2)"#,
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
                       WHERE lote_id IN (SELECT id FROM lotes WHERE producto_id = $2)"#,
                )
                .bind(multiplier)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| AppError::Internal(format!("Error al escalar stock: {}", e)))?;
            }
        }

        // Presentations sync
        if let (Some(pres_nombre), Some(pres_factor)) = (&input.pres_nombre, input.pres_factor) {
            let pres_exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM presentaciones WHERE producto_id = $1)",
            )
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;

            if pres_exists {
                sqlx::query(
                    r#"UPDATE presentaciones 
                       SET nombre = $1, nombre_plural = $2, factor_conversion = $3
                       WHERE producto_id = $4"#,
                )
                .bind(pres_nombre.trim())
                .bind(
                    input
                        .pres_nombre_plural
                        .as_deref()
                        .unwrap_or(pres_nombre.as_str())
                        .trim(),
                )
                .bind(pres_factor)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    r#"INSERT INTO presentaciones
                       (producto_id, nombre, nombre_plural, factor_conversion, activa)
                       VALUES ($1, $2, $3, $4, true)"#,
                )
                .bind(id)
                .bind(pres_nombre.trim())
                .bind(
                    input
                        .pres_nombre_plural
                        .as_deref()
                        .unwrap_or(pres_nombre.as_str())
                        .trim(),
                )
                .bind(pres_factor)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }
}

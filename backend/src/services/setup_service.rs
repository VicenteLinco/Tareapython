use crate::errors::AppError;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use std::str::FromStr;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ImportConfig {
    pub mapping: HashMap<String, String>,
    #[serde(default)]
    pub required_fields: Vec<String>,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportError {
    pub fila: usize,
    pub mensaje: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub campo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codigo: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportResult {
    pub total_filas: usize,
    pub importados: usize,
    pub omitidos: usize,
    pub errores: Vec<ImportError>,
    pub advertencias: Vec<ImportError>,
    pub preview: Vec<serde_json::Value>,
    pub valido: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ResumenSetup {
    pub productos: i64,
    pub presentaciones: i64,
    pub lotes: i64,
    pub stock_registros: i64,
    pub categorias_creadas: i64,
    pub areas_con_stock: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct EstadoSetup {
    pub carga_inicial_completada: bool,
    pub productos_cargados: i64,
}

pub async fn is_setup_finalizado(pool: &PgPool) -> Result<bool, AppError> {
    let valor: String = sqlx::query_scalar(
        "SELECT valor_texto FROM configuracion WHERE clave = 'setup_finalizado'",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "false".to_string());
    Ok(valor == "true")
}

pub async fn require_setup_mode(pool: &PgPool) -> Result<(), AppError> {
    if is_setup_finalizado(pool).await? {
        return Err(AppError::BusinessLogic(
            "El modo setup ya fue finalizado.".into(),
            "SETUP_FINALIZADO".into(),
        ));
    }
    Ok(())
}

pub async fn verificar_estado(pool: &PgPool) -> Result<EstadoSetup, AppError> {
    let finalizado = is_setup_finalizado(pool).await?;
    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos")
        .fetch_one(pool)
        .await?;
    Ok(EstadoSetup {
        carga_inicial_completada: finalizado,
        productos_cargados: productos.0,
    })
}

pub async fn setup_blockers(pool: &PgPool) -> Result<serde_json::Value, AppError> {
    let unresolved: i64 = sqlx::query_scalar("SELECT count(*) FROM import_batches WHERE status IN ('uploaded','mapped','validated','committing','failed')").fetch_one(pool).await.unwrap_or(0);
    let incomplete: i64 = sqlx::query_scalar("SELECT count(*) FROM productos WHERE activo AND estado_catalogo IN ('incompleto','pendiente_aprobacion')").fetch_one(pool).await?;
    Ok(
        serde_json::json!({"unresolved_batches":unresolved,"incomplete_products":incomplete,"can_finish":unresolved==0 && incomplete==0}),
    )
}

fn diagnostic(
    fila: usize,
    campo: impl Into<String>,
    codigo: impl Into<String>,
    mensaje: impl Into<String>,
) -> ImportError {
    ImportError {
        fila,
        campo: Some(campo.into()),
        codigo: Some(codigo.into()),
        mensaje: mensaje.into(),
    }
}

fn parse_optional_decimal(
    value: &str,
    fila: usize,
    campo: &str,
    errors: &mut Vec<ImportError>,
) -> Option<Decimal> {
    if value.is_empty() {
        return None;
    }
    match Decimal::from_str(value) {
        Ok(parsed) => Some(parsed),
        Err(_) => {
            errors.push(diagnostic(
                fila,
                campo,
                "INVALID_NUMBER",
                format!("{campo} debe ser un número válido; se recibió '{value}'"),
            ));
            None
        }
    }
}

fn parse_optional_i32(
    value: &str,
    fila: usize,
    campo: &str,
    errors: &mut Vec<ImportError>,
) -> Option<i32> {
    if value.is_empty() {
        return None;
    }
    match value.parse::<i32>() {
        Ok(parsed) => Some(parsed),
        Err(_) => {
            errors.push(diagnostic(
                fila,
                campo,
                "INVALID_INTEGER",
                format!("{campo} debe ser un entero válido; se recibió '{value}'"),
            ));
            None
        }
    }
}

pub async fn importar_catalogo(
    pool: &PgPool,
    bytes: &[u8],
    config: ImportConfig,
) -> Result<ImportResult, AppError> {
    require_setup_mode(pool).await?;
    let mut tx = pool.begin().await?;
    let mut result = importar_catalogo_en_tx(&mut tx, bytes, config).await?;
    if result.valido && !result.preview.is_empty() {
        // Preview never mutates; commit only when the caller did not request dry-run.
    }
    // The core performs no writes in dry-run. Commit/rollback is decided from the request.
    // Invalid input always rolls back, which also proves zero partial catalog writes.
    if result.valido {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
        // Report the committed effect, not the number of rows tentatively
        // processed before validation discovered a later error.
        result.importados = 0;
    }
    Ok(result)
}

pub(crate) async fn importar_catalogo_en_tx(
    conn: &mut sqlx::PgConnection,
    bytes: &[u8],
    config: ImportConfig,
) -> Result<ImportResult, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(bytes);

    let headers = reader
        .headers()
        .map_err(|e| AppError::Validation(format!("Error en cabeceras CSV: {}", e)))?
        .clone();

    let mut col_map = HashMap::new();
    for (name, target) in &config.mapping {
        if let Some(idx) = headers.iter().position(|h| h == target) {
            col_map.insert(name.as_str(), idx);
        }
    }

    let mut promedio_uso_inicial_idx = None;
    for (idx, h) in headers.iter().enumerate() {
        let h_lower = h.to_lowercase();
        if h_lower == "promedio_uso"
            || h_lower == "promedio_uso_mensual"
            || h_lower == "uso_mensual"
            || h_lower == "promedio_uso_mensual_inicial"
        {
            promedio_uso_inicial_idx = Some(idx);
            break;
        }
    }

    let mut importados = 0usize;
    let mut omitidos = 0usize;
    let mut errores = Vec::new();
    let mut advertencias = Vec::new();
    let mut preview = Vec::new();
    let mut total_filas = 0usize;

    for (idx, result) in reader.records().enumerate() {
        total_filas += 1;
        let fila_num = idx + 2;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errores.push(ImportError {
                    fila: fila_num,
                    mensaje: format!("Error de formato: {}", e),
                    campo: None,
                    codigo: None,
                });
                continue;
            }
        };

        let get_val = |key: &str| {
            col_map
                .get(key)
                .and_then(|&i| record.get(i))
                .unwrap_or("")
                .trim()
        };
        let get_first_val = |keys: &[&str]| {
            keys.iter()
                .map(|key| get_val(key))
                .find(|value| !value.is_empty())
                .unwrap_or("")
        };

        let nombre = get_val("nombre");
        let descripcion = get_val("descripcion");
        let codigo_interno_csv = get_val("codigo_interno");
        let unidad_nombre = get_first_val(&["unidad_base", "unidad"]);
        let unidad_plural = get_first_val(&["unidad_base_plural", "unidad_plural"]);
        let stock_minimo_str = get_first_val(&["stock_seguridad", "stock_minimo"]);
        let precio_str = get_first_val(&["precio_unitario", "precio_unidad"]);
        let contenido_str = get_first_val(&["contenido", "factor_conversion"]);
        let cod_proveedor = get_val("codigo_proveedor");
        let proveedor_nombre = get_val("proveedor");
        let categoria_nombre = get_val("categoria");
        let promedio_uso_mensual_inicial_str =
            if let Some(&idx) = col_map.get("promedio_uso_mensual_inicial") {
                record.get(idx).unwrap_or("").trim()
            } else if let Some(idx) = promedio_uso_inicial_idx {
                record.get(idx).unwrap_or("").trim()
            } else {
                ""
            };
        let promedio_uso_mensual_inicial = parse_optional_decimal(
            promedio_uso_mensual_inicial_str,
            fila_num,
            "promedio_uso_mensual_inicial",
            &mut errores,
        )
        .unwrap_or(Decimal::ZERO);

        // Nuevos atributos de diseño de producto
        let ubicacion = get_val("ubicacion");
        let temp_almacenamiento = get_val("temperatura_almacenamiento");
        let requiere_cadena_frio_str = get_val("requiere_cadena_frio");
        let requiere_cadena_frio = match requiere_cadena_frio_str.to_lowercase().as_str() {
            "true" | "1" | "si" | "sí" | "yes" => true,
            _ => false,
        };
        let dias_estabilidad_str = get_val("dias_estabilidad_abierto");
        let dias_estabilidad = parse_optional_i32(
            dias_estabilidad_str,
            fila_num,
            "dias_estabilidad_abierto",
            &mut errores,
        );
        let clase_riesgo = get_val("clase_riesgo");
        let fabricante = get_val("fabricante");
        let mpn = get_val("mpn");
        let alias_clinica = get_val("alias_unidad_clinica");
        let es_kit_str = get_val("es_kit");
        let es_kit = match es_kit_str.to_lowercase().as_str() {
            "true" | "1" | "si" | "sí" | "yes" => true,
            _ => false,
        };
        let codigo_loinc = get_val("codigo_loinc_cpt");
        let control_lote_str = get_val("control_lote");
        let control_lote = match control_lote_str.to_lowercase().as_str() {
            "simple" | "no" | "false" => "simple",
            "trazable" | "completo" => "trazable",
            _ => "con_vto",
        };
        let _stock_minimo =
            parse_optional_decimal(stock_minimo_str, fila_num, "stock_minimo", &mut errores);
        let precio = parse_optional_decimal(precio_str, fila_num, "precio_unitario", &mut errores);
        let factor_conversion =
            parse_optional_decimal(contenido_str, fila_num, "factor_conversion", &mut errores);
        if factor_conversion.is_some_and(|value| value <= Decimal::ZERO) {
            errores.push(diagnostic(
                fila_num,
                "factor_conversion",
                "NON_POSITIVE_FACTOR",
                "factor_conversion debe ser mayor a cero",
            ));
        }

        if nombre.is_empty() {
            errores.push(ImportError {
                fila: fila_num,
                mensaje: "nombre es obligatorio".into(),
                campo: None,
                codigo: None,
            });
            continue;
        }

        if let Some(required_key) = config
            .required_fields
            .iter()
            .find(|key| key.as_str() != "nombre" && get_val(key).is_empty())
        {
            errores.push(ImportError {
                fila: fila_num,
                mensaje: format!(
                    "el campo '{}' fue marcado como obligatorio para esta importación",
                    required_key
                ),
                campo: Some(required_key.clone()),
                codigo: Some("REQUIRED_FIELD".into()),
            });
            continue;
        }

        if errores.iter().any(|error| error.fila == fila_num) {
            continue;
        }

        let codigo_generado = format!(
            "IMP-{}",
            uuid::Uuid::new_v4().to_string()[..8].to_uppercase()
        );
        let codigo_interno = if codigo_interno_csv.is_empty() {
            codigo_generado.as_str()
        } else {
            codigo_interno_csv
        };

        if preview.len() < 5 {
            preview.push(serde_json::json!({
                "fila": fila_num,
                "nombre": nombre,
                "codigo_interno": codigo_interno,
                "unidad_base": unidad_nombre,
                "stock_seguridad": stock_minimo_str,
                "proveedor": proveedor_nombre
            }));
        }

        let commercial_without_unit = [
            (!proveedor_nombre.is_empty()).then_some("proveedor"),
            (!cod_proveedor.is_empty()).then_some("código de proveedor"),
            (!precio_str.is_empty()).then_some("precio"),
            (!contenido_str.is_empty()).then_some("contenido"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        if unidad_nombre.is_empty() && !commercial_without_unit.is_empty() {
            advertencias.push(diagnostic(
                fila_num,
                "unidad_base",
                "COMMERCIAL_DATA_REQUIRES_UNIT",
                format!("Se importó el producto, pero se omitió {} porque falta la unidad necesaria para crear una presentación válida.", commercial_without_unit.join(", ")),
            ));
        }

        if config.dry_run {
            continue;
        }

        let existe: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM productos WHERE codigo_interno = $1)")
                .bind(codigo_interno)
                .fetch_one(&mut *conn)
                .await?;

        if existe {
            omitidos += 1;
            continue;
        }

        let lower_unidad = unidad_nombre.to_lowercase();
        let normalized_unidad_nombre = match lower_unidad.as_str() {
            "unidad" | "unidades" | "unidads" | "u" => "unidad",
            "mililitro" | "mililitros" | "ml" => "mililitro",
            "gramo" | "gramos" | "g" => "gramo",
            "litro" | "litros" | "l" => "litro",
            "kilogramo" | "kilogramos" | "kg" => "kilogramo",
            "prueba" | "pruebas" | "test" | "tests" => "prueba",
            other => other,
        };

        let unidad_id: Option<i32> = if unidad_nombre.is_empty() {
            None
        } else {
            sqlx::query_scalar(
                "SELECT id FROM unidades_basicas WHERE nombre = $1 OR nombre_plural = $1",
            )
            .bind(normalized_unidad_nombre)
            .fetch_optional(&mut *conn)
            .await?
        };

        let u_id = match unidad_id {
            Some(id) => Some(id),
            None if !unidad_nombre.is_empty() => {
                let plural_val = if unidad_plural.is_empty() {
                    format!("{}s", normalized_unidad_nombre)
                } else {
                    unidad_plural.to_string()
                };
                sqlx::query_scalar::<_, i32>(
                    "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2) RETURNING id",
                )
                .bind(normalized_unidad_nombre)
                .bind(plural_val)
                .fetch_one(&mut *conn)
                .await?
                .into()
            }
            None => None,
        };

        let cat_id: Option<i32> = if !categoria_nombre.is_empty() {
            let id: Option<i32> = sqlx::query_scalar("SELECT id FROM categorias WHERE nombre = $1")
                .bind(categoria_nombre)
                .fetch_optional(&mut *conn)
                .await?;
            match id {
                Some(id) => Some(id),
                None => Some(
                    sqlx::query_scalar("INSERT INTO categorias (nombre) VALUES ($1) RETURNING id")
                        .bind(categoria_nombre)
                        .fetch_one(&mut *conn)
                        .await?,
                ),
            }
        } else {
            None
        };

        let prov_id: Option<i32> = if !proveedor_nombre.is_empty() && !unidad_nombre.is_empty() {
            let id: Option<i32> =
                sqlx::query_scalar("SELECT id FROM proveedores WHERE nombre = $1")
                    .bind(proveedor_nombre)
                    .fetch_optional(&mut *conn)
                    .await?;
            match id {
                Some(id) => Some(id),
                None => Some(
                    sqlx::query_scalar("INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id")
                        .bind(proveedor_nombre)
                        .fetch_one(&mut *conn)
                        .await?,
                ),
            }
        } else {
            None
        };

        let p_id = uuid::Uuid::new_v4();
        sqlx::query(
            "INSERT INTO productos
             (id, codigo_interno, nombre, descripcion, unidad_base_id, categoria_id, promedio_uso_mensual_inicial, promedio_uso_mensual,
              ubicacion, temperatura_almacenamiento, requiere_cadena_frio, dias_estabilidad_abierto, clase_riesgo, fabricante, mpn, alias_unidad_clinica, es_kit, codigo_loinc_cpt, control_lote, estado_catalogo, origen_registro)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'importacion_csv')",
        )
        .bind(p_id)
        .bind(codigo_interno)
        .bind(nombre)
        .bind(if descripcion.is_empty() {
            None
        } else {
            Some(descripcion)
        })
        .bind(u_id)
        .bind(cat_id)
        .bind(promedio_uso_mensual_inicial)
        .bind(promedio_uso_mensual_inicial)
        .bind(if ubicacion.is_empty() { None } else { Some(ubicacion) })
        .bind(if temp_almacenamiento.is_empty() { None } else { Some(temp_almacenamiento) })
        .bind(requiere_cadena_frio)
        .bind(dias_estabilidad)
        .bind(if clase_riesgo.is_empty() { None } else { Some(clase_riesgo) })
        .bind(if fabricante.is_empty() { None } else { Some(fabricante) })
        .bind(if mpn.is_empty() { None } else { Some(mpn) })
        .bind(if alias_clinica.is_empty() { None } else { Some(alias_clinica) })
        .bind(es_kit)
        .bind(if codigo_loinc.is_empty() { None } else { Some(codigo_loinc) })
        .bind(control_lote)
        .bind(if u_id.is_some() { "pendiente_aprobacion" } else { "incompleto" })
        .execute(&mut *conn)
        .await?;

        let pres_id: Option<i32> = if !unidad_nombre.is_empty() {
            let factor_conversion = factor_conversion.unwrap_or(Decimal::ONE);
            Some(
                sqlx::query_scalar(
                    "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, sku, activa) \
                     VALUES ($1, $2, $3, $4, $5, true) RETURNING id",
                )
                .bind(p_id)
                .bind(unidad_nombre)
                .bind(if unidad_plural.is_empty() {
                    format!("{}s", unidad_nombre)
                } else {
                    unidad_plural.to_string()
                })
                .bind(factor_conversion)
                .bind((!cod_proveedor.is_empty()).then_some(cod_proveedor))
                .fetch_one(&mut *conn)
                .await?,
            )
        } else {
            None
        };

        if let (Some(proveedor_id), Some(pres_id)) = (prov_id, pres_id) {
            sqlx::query(
                "INSERT INTO ofertas_proveedor (presentacion_id, proveedor_id, precio_adquisicion, sku_proveedor) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(pres_id)
            .bind(proveedor_id)
            .bind(precio)
            .bind(if cod_proveedor.is_empty() {
                None
            } else {
                Some(cod_proveedor)
            })
            .execute(&mut *conn)
            .await?;
        }

        importados += 1;
    }

    Ok(ImportResult {
        total_filas,
        importados,
        omitidos,
        errores: errores.clone(),
        advertencias,
        preview,
        valido: total_filas > 0 && errores.is_empty(),
    })
}

pub async fn importar_inventario(
    pool: &PgPool,
    bytes: &[u8],
    usuario_id: uuid::Uuid,
) -> Result<serde_json::Value, AppError> {
    require_setup_mode(pool).await?;

    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(bytes);

    let mut importados = 0;
    let mut errores = Vec::new();
    let mut total_filas = 0;

    let mut tx = pool.begin().await?;

    for (idx, result) in reader.records().enumerate() {
        total_filas += 1;
        let fila_num = idx + 2;
        let record = match result {
            Ok(r) => r,
            Err(e) => {
                errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Error de formato: {}", e) }));
                continue;
            }
        };

        let prod_ref = record.get(0).unwrap_or("");
        let num_lote = record.get(1).unwrap_or("");
        let fecha_venc_str = record.get(2).unwrap_or("");
        let area_nombre = record.get(3).unwrap_or("");
        let cantidad_str = record.get(4).unwrap_or("");
        let costo_str = record.get(5).unwrap_or("");

        if prod_ref.is_empty() || num_lote.is_empty() || area_nombre.is_empty() {
            errores.push(serde_json::json!({ "fila": fila_num, "error": "Producto, Lote y Área son requeridos" }));
            continue;
        }

        let producto_id: Option<uuid::Uuid> =
            sqlx::query_scalar("SELECT id FROM productos WHERE nombre = $1 OR codigo_interno = $1")
                .bind(prod_ref)
                .fetch_optional(&mut *tx)
                .await?;

        let p_id = match producto_id {
            Some(id) => id,
            None => {
                errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Producto '{}' no encontrado", prod_ref) }));
                continue;
            }
        };

        // Do not invoke the lot trigger for products that are still incomplete.
        // The trigger raises PRODUCT_NOT_READY and aborts the transaction; during
        // import we instead quarantine the row as a regular validation error so
        // the caller receives a durable report and the batch remains atomic.
        let inventory_ready: bool = sqlx::query_scalar(
            "SELECT activo AND estado_catalogo = 'aprobado' AND unidad_base_id IS NOT NULL FROM productos WHERE id = $1",
        )
        .bind(p_id)
        .fetch_one(&mut *tx)
        .await?;
        if !inventory_ready {
            errores.push(serde_json::json!({
                "fila": fila_num,
                "codigo": "PRODUCT_NOT_READY",
                "error": format!("Producto '{}' no está listo para recibir stock", prod_ref)
            }));
            continue;
        }

        let area_id: i32 = match sqlx::query_scalar("SELECT id FROM areas WHERE nombre = $1")
            .bind(area_nombre)
            .fetch_optional(&mut *tx)
            .await?
        {
            Some(id) => id,
            None => {
                sqlx::query_scalar("INSERT INTO areas (nombre) VALUES ($1) RETURNING id")
                    .bind(area_nombre)
                    .fetch_one(&mut *tx)
                    .await?
            }
        };

        let fecha_venc = match chrono::NaiveDate::parse_from_str(fecha_venc_str, "%Y-%m-%d")
            .or_else(|_| chrono::NaiveDate::parse_from_str(fecha_venc_str, "%d/%m/%Y"))
        {
            Ok(d) => d,
            Err(_) => {
                errores.push(serde_json::json!({ "fila": fila_num, "error": format!("Fecha '{}' inválida (usar YYYY-MM-DD o DD/MM/YYYY)", fecha_venc_str) }));
                continue;
            }
        };

        let cantidad = Decimal::from_str(cantidad_str).unwrap_or(Decimal::ZERO);
        let costo = Decimal::from_str(costo_str).ok();

        let lote_id: uuid::Uuid = match sqlx::query_scalar(
            "SELECT id FROM lotes WHERE producto_id = $1 AND numero_lote = $2",
        )
        .bind(p_id)
        .bind(num_lote)
        .fetch_optional(&mut *tx)
        .await?
        {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    "INSERT INTO lotes (producto_id, numero_lote, fecha_vencimiento, costo_unitario) VALUES ($1, $2, $3, $4) RETURNING id"
                ).bind(p_id).bind(num_lote).bind(fecha_venc).bind(costo).fetch_one(&mut *tx).await?
            }
        };

        // Registrar la relación producto_area si no existe
        sqlx::query(
            "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        )
        .bind(p_id)
        .bind(area_id)
        .execute(&mut *tx)
        .await?;

        // Aplicar ingreso vía movimientos ledger (esto dispara el trigger y actualiza stock & stock_snapshot)
        crate::services::stock_ops::aplicar_ingreso(
            &mut tx,
            lote_id,
            area_id,
            cantidad,
            usuario_id,
            "CARGA_INICIAL",
            None,
            Some("Carga inicial desde CSV"),
            Some("SETUP"),
            None,
        )
        .await?;

        importados += 1;
    }

    if !errores.is_empty() {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }

    Ok(serde_json::json!({
        "total_filas": total_filas,
        "importados": importados,
        "errores": errores.len(),
        "detalle_errores": errores
    }))
}

pub async fn obtener_resumen(pool: &PgPool) -> Result<ResumenSetup, AppError> {
    let productos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM productos")
        .fetch_one(pool)
        .await?;
    let presentaciones: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM presentaciones")
        .fetch_one(pool)
        .await?;
    let lotes: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM lotes")
        .fetch_one(pool)
        .await?;
    let stock_registros: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM stock WHERE cantidad > 0")
        .fetch_one(pool)
        .await?;
    let categorias: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM categorias")
        .fetch_one(pool)
        .await?;
    let areas: (i64,) =
        sqlx::query_as("SELECT COUNT(DISTINCT area_id) FROM stock WHERE cantidad > 0")
            .fetch_one(pool)
            .await?;

    Ok(ResumenSetup {
        productos: productos.0,
        presentaciones: presentaciones.0,
        lotes: lotes.0,
        stock_registros: stock_registros.0,
        categorias_creadas: categorias.0,
        areas_con_stock: areas.0,
    })
}

pub async fn finalizar_setup(pool: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO configuracion (clave, valor_texto) VALUES ('setup_finalizado', 'true')
         ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
    )
    .execute(pool)
    .await?;
    Ok(())
}

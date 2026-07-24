use crate::errors::{AppError, validate_text_length};
use crate::models::presentacion::Presentacion;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CrearPresentacionParams {
    pub nombre: String,
    pub nombre_plural: String,
    pub factor_conversion: Decimal,
    pub codigo_barras: Option<String>,
    pub gtin: Option<String>,
    pub gs1_habilitado: Option<bool>,
    pub sku: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ActualizarPresentacionParams {
    pub nombre: Option<String>,
    pub nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub codigo_barras: Option<String>,
    pub gtin: Option<String>,
    pub gs1_habilitado: Option<bool>,
    pub sku: Option<String>,
    pub version: i32,
}

pub struct PresentacionService;

impl PresentacionService {
    pub async fn listar(pool: &PgPool, producto_id: Uuid) -> Result<Vec<Presentacion>, AppError> {
        let presentaciones = sqlx::query_as::<_, Presentacion>(
            "SELECT * FROM presentaciones WHERE producto_id = $1 AND activa = true ORDER BY nombre",
        )
        .bind(producto_id)
        .fetch_all(pool)
        .await?;
        Ok(presentaciones)
    }

    pub async fn crear(
        pool: &PgPool,
        producto_id: Uuid,
        params: CrearPresentacionParams,
        usuario_id: Uuid,
    ) -> Result<Presentacion, AppError> {
        let nombre = params.nombre.trim().to_string();
        if nombre.is_empty() {
            return Err(AppError::Validation("El nombre es requerido".into()));
        }
        validate_text_length(&nombre, "nombre", 255)?;
        let nombre_plural = params.nombre_plural.trim().to_string();
        if nombre_plural.is_empty() {
            return Err(AppError::Validation("El plural es requerido".into()));
        }
        validate_text_length(&nombre_plural, "nombre_plural", 100)?;
        if let Some(ref cb) = params.codigo_barras {
            validate_text_length(cb, "codigo_barras", 100)?;
        }
        if let Some(ref gtin) = params.gtin {
            validate_text_length(gtin, "gtin", 14)?;
            if !gtin.chars().all(|c| c.is_ascii_digit()) || gtin.len() != 14 {
                return Err(AppError::Validation("GTIN debe tener 14 digitos".into()));
            }
        }
        if params.factor_conversion <= Decimal::ZERO {
            return Err(AppError::Validation(
                "El factor de conversión debe ser mayor a 0".into(),
            ));
        }

        // A presentation converts quantities into the product's base unit.
        let unidad_base_id: Option<Option<i32>> =
            sqlx::query_scalar("SELECT unidad_base_id FROM productos WHERE id = $1")
                .bind(producto_id)
                .fetch_optional(pool)
                .await?;
        match unidad_base_id {
            None => return Err(AppError::NotFound("Producto no encontrado".into())),
            Some(None) => return Err(AppError::Validation(
                "El producto no tiene unidad de medida; asígnela antes de crear presentaciones u operar stock".into(),
            )),
            Some(Some(_)) => {}
        }

        let presentacion = sqlx::query_as::<_, Presentacion>(
            "INSERT INTO presentaciones (producto_id, nombre, nombre_plural, factor_conversion, codigo_barras, gtin, gs1_habilitado, sku) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        )
        .bind(producto_id)
        .bind(&nombre)
        .bind(&nombre_plural)
        .bind(params.factor_conversion)
        .bind(&params.codigo_barras)
        .bind(&params.gtin)
        .bind(params.gs1_habilitado.unwrap_or(false))
        .bind(&params.sku)
        .fetch_one(pool)
        .await?;

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_nuevos, usuario_id) VALUES ('presentaciones', $1, 'CREATE', $2, $3)",
        )
        .bind(presentacion.id.to_string())
        .bind(json!({"nombre": &presentacion.nombre, "factor_conversion": presentacion.factor_conversion.to_string()}))
        .bind(usuario_id)
        .execute(pool)
        .await?;

        Ok(presentacion)
    }

    pub async fn actualizar(
        pool: &PgPool,
        id: i32,
        params: ActualizarPresentacionParams,
        usuario_id: Uuid,
    ) -> Result<Presentacion, AppError> {
        let anterior =
            sqlx::query_as::<_, Presentacion>("SELECT * FROM presentaciones WHERE id = $1")
                .bind(id)
                .fetch_optional(pool)
                .await?
                .ok_or_else(|| AppError::NotFound("Presentación no encontrada".into()))?;

        if params.version != anterior.version {
            return Err(AppError::VersionConflict {
                esperada: params.version as i64,
                actual: anterior.version as i64,
            });
        }

        // No permitir cambiar factor_conversion si hay recepciones que la usaron
        if let Some(new_factor) = params.factor_conversion
            && new_factor != anterior.factor_conversion {
                // DOM-FREEZE-001: No permitir cambiar factor si está aprobado
                let product_state: String = sqlx::query_scalar(
                    "SELECT estado_catalogo FROM productos WHERE id = $1",
                )
                .bind(anterior.producto_id)
                .fetch_one(pool)
                .await?;

                if product_state == "Aprobado" || product_state == "aprobado" {
                    return Err(AppError::Validation(
                        "No se puede modificar el factor de un producto Aprobado (DOM-FREEZE-001)".to_string(),
                    ));
                }

                let used: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM recepcion_detalle WHERE presentacion_id = $1)",
                )
                .bind(id)
                .fetch_one(pool)
                .await?;

                if used {
                    return Err(AppError::BusinessLogic(
                        "No se puede cambiar el factor de conversión: ya fue usada en recepciones"
                            .into(),
                        "FACTOR_EN_USO".into(),
                    ));
                }
            }

        let nombre = params
            .nombre
            .as_deref()
            .map(str::trim)
            .unwrap_or(&anterior.nombre);
        let nombre_plural = params
            .nombre_plural
            .as_deref()
            .map(str::trim)
            .unwrap_or(&anterior.nombre_plural);
        let factor = params
            .factor_conversion
            .unwrap_or(anterior.factor_conversion);
        let gtin = params.gtin.as_deref().or(anterior.gtin.as_deref());
        if let Some(gtin) = gtin
            && (!gtin.chars().all(|c| c.is_ascii_digit()) || gtin.len() != 14) {
                return Err(AppError::Validation("GTIN debe tener 14 digitos".into()));
            }

        let presentacion = sqlx::query_as::<_, Presentacion>(
            "UPDATE presentaciones SET nombre = $1, nombre_plural = $2, factor_conversion = $3, codigo_barras = $4, gtin = $5, gs1_habilitado = $6, sku = $7, version = version + 1 WHERE id = $8 AND version = $9 RETURNING *",
        )
        .bind(nombre)
        .bind(nombre_plural)
        .bind(factor)
        .bind(params.codigo_barras.as_deref().or(anterior.codigo_barras.as_deref()))
        .bind(gtin)
        .bind(params.gs1_habilitado.unwrap_or(anterior.gs1_habilitado))
        .bind(params.sku.as_deref().or(anterior.sku.as_deref()))
        .bind(id)
        .bind(params.version)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::VersionConflict {
            esperada: params.version as i64,
            actual: anterior.version as i64,
        })?;

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id) VALUES ('presentaciones', $1, 'UPDATE', $2, $3, $4)",
        )
        .bind(id.to_string())
        .bind(json!({"nombre": &anterior.nombre}))
        .bind(json!({"nombre": &presentacion.nombre}))
        .bind(usuario_id)
        .execute(pool)
        .await?;

        Ok(presentacion)
    }

    pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
        let result =
            sqlx::query("UPDATE presentaciones SET activa = false, deleted_at = NOW() WHERE id = $1 AND activa = true")
                .bind(id)
                .execute(pool)
                .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Presentación no encontrada".into()));
        }

        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, usuario_id) VALUES ('presentaciones', $1, 'DELETE', $2)",
        )
        .bind(id.to_string())
        .bind(usuario_id)
        .execute(pool)
        .await?;

        Ok(())
    }
}

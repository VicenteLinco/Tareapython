use crate::errors::AppError;
use crate::services::stock_ops;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug)]
pub struct ConsumoParams {
    pub producto_id: Uuid,
    pub area_id: i32,
    pub cantidad: Decimal,
    pub unidad: String,
    pub presentacion_id: Option<i32>,
    pub nota: Option<String>,
    /// Lote exacto a consumir (escaneado). Obligatorio para 'trazable'.
    pub lote_id: Option<Uuid>,
    pub permitir_vencidos: bool,
}

#[derive(Debug)]
pub struct ConsumoBatchParams {
    pub area_id: Option<i32>,
    pub items: Vec<ConsumoBatchItemParams>,
    pub nota: Option<String>,
}

#[derive(Debug)]
pub struct ConsumoBatchItemParams {
    pub producto_id: Uuid,
    pub cantidad: Decimal,
    pub unidad: String,
    pub presentacion_id: Option<i32>,
    pub area_id: Option<i32>,
    pub lote_id: Option<Uuid>,
    pub permitir_vencidos: bool,
}

pub struct ConsumoService;

impl ConsumoService {
    /// Convierte cantidad a unidades base si se especificó presentación
    pub async fn convertir_a_base(
        pool: &PgPool,
        producto_id: Uuid,
        cantidad: Decimal,
        unidad: &str,
        presentacion_id: Option<i32>,
    ) -> Result<Decimal, AppError> {
        if unidad == "presentacion" {
            let pres_id = presentacion_id.ok_or(AppError::Validation(
                "presentacion_id es requerido cuando unidad = 'presentacion'".into(),
            ))?;

            let factor: Decimal = sqlx::query_scalar(
                "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND producto_id = $2 AND activa = true",
            )
            .bind(pres_id)
            .bind(producto_id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::Validation(format!(
                "La presentación {} no pertenece al producto {}",
                pres_id, producto_id
            )))?;

            Ok(cantidad * factor)
        } else {
            Ok(cantidad)
        }
    }

    /// Registra un consumo individual aplicando FEFO
    pub async fn registrar_consumo(
        pool: &PgPool,
        params: ConsumoParams,
        usuario_id: Uuid,
    ) -> Result<serde_json::Value, AppError> {
        // Convertir a unidades base
        let cantidad_base = Self::convertir_a_base(
            pool,
            params.producto_id,
            params.cantidad,
            &params.unidad,
            params.presentacion_id,
        )
        .await?;
        if cantidad_base <= Decimal::ZERO {
            return Err(AppError::Validation(
                "La cantidad debe ser mayor a 0".into(),
            ));
        }

        // Política de control de lote: 'trazable' exige consumir el lote escaneado.
        let (control_lote, estado_catalogo): (String, String) =
            sqlx::query_as("SELECT control_lote, estado_catalogo FROM productos WHERE id = $1")
                .bind(params.producto_id)
                .fetch_optional(pool)
                .await?
                .ok_or_else(|| AppError::NotFound("Producto no encontrado".into()))?;
        if estado_catalogo == "pendiente_aprobacion" {
            return Err(AppError::ProductInQuarantine {
                producto_id: params.producto_id,
            });
        }
        if control_lote == "trazable" && params.lote_id.is_none() {
            return Err(AppError::Validation(
                "El producto es de control trazable: se requiere el lote escaneado".into(),
            ));
        }

        let mut tx = pool.begin().await?;

        // Lotes a consumir: si viene lote_id (escaneo), se descuenta EXACTAMENTE ese
        // lote (sin caer al FEFO); si no, FEFO automático.
        let lotes = if let Some(lote_id) = params.lote_id {
            let pinned = sqlx::query_as::<_, stock_ops::LoteFefo>(
                r#"SELECT s.id as stock_id, s.lote_id, s.cantidad, s.area_id
                   FROM stock s
                   JOIN lotes l ON l.id = s.lote_id
                   WHERE s.lote_id = $1
                     AND s.area_id = $2
                     AND s.cantidad > 0
                     AND ($3::boolean = true OR l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
                   FOR UPDATE OF s"#,
            )
            .bind(lote_id)
            .bind(params.area_id)
            .bind(params.permitir_vencidos)
            .fetch_all(&mut *tx)
            .await?;
            if pinned.is_empty() {
                tx.rollback().await?;
                return Err(AppError::Validation(format!(
                    "Lote {} sin stock usable en el área indicada",
                    lote_id
                )));
            }
            pinned
        } else {
            stock_ops::lotes_fefo(
                &mut tx,
                params.producto_id,
                params.area_id,
                params.permitir_vencidos,
            )
            .await?
        };
        let disponible = stock_ops::stock_total(&lotes);

        if disponible < cantidad_base {
            tx.rollback().await?;
            return Err(AppError::StockInsuficiente {
                disponible,
                solicitado: cantidad_base,
            });
        }

        // Aviso FEFO no bloqueante: si se consume un lote explícito que NO es el más
        // próximo a vencer, se sugiere el que vence antes (sin frenar el consumo).
        let lote_sugerido: Option<(Uuid, String, NaiveDate)> = if let Some(lote_id) = params.lote_id
        {
            let fv_elegido: Option<NaiveDate> =
                sqlx::query_scalar("SELECT fecha_vencimiento FROM lotes WHERE id = $1")
                    .bind(lote_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .flatten();
            match fv_elegido {
                Some(fv) => {
                    sqlx::query_as::<_, (Uuid, String, NaiveDate)>(
                        r#"SELECT l.id, l.numero_lote, l.fecha_vencimiento
                       FROM stock s
                       JOIN lotes l ON l.id = s.lote_id
                       WHERE l.producto_id = $1
                         AND s.area_id = $2
                         AND s.cantidad > 0
                         AND l.id <> $3
                         AND l.fecha_vencimiento IS NOT NULL
                         AND l.fecha_vencimiento >= CURRENT_DATE
                         AND l.fecha_vencimiento < $4
                       ORDER BY l.fecha_vencimiento ASC
                       LIMIT 1"#,
                    )
                    .bind(params.producto_id)
                    .bind(params.area_id)
                    .bind(lote_id)
                    .bind(fv)
                    .fetch_optional(&mut *tx)
                    .await?
                }
                None => None,
            }
        } else {
            None
        };

        let virtual_consumed_id: Option<i32> =
            sqlx::query_scalar("SELECT id FROM areas WHERE nombre = 'VIRTUAL_CONSUMED'")
                .fetch_optional(pool)
                .await?;

        let grupo = Uuid::new_v4();
        let movimientos = stock_ops::aplicar_salida_fefo(
            &mut tx,
            &lotes,
            cantidad_base,
            usuario_id,
            "CONSUMO",
            grupo,
            params.nota.as_deref(),
            None,
            virtual_consumed_id,
        )
        .await?;

        // Calcular stock restante
        let stock_restante: Option<Decimal> = sqlx::query_scalar(
            r#"SELECT SUM(s.cantidad) FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               WHERE l.producto_id = $1 AND s.area_id = $2 AND s.cantidad > 0"#,
        )
        .bind(params.producto_id)
        .bind(params.area_id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(serde_json::json!({
            "grupo_movimiento": grupo,
            "movimientos": movimientos,
            "stock_restante_area": stock_restante.unwrap_or(Decimal::ZERO),
            "aviso_fefo": lote_sugerido.is_some(),
            "lote_sugerido": lote_sugerido.map(|(id, numero, fecha)| serde_json::json!({
                "lote_id": id,
                "numero_lote": numero,
                "fecha_vencimiento": fecha,
            })),
        }))
    }

    /// Registra un consumo en lote aplicando FEFO
    pub async fn registrar_consumo_batch(
        pool: &PgPool,
        params: ConsumoBatchParams,
        usuario_id: Uuid,
    ) -> Result<serde_json::Value, AppError> {
        // Convertir todas las cantidades a base
        let mut item_pairs: Vec<(&ConsumoBatchItemParams, Decimal)> =
            Vec::with_capacity(params.items.len());
        for item in &params.items {
            let cantidad = Self::convertir_a_base(
                pool,
                item.producto_id,
                item.cantidad,
                &item.unidad,
                item.presentacion_id,
            )
            .await?;
            if cantidad <= Decimal::ZERO {
                return Err(AppError::Validation(
                    "Todas las cantidades deben ser mayor a 0".into(),
                ));
            }
            item_pairs.push((item, cantidad));
        }

        // ORDENAR por producto_id para evitar deadlocks en base de datos al hacer FOR UPDATE
        item_pairs.sort_by_key(|(item, _)| item.producto_id);

        let virtual_consumed_id: Option<i32> =
            sqlx::query_scalar("SELECT id FROM areas WHERE nombre = 'VIRTUAL_CONSUMED'")
                .fetch_optional(pool)
                .await?;

        let mut tx = pool.begin().await?;
        let grupo = Uuid::new_v4();

        // Fase 1: validar stock de todos los items
        let mut items_fallidos = Vec::new();
        let mut lotes_por_item = Vec::new();

        for (item, cantidad) in &item_pairs {
            // Check catalog state
            let estado_catalogo: String =
                sqlx::query_scalar("SELECT estado_catalogo FROM productos WHERE id = $1")
                    .bind(item.producto_id)
                    .fetch_one(&mut *tx)
                    .await?;

            if estado_catalogo == "pendiente_aprobacion" {
                tx.rollback().await?;
                return Err(AppError::ProductInQuarantine {
                    producto_id: item.producto_id,
                });
            }

            let effective_area_id = item.area_id.or(params.area_id);

            let lotes = if let Some(lote_id) = item.lote_id {
                // Pinned lote: validate it exists and has enough stock
                let pinned = sqlx::query_as::<_, stock_ops::LoteFefo>(
                    r#"SELECT s.id as stock_id, s.lote_id, s.cantidad, s.area_id
                       FROM stock s
                       JOIN lotes l ON l.id = s.lote_id
                       WHERE s.lote_id = $1
                         AND ($2::integer IS NULL OR s.area_id = $2)
                         AND s.cantidad > 0
                         AND ($3::boolean = true OR l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
                       FOR UPDATE OF s
                       LIMIT 1"#,
                )
                .bind(lote_id)
                .bind(effective_area_id)
                .bind(item.permitir_vencidos)
                .fetch_optional(&mut *tx)
                .await?;
                match pinned {
                    Some(l) => vec![l],
                    None => {
                        tx.rollback().await?;
                        return Err(AppError::Validation(format!(
                            "Lote {} no tiene stock disponible en el área indicada",
                            lote_id
                        )));
                    }
                }
            } else {
                match effective_area_id {
                    Some(area_id) => {
                        stock_ops::lotes_fefo(
                            &mut tx,
                            item.producto_id,
                            area_id,
                            item.permitir_vencidos,
                        )
                        .await?
                    }
                    None => {
                        stock_ops::lotes_fefo_global(
                            &mut tx,
                            item.producto_id,
                            item.permitir_vencidos,
                        )
                        .await?
                    }
                }
            };

            let disponible = stock_ops::stock_total(&lotes);

            if disponible < *cantidad {
                let nombre: Option<String> =
                    sqlx::query_scalar("SELECT nombre FROM productos WHERE id = $1")
                        .bind(item.producto_id)
                        .fetch_optional(&mut *tx)
                        .await?;
                items_fallidos.push(serde_json::json!({
                    "producto_id": item.producto_id,
                    "producto": nombre.unwrap_or_default(),
                    "stock_disponible": disponible,
                    "cantidad_pedida": cantidad,
                }));
            }
            lotes_por_item.push(lotes);
        }

        if !items_fallidos.is_empty() {
            tx.rollback().await?;
            return Err(AppError::BusinessLogic(
                "Stock insuficiente en uno o más items".into(),
                "STOCK_INSUFICIENTE_BATCH".into(),
            ));
        }

        // Fase 2: aplicar todos los consumos
        let mut total_movimientos = 0u32;
        let mut resumen = Vec::new();

        for (i, (item, cantidad)) in item_pairs.iter().enumerate() {
            let effective_area_id = item.area_id.or(params.area_id);
            let movs = stock_ops::aplicar_salida_fefo(
                &mut tx,
                &lotes_por_item[i],
                *cantidad,
                usuario_id,
                "CONSUMO",
                grupo,
                params.nota.as_deref(),
                None,
                virtual_consumed_id,
            )
            .await?;

            total_movimientos += movs.len() as u32;

            let stock_restante: Option<Decimal> = match effective_area_id {
                Some(area_id) => {
                    sqlx::query_scalar(
                        r#"SELECT SUM(s.cantidad) FROM stock s
                       JOIN lotes l ON l.id = s.lote_id
                       WHERE l.producto_id = $1 AND s.area_id = $2 AND s.cantidad > 0"#,
                    )
                    .bind(item.producto_id)
                    .bind(area_id)
                    .fetch_optional(&mut *tx)
                    .await?
                }
                None => {
                    sqlx::query_scalar(
                        r#"SELECT SUM(s.cantidad) FROM stock s
                       JOIN lotes l ON l.id = s.lote_id
                       WHERE l.producto_id = $1 AND s.cantidad > 0"#,
                    )
                    .bind(item.producto_id)
                    .fetch_optional(&mut *tx)
                    .await?
                }
            };

            resumen.push(serde_json::json!({
                "producto_id": item.producto_id,
                "movimientos": movs.len(),
                "stock_restante": stock_restante,
            }));
        }

        tx.commit().await?;

        Ok(serde_json::json!({
            "grupo_movimiento": grupo,
            "movimientos_generados": total_movimientos,
            "resumen": resumen,
        }))
    }
}

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::errors::AppError;
use crate::handlers::recepciones::DetalleRecepcionInput;
use crate::services::stock_ops;

pub struct RecepcionService;

pub struct CrearRecepcionParams {
    pub proveedor_id: i32,
    pub guia_despacho: Option<String>,
    pub estado: String,
    pub fecha_recepcion: DateTime<Utc>,
    pub nota: Option<String>,
    pub solicitud_id: Option<Uuid>,
    pub detalle: Vec<DetalleRecepcionInput>,
    pub usuario_id: Uuid,
}

impl RecepcionService {
    /// Ejecuta la lógica transaccional para crear una recepción y sus lotes
    pub async fn crear_recepcion(
        pool: &PgPool,
        mut params: CrearRecepcionParams,
    ) -> Result<(Uuid, String), AppError> {
        let es_borrador = params.estado == "borrador";
        let mut tx = pool.begin().await?;

        // Ordenar detalle por producto_id para prevenir deadlocks
        params.detalle.sort_by_key(|d| d.producto_id);

        // Crear cabecera
        let recepcion_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, usuario_id, nota, solicitud_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"#,
        )
        .bind(params.proveedor_id)
        .bind(&params.guia_despacho)
        .bind(&params.estado)
        .bind(params.fecha_recepcion)
        .bind(params.usuario_id)
        .bind(&params.nota)
        .bind(params.solicitud_id)
        .fetch_one(&mut *tx)
        .await?;

        let grupo = Uuid::new_v4();

        for det in &params.detalle {
            // Obtener factor de conversión (None = unidad base, factor 1)
            let factor: Decimal = if let Some(pres_id) = det.presentacion_id {
                sqlx::query_scalar(
                    "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND producto_id = $2 AND activa = true",
                )
                .bind(pres_id)
                .bind(det.producto_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::Validation(format!(
                    "La presentación {} no pertenece al producto {}",
                    pres_id, det.producto_id
                )))?
            } else {
                Decimal::ONE
            };

            let cantidad_base = det.cantidad_presentaciones * factor;

            // Crear o reutilizar lote
            let lote_id = Self::crear_o_reutilizar_lote(
                &mut tx,
                det.producto_id,
                &det.numero_lote,
                det.fecha_vencimiento,
                params.proveedor_id,
                det.costo_unitario,
            )
            .await?;

            // Insertar detalle
            sqlx::query(
                r#"INSERT INTO recepcion_detalle
                   (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
                    cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
            )
            .bind(recepcion_id)
            .bind(det.producto_id)
            .bind(lote_id)
            .bind(det.presentacion_id)
            .bind(det.area_destino_id)
            .bind(det.cantidad_presentaciones)
            .bind(factor)
            .bind(cantidad_base)
            .bind(det.precio_unitario)
            .execute(&mut *tx)
            .await?;

            // Solo generar stock y movimientos si NO es borrador
            if !es_borrador {
                stock_ops::aplicar_ingreso(
                    &mut tx,
                    lote_id,
                    det.area_destino_id,
                    cantidad_base,
                    params.usuario_id,
                    "INGRESO",
                    Some(grupo),
                    params.nota.as_deref(),
                    Some("recepcion"),
                )
                .await?;

                // Auto-populate producto_area
                sqlx::query(
                    r#"INSERT INTO producto_area (producto_id, area_id)
                       VALUES ($1, $2) ON CONFLICT DO NOTHING"#,
                )
                .bind(det.producto_id)
                .bind(det.area_destino_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        // Si es completa y viene de una solicitud, marcarla como completada
        if !es_borrador {
            if let Some(sid) = params.solicitud_id {
                sqlx::query("UPDATE solicitudes_compra SET estado = 'completada' WHERE id = $1")
                    .bind(sid)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        tx.commit().await?;

        let numero_doc: String =
            sqlx::query_scalar("SELECT numero_documento FROM recepciones WHERE id = $1")
                .bind(recepcion_id)
                .fetch_one(pool)
                .await?;

        Ok((recepcion_id, numero_doc))
    }

    /// Confirmar un borrador existente aplicando los movimientos de stock
    pub async fn confirmar_borrador(
        pool: &PgPool,
        id: Uuid,
        usuario_id: Uuid,
    ) -> Result<Uuid, AppError> {
        let mut tx = pool.begin().await?;

        // Verificar que existe y es borrador
        let res: Option<(String, Option<Uuid>)> =
            sqlx::query_as("SELECT estado, solicitud_id FROM recepciones WHERE id = $1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;

        let (estado, solicitud_id) = res.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;
        
        if estado != "borrador" {
            tx.rollback().await?;
            return Err(AppError::BusinessLogic(
                "Solo se pueden confirmar recepciones en estado borrador".into(),
                "ESTADO_INVALIDO".into(),
            ));
        }

        // Obtener detalle
        #[derive(sqlx::FromRow)]
        struct DetalleLine {
            producto_id: Uuid,
            lote_id: Uuid,
            area_destino_id: i32,
            cantidad_unidades_base: Decimal,
        }

        let mut lineas = sqlx::query_as::<_, DetalleLine>(
            "SELECT producto_id, lote_id, area_destino_id, cantidad_unidades_base FROM recepcion_detalle WHERE recepcion_id = $1",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;

        // Ordenar por producto_id para evitar deadlocks
        lineas.sort_by_key(|l| l.producto_id);

        let grupo = Uuid::new_v4();
        let nota: Option<String> = sqlx::query_scalar("SELECT nota FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;

        for linea in &lineas {
            stock_ops::aplicar_ingreso(
                &mut tx,
                linea.lote_id,
                linea.area_destino_id,
                linea.cantidad_unidades_base,
                usuario_id,
                "INGRESO",
                Some(grupo),
                nota.as_deref(),
                Some("recepcion"),
            )
            .await?;

            // Auto-populate producto_area
            sqlx::query(
                "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(linea.producto_id)
            .bind(linea.area_destino_id)
            .execute(&mut *tx)
            .await?;
        }

        // Actualizar estado
        sqlx::query("UPDATE recepciones SET estado = 'completa' WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        // Si viene de una solicitud, marcarla como completada
        if let Some(sid) = solicitud_id {
            sqlx::query("UPDATE solicitudes_compra SET estado = 'completada' WHERE id = $1")
                .bind(sid)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;

        Ok(grupo)
    }

    /// Helper: Crea lote o reutiliza si ya existe (mismo producto + numero_lote)
    pub async fn crear_o_reutilizar_lote(
        tx: &mut Transaction<'_, Postgres>,
        producto_id: Uuid,
        numero_lote: &str,
        fecha_vencimiento: NaiveDate,
        proveedor_id: i32,
        costo_unitario: Option<Decimal>,
    ) -> Result<Uuid, AppError> {
        // Generar código siempre; si hay conflicto, el INSERT lo descarta
        let codigo: String = sqlx::query_scalar("SELECT generar_codigo_lote()")
            .fetch_one(&mut **tx)
            .await?;

        let lote_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, codigo_interno, costo_unitario)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (producto_id, numero_lote) DO UPDATE SET numero_lote = EXCLUDED.numero_lote
               RETURNING id"#,
        )
        .bind(producto_id)
        .bind(proveedor_id)
        .bind(numero_lote)
        .bind(fecha_vencimiento)
        .bind(&codigo)
        .bind(costo_unitario)
        .fetch_one(&mut **tx)
        .await?;

        Ok(lote_id)
    }
}

use rust_decimal::Decimal;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;

pub struct ConteoService;

#[derive(Debug, serde::Serialize)]
pub struct SesionIniciada {
    pub id: Uuid,
    pub total_items: i64,
}

impl ConteoService {
    /// Inicia una nueva sesión de conteo capturando el snapshot actual de stock.
    pub async fn iniciar_sesion(
        pool: &PgPool,
        area_id: i32,
        usuario_id: Uuid,
    ) -> Result<SesionIniciada, AppError> {
        let area_existe: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM areas WHERE id = $1 AND activa = true)",
        )
        .bind(area_id)
        .fetch_one(pool)
        .await?;

        if !area_existe {
            return Err(AppError::NotFound("Área no encontrada o inactiva".into()));
        }

        let mut tx = pool.begin().await?;

        // 1. Bloqueo de concurrencia: Verificar si ya hay una sesión activa para esta área
        let sesion_activa: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT id FROM sesiones_conteo
               WHERE area_id = $1 AND estado IN ('borrador', 'en_progreso')
               FOR UPDATE SKIP LOCKED
               LIMIT 1"#,
        )
        .bind(area_id)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(id) = sesion_activa {
            return Err(AppError::ConflictWithId(
                "Ya existe un conteo activo para esta área".into(),
                "CONTEO_EN_PROGRESO".into(),
                id,
            ));
        }

        // Snapshot de stock actual - SOLO productos activos
        let lotes: Vec<(Uuid, Decimal)> = sqlx::query_as(
            r#"SELECT s.lote_id, s.cantidad
               FROM stock s
               JOIN lotes l ON l.id = s.lote_id
               JOIN productos p ON p.id = l.producto_id
               WHERE s.area_id = $1 AND s.cantidad > 0 AND p.activo = true
               ORDER BY l.fecha_vencimiento ASC"#,
        )
        .bind(area_id)
        .fetch_all(&mut *tx)
        .await?;

        if lotes.is_empty() {
            return Err(AppError::BusinessLogic(
                "No hay productos con stock en esta área para realizar un conteo.".into(),
                "AREA_VACIA".into(),
            ));
        }

        let sesion_id: Uuid = sqlx::query_scalar(
            r#"INSERT INTO sesiones_conteo (area_id, usuario_creador_id)
               VALUES ($1, $2) RETURNING id"#,
        )
        .bind(area_id)
        .bind(usuario_id)
        .fetch_one(&mut *tx)
        .await?;

        let total_items = lotes.len() as i64;

        for (lote_id, cantidad) in &lotes {
            sqlx::query(
                r#"INSERT INTO conteo_items (sesion_id, lote_id, stock_sistema)
                   VALUES ($1, $2, $3)"#,
            )
            .bind(sesion_id)
            .bind(lote_id)
            .bind(cantidad)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(SesionIniciada {
            id: sesion_id,
            total_items,
        })
    }

    /// Actualiza de forma masiva los ítems de una sesión de conteo.
    pub async fn actualizar_items(
        pool: &PgPool,
        sesion_id: Uuid,
        items: Vec<crate::handlers::conteo::UpdateItemInput>,
    ) -> Result<(i32, i32), AppError> {
        let mut tx = pool.begin().await?;

        let estado: String =
            sqlx::query_scalar("SELECT estado FROM sesiones_conteo WHERE id = $1 FOR UPDATE")
                .bind(sesion_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

        if estado == "confirmado" || estado == "cancelado" {
            return Err(AppError::BusinessLogic(
                "No se puede modificar una sesión finalizada".into(),
                "ESTADO_INVALIDO".into(),
            ));
        }

        let mut updated = 0i32;
        let mut conflictos = 0i32;

        for item in items {
            // Validaciones básicas de negocio
            if item.estado_item == "contado" {
                if item.cantidad_contada.is_none() {
                    return Err(AppError::Validation(
                        "Cantidad requerida para ítems contados".into(),
                    ));
                }
                if let Some(c) = item.cantidad_contada {
                    if c < Decimal::ZERO {
                        return Err(AppError::Validation(
                            "Cantidad no puede ser negativa".into(),
                        ));
                    }
                }
            }

            let res = sqlx::query(
                r#"UPDATE conteo_items
                   SET cantidad_contada = $1,
                       estado_item = $2,
                       version = version + 1,
                       updated_at = NOW()
                   WHERE id = $3 AND sesion_id = $4 AND version = $5"#,
            )
            .bind(item.cantidad_contada)
            .bind(&item.estado_item)
            .bind(item.item_id)
            .bind(sesion_id)
            .bind(item.version)
            .execute(&mut *tx)
            .await?;

            if res.rows_affected() == 0 {
                conflictos += 1;
            } else {
                updated += 1;
            }
        }

        if conflictos > 0 {
            tx.rollback().await?;
            return Err(AppError::VersionConflict {
                esperada: 0,
                actual: conflictos as i64,
            });
        }

        // Si estaba en borrador y se actualizaron ítems, pasar a en_progreso
        if estado == "borrador" && updated > 0 {
            sqlx::query("UPDATE sesiones_conteo SET estado = 'en_progreso', updated_at = NOW() WHERE id = $1")
                .bind(sesion_id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE sesiones_conteo SET updated_at = NOW() WHERE id = $1")
                .bind(sesion_id)
                .execute(&mut *tx)
                .await?;
        }

        tx.commit().await?;
        Ok((updated, conflictos))
    }

    /// Confirma la sesión de conteo, aplicando ajustes de stock si hay discrepancias.
    pub async fn confirmar_sesion(
        pool: &PgPool,
        sesion_id: Uuid,
        usuario_id: Uuid,
        nota: Option<String>,
    ) -> Result<serde_json::Value, AppError> {
        let mut tx = pool.begin().await?;

        let (estado, area_id): (String, i32) =
            sqlx::query_as("SELECT estado, area_id FROM sesiones_conteo WHERE id = $1 FOR UPDATE")
                .bind(sesion_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(AppError::NotFound("Sesión no encontrada".into()))?;

        if estado != "en_progreso" && estado != "borrador" {
            return Err(AppError::BusinessLogic(
                "La sesión no puede ser confirmada en su estado actual".into(),
                "ESTADO_INVALIDO".into(),
            ));
        }

        // Buscar ítems con discrepancia
        let items_discrepancia: Vec<(Uuid, Decimal, Decimal)> = sqlx::query_as(
            r#"SELECT lote_id, stock_sistema, cantidad_contada
               FROM conteo_items
               WHERE sesion_id = $1
                 AND estado_item = 'contado'
                 AND cantidad_contada IS NOT NULL
                 AND cantidad_contada <> stock_sistema"#,
        )
        .bind(sesion_id)
        .fetch_all(&mut *tx)
        .await?;

        let grupo_movimiento = Uuid::new_v4();
        let mut ajustes_cont = 0i32;
        let mut movimientos_durante_sesion = 0i64;

        for (lote_id, stock_sis, cant_fisica) in items_discrepancia {
            let stock_actual = Self::stock_actual_bloqueado(&mut tx, lote_id, area_id).await?;
            let diferencia = cant_fisica - stock_actual;
            if diferencia == Decimal::ZERO {
                continue;
            }

            if stock_actual != stock_sis {
                movimientos_durante_sesion += 1;
            }
            let tipo = if diferencia > Decimal::ZERO {
                "AJUSTE_POSITIVO"
            } else {
                "AJUSTE_NEGATIVO"
            };
            let cant_mov = diferencia.abs();

            // El trigger de movimientos actualiza stock y calcula cantidad_resultante.
            sqlx::query(
                r#"INSERT INTO movimientos (grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id, origen, nota)
                   VALUES ($1, $2, $3, $4, $5, 0, $6, 'conteo', $7)"#,
            )
            .bind(grupo_movimiento)
            .bind(lote_id)
            .bind(area_id)
            .bind(tipo)
            .bind(cant_mov)
            .bind(usuario_id)
            .bind(nota.as_deref())
            .execute(&mut *tx)
            .await?;

            ajustes_cont += 1;
        }

        // Cerrar la sesión
        sqlx::query(
            r#"UPDATE sesiones_conteo
               SET estado = 'confirmado',
                   usuario_confirmador_id = $1,
                   nota = COALESCE($2, nota),
                   confirmed_at = NOW(),
                   updated_at = NOW()
               WHERE id = $3"#,
        )
        .bind(usuario_id)
        .bind(nota)
        .bind(sesion_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(json!({
            "id": sesion_id,
            "estado": "confirmado",
            "ajustes_generados": ajustes_cont,
            "grupo_movimiento": grupo_movimiento,
            "movimientos_durante_sesion": movimientos_durante_sesion,
        }))
    }

    async fn stock_actual_bloqueado(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        lote_id: Uuid,
        area_id: i32,
    ) -> Result<Decimal, AppError> {
        let cantidad = sqlx::query_scalar::<_, Decimal>(
            r#"SELECT cantidad
               FROM stock
               WHERE lote_id = $1 AND area_id = $2
               FOR UPDATE"#,
        )
        .bind(lote_id)
        .bind(area_id)
        .fetch_optional(&mut **tx)
        .await?;

        Ok(cantidad.unwrap_or(Decimal::ZERO))
    }
}

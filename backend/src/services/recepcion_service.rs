use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use validator::Validate;

use crate::dto::recepcion::{
    CreateRecepcion, DetalleRecepcionRow, LoteCreado, PaginatedRecepciones, RecepcionListItem,
    RecepcionQuery, RecepcionReconciliacionRow,
};
use crate::errors::AppError;
use crate::services::stock_ops;

async fn reconciliar_solicitud_recepcion(
    tx: &mut Transaction<'_, Postgres>,
    recepcion_id: Uuid,
    solicitud_id: Uuid,
    proveedor_id: i32,
    nota: Option<&str>,
) -> Result<bool, AppError> {
    #[derive(sqlx::FromRow)]
    struct CantidadSolicitada {
        producto_id: Uuid,
        cantidad: Decimal,
        unidad: Option<String>,
    }

    #[derive(sqlx::FromRow)]
    struct CantidadRecibida {
        producto_id: Uuid,
        cantidad: Decimal,
    }

    let solicitados = sqlx::query_as::<_, CantidadSolicitada>(
        r#"SELECT
               d.producto_id,
               SUM(d.cantidad_sugerida) AS cantidad,
               MIN(COALESCE(ub.nombre, pr.nombre)) AS unidad
           FROM solicitud_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN unidades_basicas ub ON ub.id = d.unidad_basica_id
           LEFT JOIN presentaciones pr ON pr.id = d.presentacion_id
           WHERE d.solicitud_id = $1
             AND p.proveedor_id = $2
           GROUP BY d.producto_id"#,
    )
    .bind(solicitud_id)
    .bind(proveedor_id)
    .fetch_all(&mut **tx)
    .await?;

    let recibidos = sqlx::query_as::<_, CantidadRecibida>(
        r#"SELECT producto_id, SUM(cantidad_unidades_base) AS cantidad
           FROM recepcion_detalle
           WHERE recepcion_id = $1
           GROUP BY producto_id"#,
    )
    .bind(recepcion_id)
    .fetch_all(&mut **tx)
    .await?;

    let solicitados_map: HashMap<Uuid, (Decimal, Option<String>)> = solicitados
        .into_iter()
        .map(|row| (row.producto_id, (row.cantidad, row.unidad)))
        .collect();
    let recibidos_map: HashMap<Uuid, Decimal> = recibidos
        .into_iter()
        .map(|row| (row.producto_id, row.cantidad))
        .collect();

    let mut producto_ids: HashSet<Uuid> = solicitados_map.keys().copied().collect();
    producto_ids.extend(recibidos_map.keys().copied());

    sqlx::query("DELETE FROM recepcion_reconciliacion WHERE recepcion_id = $1")
        .bind(recepcion_id)
        .execute(&mut **tx)
        .await?;

    let mut cubre_todo_lo_solicitado = !solicitados_map.is_empty();

    for producto_id in producto_ids {
        let (cantidad_solicitada, unidad) = solicitados_map
            .get(&producto_id)
            .cloned()
            .unwrap_or((Decimal::ZERO, None));
        let cantidad_recibida = recibidos_map
            .get(&producto_id)
            .copied()
            .unwrap_or(Decimal::ZERO);
        let diferencia = cantidad_recibida - cantidad_solicitada;

        let estado = if cantidad_solicitada == Decimal::ZERO && cantidad_recibida > Decimal::ZERO {
            "extra"
        } else if cantidad_solicitada > Decimal::ZERO && cantidad_recibida == Decimal::ZERO {
            cubre_todo_lo_solicitado = false;
            "no_recibido"
        } else if cantidad_recibida < cantidad_solicitada {
            cubre_todo_lo_solicitado = false;
            "faltante"
        } else if cantidad_recibida > cantidad_solicitada {
            "sobrante"
        } else {
            "ok"
        };

        sqlx::query(
            r#"INSERT INTO recepcion_reconciliacion
               (recepcion_id, solicitud_id, producto_id, estado,
                cantidad_solicitada, cantidad_recibida, diferencia, unidad, nota)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        )
        .bind(recepcion_id)
        .bind(solicitud_id)
        .bind(producto_id)
        .bind(estado)
        .bind(cantidad_solicitada)
        .bind(cantidad_recibida)
        .bind(diferencia)
        .bind(unidad)
        .bind(nota)
        .execute(&mut **tx)
        .await?;
    }

    Ok(cubre_todo_lo_solicitado)
}

pub async fn listar(
    pool: &PgPool,
    params: RecepcionQuery,
    _usuario_id: Uuid,
    _rol: &str,
) -> Result<PaginatedRecepciones, AppError> {
    // El área es solo un filtro opcional; no restringe qué recepciones se listan.
    let per_page = params.per_page.unwrap_or(15).clamp(1, 100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let mut conditions = Vec::new();
    let mut param_idx = 1;

    let mut pid_val = 0;
    let mut estado_val = String::new();
    let mut desde_val = String::new();
    let mut hasta_val = String::new();
    let mut busqueda_val = String::new();
    let mut aid_val = 0;

    if let Some(pid) = params.proveedor_id {
        conditions.push(format!("r.proveedor_id = ${}", param_idx));
        pid_val = pid;
        param_idx += 1;
    }
    if let Some(ref estado) = params.estado {
        if estado == "confirmada" {
            conditions.push("r.estado != 'borrador'".to_string());
        } else {
            conditions.push(format!("r.estado = ${}", param_idx));
            estado_val = estado.clone();
            param_idx += 1;
        }
    }
    if let Some(desde) = params.desde {
        conditions.push(format!("r.fecha_recepcion >= ${}::date", param_idx));
        desde_val = desde.to_string();
        param_idx += 1;
    }
    if let Some(hasta) = params.hasta {
        conditions.push(format!("r.fecha_recepcion < (${}::date + 1)", param_idx));
        hasta_val = hasta.to_string();
        param_idx += 1;
    }
    if let Some(ref busqueda) = params.busqueda {
        conditions.push(format!(
            "(r.numero_documento ILIKE ${0} OR r.guia_despacho ILIKE ${0})",
            param_idx
        ));
        busqueda_val = format!("%{}%", busqueda);
        param_idx += 1;
    }
    if let Some(aid) = params.area_id {
        conditions.push(format!(
            "r.id IN (SELECT rd2.recepcion_id FROM recepcion_detalle rd2 WHERE rd2.area_destino_id = ${})",
            param_idx
        ));
        aid_val = aid;
        param_idx += 1;
    }
    if let Some(true) = params.solo_con_foto {
        conditions.push("r.guia_despacho_archivo IS NOT NULL".to_string());
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        r#"SELECT
            r.id, r.numero_documento, p.nombre as proveedor_nombre, p.icono as proveedor_icono,
            r.guia_despacho, r.guia_despacho_archivo, r.estado::text AS estado, r.fecha_recepcion, u.nombre as usuario_nombre,
            r.created_at, r.guia_despacho_archivo IS NOT NULL as tiene_foto,
            r.solicitud_id,
            (SELECT STRING_AGG(DISTINCT a.nombre, ', ')
             FROM recepcion_detalle rd
             JOIN areas a ON a.id = rd.area_destino_id
             WHERE rd.recepcion_id = r.id) as areas_destino,
            COALESCE((SELECT COUNT(DISTINCT rd.producto_id)::INT4 FROM recepcion_detalle rd WHERE rd.recepcion_id = r.id), 0) as items_count,
            COALESCE((SELECT COUNT(*)::INT4 FROM recepcion_detalle rd WHERE rd.recepcion_id = r.id), 0) as lotes_count
           FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           {}
           ORDER BY r.fecha_recepcion DESC, r.created_at DESC
           LIMIT ${} OFFSET ${}"#,
        where_clause,
        param_idx,
        param_idx + 1
    );

    let mut query = sqlx::query_as::<_, RecepcionListItem>(&sql);

    if params.proveedor_id.is_some() {
        query = query.bind(pid_val);
    }
    if let Some(ref estado) = params.estado {
        if estado != "confirmada" {
            query = query.bind(estado_val.clone());
        }
    }
    if params.desde.is_some() {
        query = query.bind(desde_val.clone());
    }
    if params.hasta.is_some() {
        query = query.bind(hasta_val.clone());
    }
    if params.busqueda.is_some() {
        query = query.bind(busqueda_val.clone());
    }
    if params.area_id.is_some() {
        query = query.bind(aid_val);
    }

    let data = query.bind(per_page).bind(offset).fetch_all(pool).await?;

    let count_sql = format!(
        r#"SELECT COUNT(*)::INT4
           FROM recepciones r
           JOIN proveedores p ON p.id = r.proveedor_id
           JOIN usuarios u ON u.id = r.usuario_id
           {}"#,
        where_clause
    );

    let mut count_query = sqlx::query_scalar::<_, i32>(&count_sql);

    if params.proveedor_id.is_some() {
        count_query = count_query.bind(pid_val);
    }
    if let Some(ref estado) = params.estado {
        if estado != "confirmada" {
            count_query = count_query.bind(estado_val);
        }
    }
    if params.desde.is_some() {
        count_query = count_query.bind(desde_val);
    }
    if params.hasta.is_some() {
        count_query = count_query.bind(hasta_val);
    }
    if params.busqueda.is_some() {
        count_query = count_query.bind(busqueda_val);
    }
    if params.area_id.is_some() {
        count_query = count_query.bind(aid_val);
    }

    let total = count_query.fetch_one(pool).await?;

    Ok(PaginatedRecepciones {
        data,
        total,
        page,
        per_page,
        total_pages: (total + per_page - 1) / per_page,
    })
}

pub async fn crear_recepcion(
    pool: &PgPool,
    req: CreateRecepcion,
    usuario_id: Uuid,
) -> Result<(Uuid, Vec<LoteCreado>), AppError> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let estado = req.estado.as_deref().unwrap_or("completa");
    if !["completa", "parcial", "rechazada", "borrador"].contains(&estado) {
        return Err(AppError::Validation(format!("Estado inválido: {}", estado)));
    }

    // Para rechazada: no se necesitan ítems en detalle
    if estado != "rechazada" && req.detalle.is_empty() {
        return Err(AppError::Validation(
            "Se requiere al menos un ítem en el detalle".into(),
        ));
    }

    let mut tx = pool.begin().await?;

    let (recepcion_id, _numero): (Uuid, String) = sqlx::query_as(
        "INSERT INTO recepciones (proveedor_id, guia_despacho, estado, fecha_recepcion, nota, motivo_rechazo, solicitud_id, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, numero_documento"
    )
    .bind(req.proveedor_id)
    .bind(&req.guia_despacho)
    .bind(estado)
    .bind(req.fecha_recepcion)
    .bind(&req.nota)
    .bind(&req.motivo_rechazo)
    .bind(req.solicitud_id)
    .bind(usuario_id)
    .fetch_one(&mut *tx)
    .await?;

    let mut lotes_creados: Vec<LoteCreado> = Vec::new();

    // Para rechazada no procesamos ítems
    if estado != "rechazada" {
        for item in &req.detalle {
            // Obtener nombre del producto y área para el LoteCreado
            let (producto_nombre, presentacion_nombre, area_nombre): (
                String,
                Option<String>,
                String,
            ) = sqlx::query_as(
                r#"SELECT p.nombre,
                          (SELECT pr.nombre FROM presentaciones pr WHERE pr.id = $2),
                          a.nombre
                   FROM productos p, areas a
                   WHERE p.id = $1 AND a.id = $3"#,
            )
            .bind(item.producto_id)
            .bind(item.presentacion_id)
            .bind(item.area_destino_id)
            .fetch_one(&mut *tx)
            .await?;

            let lote_id: Uuid = sqlx::query_scalar(
                r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario, presentacion_id, recepcion_id)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (producto_id, numero_lote)
                   DO UPDATE SET
                       fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                       costo_unitario = EXCLUDED.costo_unitario,
                       presentacion_id = CASE
                           WHEN EXCLUDED.presentacion_id IS NOT NULL THEN EXCLUDED.presentacion_id
                           ELSE lotes.presentacion_id
                       END,
                       recepcion_id = COALESCE(lotes.recepcion_id, EXCLUDED.recepcion_id)
                   RETURNING id"#
            )
            .bind(item.producto_id)
            .bind(req.proveedor_id)
            .bind(&item.numero_lote)
            .bind(item.fecha_vencimiento)
            .bind(item.costo_unitario)
            .bind(item.presentacion_id)
            .bind(recepcion_id)
            .fetch_one(&mut *tx)
            .await?;

            let factor = if let Some(pres_id) = item.presentacion_id {
                sqlx::query_scalar::<_, Decimal>(
                    "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND activa = true",
                )
                .bind(pres_id)
                .fetch_one(&mut *tx)
                .await?
            } else {
                Decimal::from(1)
            };

            let cantidad_base = item.cantidad_presentaciones * factor;

            sqlx::query(
                "INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
                                              cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
            )
            .bind(recepcion_id)
            .bind(item.producto_id)
            .bind(lote_id)
            .bind(item.presentacion_id)
            .bind(item.area_destino_id)
            .bind(item.cantidad_presentaciones)
            .bind(factor)
            .bind(cantidad_base)
            .bind(item.precio_unitario)
            .execute(&mut *tx)
            .await?;

            // completa y parcial ambas aplican movimientos de stock
            if estado == "completa" || estado == "parcial" {
                sqlx::query(
                    "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
                )
                .bind(item.producto_id)
                .bind(item.area_destino_id)
                .execute(&mut *tx)
                .await?;

                stock_ops::aplicar_ingreso(
                    &mut tx,
                    lote_id,
                    item.area_destino_id,
                    cantidad_base,
                    usuario_id,
                    "INGRESO",
                    Some(recepcion_id),
                    None,
                    Some("RECEPCION"),
                    None,
                )
                .await?;
            }

            lotes_creados.push(LoteCreado {
                lote_id,
                numero_lote: item.numero_lote.clone(),
                fecha_vencimiento: item.fecha_vencimiento,
                producto_id: item.producto_id,
                producto_nombre,
                presentacion_nombre,
                area_nombre,
                cantidad: item.cantidad_presentaciones,
            });
        }
    }

    if let Some(solicitud_id) = req.solicitud_id {
        let cubre_todo = reconciliar_solicitud_recepcion(
            &mut tx,
            recepcion_id,
            solicitud_id,
            req.proveedor_id,
            req.nota.as_deref(),
        )
        .await?;

        if estado == "completa" && cubre_todo {
            sqlx::query(
                "UPDATE solicitudes_compra
                 SET estado = 'completada', fecha_cierre = COALESCE(fecha_cierre, NOW())
                 WHERE id = $1 AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')",
            )
            .bind(solicitud_id)
            .execute(&mut *tx)
            .await?;
        } else if !cubre_todo {
            sqlx::query(
                "UPDATE solicitudes_compra
                 SET estado = 'parcialmente_recibida'
                 WHERE id = $1 AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')",
            )
            .bind(solicitud_id)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok((recepcion_id, lotes_creados))
}

pub async fn confirmar_borrador(
    pool: &PgPool,
    id: Uuid,
    usuario_id: Uuid,
) -> Result<Uuid, AppError> {
    let mut tx = pool.begin().await?;

    // Verificar que existe y es borrador
    let res: Option<(String, Option<Uuid>, i32)> =
        sqlx::query_as("SELECT estado, solicitud_id, proveedor_id FROM recepciones WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

    let (estado, solicitud_id, proveedor_id) =
        res.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    if estado != "borrador" {
        tx.rollback().await?;
        return Err(AppError::ConflictWithCode(
            "Solo se pueden confirmar recepciones en estado borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

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

    lineas.sort_by_key(|l| l.producto_id);

    let nota: Option<String> = sqlx::query_scalar("SELECT nota FROM recepciones WHERE id = $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;

    for linea in &lineas {
        sqlx::query(
            "INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(linea.producto_id)
        .bind(linea.area_destino_id)
        .execute(&mut *tx)
        .await?;

        stock_ops::aplicar_ingreso(
            &mut tx,
            linea.lote_id,
            linea.area_destino_id,
            linea.cantidad_unidades_base,
            usuario_id,
            "INGRESO",
            Some(id),
            nota.as_deref(),
            Some("RECEPCION"),
            None,
        )
        .await?;
    }

    sqlx::query("UPDATE recepciones SET estado = 'completa' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    if let Some(sid) = solicitud_id {
        let cubre_todo =
            reconciliar_solicitud_recepcion(&mut tx, id, sid, proveedor_id, nota.as_deref())
                .await?;
        if cubre_todo {
            sqlx::query(
                "UPDATE solicitudes_compra
                 SET estado = 'completada', fecha_cierre = COALESCE(fecha_cierre, NOW())
                 WHERE id = $1 AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')",
            )
            .bind(sid)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "UPDATE solicitudes_compra
                 SET estado = 'parcialmente_recibida'
                 WHERE id = $1 AND estado IN ('guardada', 'parcialmente_enviada', 'enviada', 'parcialmente_recibida')",
            )
            .bind(sid)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    Ok(id)
}

pub async fn obtener_detalles(
    pool: &PgPool,
    id: Uuid,
) -> Result<Vec<DetalleRecepcionRow>, AppError> {
    sqlx::query_as::<_, DetalleRecepcionRow>(
        r#"SELECT
            rd.id, p.nombre as producto_nombre, l.numero_lote, l.fecha_vencimiento,
            pr.nombre as presentacion_nombre, rd.cantidad_presentaciones,
            rd.factor_conversion_usado, rd.cantidad_unidades_base,
            um.nombre as unidad_base_nombre, um.nombre_plural as unidad_base_nombre_plural,
            a.nombre as area_destino, rd.lote_id as lote_id
           FROM recepcion_detalle rd
           JOIN productos p ON p.id = rd.producto_id
           JOIN lotes l ON l.id = rd.lote_id
           JOIN unidades_basicas um ON um.id = p.unidad_base_id
           JOIN areas a ON a.id = rd.area_destino_id
           LEFT JOIN presentaciones pr ON pr.id = rd.presentacion_id
           WHERE rd.recepcion_id = $1
           ORDER BY p.nombre"#,
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn eliminar_borrador(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let estado: Option<String> = sqlx::query_scalar("SELECT estado FROM recepciones WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;

    let estado = estado.ok_or(AppError::NotFound("Recepción no encontrada".into()))?;

    if estado != "borrador" {
        return Err(AppError::ConflictWithCode(
            "Solo se pueden eliminar recepciones en estado borrador".into(),
            "ESTADO_INVALIDO".into(),
        ));
    }

    sqlx::query("DELETE FROM recepciones WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn obtener_reconciliacion(
    pool: &PgPool,
    id: Uuid,
) -> Result<Vec<RecepcionReconciliacionRow>, AppError> {
    sqlx::query_as::<_, RecepcionReconciliacionRow>(
        r#"SELECT
            rr.id, rr.recepcion_id, rr.solicitud_id, rr.producto_id,
            p.nombre as producto_nombre,
            rr.estado, rr.cantidad_solicitada, rr.cantidad_recibida,
            rr.diferencia, rr.unidad, rr.nota, rr.created_at
           FROM recepcion_reconciliacion rr
           JOIN productos p ON p.id = rr.producto_id
           WHERE rr.recepcion_id = $1
           ORDER BY
             CASE rr.estado
               WHEN 'no_recibido' THEN 1
               WHEN 'faltante' THEN 2
               WHEN 'sobrante' THEN 3
               WHEN 'extra' THEN 4
               ELSE 5
             END,
             p.nombre"#,
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

use chrono::NaiveDate;
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
           LEFT JOIN presentaciones fallback_pr ON fallback_pr.producto_id = d.producto_id AND fallback_pr.activa = true
           WHERE d.solicitud_id = $1
             AND EXISTS (
                 SELECT 1 FROM ofertas_proveedor op 
                 WHERE op.presentacion_id = COALESCE(pr.id, fallback_pr.id) AND op.proveedor_id = $2
             )
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
    if let Some(ref estado) = params.estado
        && estado != "confirmada" {
            query = query.bind(estado_val.clone());
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
    if let Some(ref estado) = params.estado
        && estado != "confirmada" {
            count_query = count_query.bind(estado_val);
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

    let mut any_alert = false;
    let mut warning_details: Vec<String> = Vec::new();

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
        // Pre-fetch all necessary info to avoid N+1 queries
        let producto_ids: Vec<Uuid> = req.detalle.iter().map(|i| i.producto_id).collect();
        let area_ids: Vec<i32> = req.detalle.iter().map(|i| i.area_destino_id).collect();
        let pres_ids: Vec<i32> = req.detalle.iter().filter_map(|i| i.presentacion_id).collect();

        #[derive(sqlx::FromRow)]
        struct ProdInfo { id: Uuid, nombre: String, control_lote: String }
        let productos: Vec<ProdInfo> = sqlx::query_as("SELECT id, nombre, control_lote FROM productos WHERE id = ANY($1)")
            .bind(&producto_ids)
            .fetch_all(&mut *tx).await?;
        let prod_map: HashMap<Uuid, (String, String)> = productos.into_iter().map(|p| (p.id, (p.nombre, p.control_lote))).collect();

        #[derive(sqlx::FromRow)]
        struct AreaInfo { id: i32, nombre: String }
        let areas: Vec<AreaInfo> = sqlx::query_as("SELECT id, nombre FROM areas WHERE id = ANY($1)")
            .bind(&area_ids)
            .fetch_all(&mut *tx).await?;
        let area_map: HashMap<i32, String> = areas.into_iter().map(|a| (a.id, a.nombre)).collect();

        #[derive(sqlx::FromRow)]
        struct PresInfo { id: i32, nombre: String, factor_conversion: Decimal }
        let presentaciones: Vec<PresInfo> = sqlx::query_as("SELECT id, nombre, factor_conversion FROM presentaciones WHERE id = ANY($1)")
            .bind(&pres_ids)
            .fetch_all(&mut *tx).await?;
        let pres_map: HashMap<i32, (String, Decimal)> = presentaciones.into_iter().map(|p| (p.id, (p.nombre, p.factor_conversion))).collect();

        for item in &req.detalle {
            let (producto_nombre, control_lote) = prod_map.get(&item.producto_id)
                .cloned()
                .unwrap_or_else(|| ("Desconocido".to_string(), "con_vto".to_string()));
            let area_nombre = area_map.get(&item.area_destino_id)
                .cloned()
                .unwrap_or_else(|| "Desconocido".to_string());
            let (presentacion_nombre, factor_conversion) = if let Some(pid) = item.presentacion_id {
                pres_map.get(&pid).map(|(n, f)| (Some(n.clone()), *f)).unwrap_or((None, Decimal::from(1)))
            } else {
                (None, Decimal::from(1))
            };

            // Resolver número de lote y vencimiento efectivos según la política:
            //  - trazable: lote y vencimiento OBLIGATORIOS (trazabilidad clínica).
            //  - simple:   el usuario no carga nada; lote implícito por recepción
            //              (sentinela 'IMPL-{recepcion}'), sin vencimiento.
            //  - con_vto:  comportamiento actual (lote y vencimiento requeridos).
            let numero_lote_in = item
                .numero_lote
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let (numero_lote_efectivo, fecha_venc_efectiva): (String, Option<NaiveDate>) =
                match control_lote.as_str() {
                    "simple" => (format!("IMPL-{recepcion_id}"), None),
                    "trazable" => {
                        let nl = numero_lote_in.ok_or_else(|| {
                            AppError::Validation(format!(
                                "El producto '{producto_nombre}' es de control trazable: requiere número de lote"
                            ))
                        })?;
                        let fv = item.fecha_vencimiento.ok_or_else(|| {
                            AppError::Validation(format!(
                                "El producto '{producto_nombre}' es de control trazable: requiere fecha de vencimiento"
                            ))
                        })?;
                        (nl.to_string(), Some(fv))
                    }
                    _ => {
                        let nl = numero_lote_in.ok_or_else(|| {
                            AppError::Validation(format!(
                                "El producto '{producto_nombre}' requiere número de lote"
                            ))
                        })?;
                        let fv = item.fecha_vencimiento.ok_or_else(|| {
                            AppError::Validation(format!(
                                "El producto '{producto_nombre}' requiere fecha de vencimiento"
                            ))
                        })?;
                        (nl.to_string(), Some(fv))
                    }
                };

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
            .bind(&numero_lote_efectivo)
            .bind(fecha_venc_efectiva)
            .bind(item.costo_unitario)
            .bind(item.presentacion_id)
            .bind(recepcion_id)
            .fetch_one(&mut *tx)
            .await?;

            let factor = factor_conversion;

            let cantidad_base = item.cantidad_presentaciones * factor;

            let mut alerta_item = false;
            let mut desperdicio_item = Decimal::ZERO;

            if let Some(fv) = fecha_venc_efectiva {
                let validation_res = validar_vencimiento(
                    pool,
                    crate::dto::recepcion::ValidarVencimientoInput {
                        producto_id: item.producto_id,
                        cantidad: item.cantidad_presentaciones,
                        presentacion_id: item.presentacion_id,
                        fecha_vencimiento: fv,
                    },
                )
                .await
                .unwrap_or(crate::dto::recepcion::ValidarVencimientoResponse {
                    desperdicio_proyectado: Decimal::ZERO,
                    alerta_vencimiento: false,
                });
                alerta_item = validation_res.alerta_vencimiento;
                desperdicio_item = validation_res.desperdicio_proyectado;
            }

            if alerta_item {
                any_alert = true;
                warning_details.push(format!(
                    "{} (Lote: {}, Desperdicio: {})",
                    producto_nombre, numero_lote_efectivo, desperdicio_item
                ));
            }

            sqlx::query(
                "INSERT INTO recepcion_detalle (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
                                              cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario,
                                              alerta_vencimiento, desperdicio_proyectado)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
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
            .bind(alerta_item)
            .bind(desperdicio_item)
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
                numero_lote: numero_lote_efectivo.clone(),
                fecha_vencimiento: fecha_venc_efectiva,
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

    if any_alert {
        let titulo = format!("Alerta de vencimiento en recepción {}", _numero);
        let mensaje = format!(
            "Se detectaron productos con riesgo de vencimiento o vida útil corta: {}.",
            warning_details.join(", ")
        );
        let _ = crate::services::notificacion_service::crear_para_admins(
            pool,
            &titulo,
            &mensaje,
            "vencimiento",
        )
        .await;
    }

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

async fn load_vencimiento_settings(pool: &PgPool) -> Result<(bool, i32, i32), AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN (
            'vencimiento_alerta_activa',
            'vencimiento_vida_util_minima_dias',
            'vencimiento_margen_tolerancia_pct'
        )",
    )
    .fetch_all(pool)
    .await?;

    let mut alerta_activa = true;
    let mut vida_util_minima = 30;
    let mut margen_tolerancia = 10;

    for (clave, valor) in rows {
        match clave.as_str() {
            "vencimiento_alerta_activa" => alerta_activa = valor == "true",
            "vencimiento_vida_util_minima_dias" => vida_util_minima = valor.parse().unwrap_or(30),
            "vencimiento_margen_tolerancia_pct" => margen_tolerancia = valor.parse().unwrap_or(10),
            _ => {}
        }
    }

    Ok((alerta_activa, vida_util_minima, margen_tolerancia))
}

pub fn calcular_alerta_vencimiento_pure(
    dias_vida_util: i64,
    vida_util_minima: i64,
    stock_actual: Decimal,
    cantidad_base: Decimal,
    mu: f64,
    margen_tolerancia: i32,
) -> (Decimal, bool) {
    let dias_vida_util_f = if dias_vida_util < 0 {
        0.0
    } else {
        dias_vida_util as f64
    };
    let total_stock_base = stock_actual.to_string().parse::<f64>().unwrap_or(0.0)
        + cantidad_base.to_string().parse::<f64>().unwrap_or(0.0);
    let expected_consumption = mu * dias_vida_util_f;
    let desperdicio_f = (total_stock_base - expected_consumption).max(0.0);

    use rust_decimal::prelude::FromPrimitive;
    let desperdicio = Decimal::from_f64(desperdicio_f)
        .unwrap_or(Decimal::ZERO)
        .round_dp(2);

    let pct = Decimal::from(margen_tolerancia) / Decimal::from(100);
    let limite_tolerancia = cantidad_base * pct;
    let alerta_vencimiento =
        (dias_vida_util < vida_util_minima) || (desperdicio > limite_tolerancia);

    (desperdicio, alerta_vencimiento)
}

pub async fn validar_vencimiento(
    pool: &PgPool,
    input: crate::dto::recepcion::ValidarVencimientoInput,
) -> Result<crate::dto::recepcion::ValidarVencimientoResponse, AppError> {
    let factor = if let Some(pres_id) = input.presentacion_id {
        sqlx::query_scalar::<_, Decimal>(
            "SELECT factor_conversion FROM presentaciones WHERE id = $1 AND activa = true",
        )
        .bind(pres_id)
        .fetch_one(pool)
        .await
        .unwrap_or(Decimal::from(1))
    } else {
        Decimal::from(1)
    };
    let cantidad_base = input.cantidad * factor;

    let stock_actual: Decimal = sqlx::query_scalar::<_, Decimal>(
        "SELECT COALESCE(SUM(s.cantidad), 0.0) FROM stock s JOIN lotes l ON l.id = s.lote_id WHERE l.producto_id = $1"
    )
    .bind(input.producto_id)
    .fetch_one(pool)
    .await?;

    let (alerta_activa, vida_util_minima, margen_tolerancia) =
        load_vencimiento_settings(pool).await?;
    if !alerta_activa {
        return Ok(crate::dto::recepcion::ValidarVencimientoResponse {
            desperdicio_proyectado: Decimal::ZERO,
            alerta_vencimiento: false,
        });
    }

    let today = chrono::Utc::now().naive_utc().date();
    let dias_vida_util = (input.fecha_vencimiento - today).num_days();

    let forecast_cfg = crate::services::stock_service::load_forecast_config(pool).await?;
    let serie_diaria: Vec<f64> = sqlx::query_scalar(
        r#"
        WITH ventana AS (
            SELECT NOW() - ($2::int * INTERVAL '1 day') AS desde
        ),
        dias AS (
            SELECT generate_series(
                (SELECT desde FROM ventana)::date,
                NOW()::date,
                INTERVAL '1 day'
            )::date AS dia
        ),
        consumo_dia AS (
            SELECT
                m.created_at::date AS dia,
                SUM(m.cantidad)::FLOAT8 AS cantidad
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE l.producto_id = $1
              AND m.tipo = 'CONSUMO'
              AND m.created_at >= (SELECT desde FROM ventana)
            GROUP BY m.created_at::date
        )
        SELECT COALESCE(cd.cantidad, 0.0)::FLOAT8
        FROM dias d
        LEFT JOIN consumo_dia cd ON cd.dia = d.dia
        ORDER BY d.dia ASC
        "#,
    )
    .bind(input.producto_id)
    .bind(forecast_cfg.ventana_demanda_dias)
    .fetch_all(pool)
    .await?;

    let forecast_res = crate::services::forecast::compute_forecast(
        &serie_diaria,
        stock_actual.to_string().parse::<f64>().unwrap_or(0.0),
        0.0,
        0,
        forecast_cfg,
    );

    let (desperdicio, alerta_vencimiento) = calcular_alerta_vencimiento_pure(
        dias_vida_util,
        vida_util_minima as i64,
        stock_actual,
        cantidad_base,
        forecast_res.mu,
        margen_tolerancia,
    );

    Ok(crate::dto::recepcion::ValidarVencimientoResponse {
        desperdicio_proyectado: desperdicio,
        alerta_vencimiento,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_calcular_alerta_vencimiento_pure_bajo_riesgo() {
        // Vida útil cómoda (60 días vs 30 mínima) y sin desperdicio proyectado
        let (desperdicio, alerta) = calcular_alerta_vencimiento_pure(
            60,       // dias_vida_util
            30,       // vida_util_minima
            dec!(10), // stock_actual
            dec!(5),  // cantidad_base
            1.0,      // mu (demanda de 1u por día, consumo esperado = 60u)
            10,       // margen_tolerancia_pct
        );

        assert_eq!(desperdicio, Decimal::ZERO);
        assert!(!alerta);
    }

    #[test]
    fn test_calcular_alerta_vencimiento_pure_vida_util_corta() {
        // Vida útil por debajo del mínimo (20 días vs 30 mínima)
        let (_desperdicio, alerta) = calcular_alerta_vencimiento_pure(
            20, // dias_vida_util
            30, // vida_util_minima
            dec!(10),
            dec!(5),
            1.0,
            10,
        );

        assert!(alerta, "Debería alertar porque la vida útil es corta");
    }

    #[test]
    fn test_calcular_alerta_vencimiento_pure_alto_desperdicio() {
        // Vida útil cómoda (50 días), pero consumo esperado es 0 (mu=0).
        // Stock 10 + cantidad 5 = 15. Consumo 0. Desperdicio = 15.
        // Tolerancia = 10% de 5 = 0.5. Desperdicio 15 > 0.5.
        let (desperdicio, alerta) = calcular_alerta_vencimiento_pure(
            50, // dias_vida_util
            30, // vida_util_minima
            dec!(10),
            dec!(5),
            0.0, // mu (sin consumo esperado)
            10,
        );

        assert_eq!(desperdicio, dec!(15));
        assert!(
            alerta,
            "Debería alertar por desperdicio superior a tolerancia"
        );
    }
}

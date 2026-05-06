use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::dto::recepcion::{
    CreateRecepcion, DetalleRecepcionRow, LoteCreado, PaginatedRecepciones, RecepcionListItem,
    RecepcionQuery,
};
use crate::errors::AppError;
use crate::services::stock_ops;

pub async fn listar(
    pool: &PgPool,
    params: RecepcionQuery,
    usuario_id: Uuid,
    rol: &str,
) -> Result<PaginatedRecepciones, AppError> {
    if let Some(aid) = params.area_id {
        stock_ops::validar_acceso_area(pool, usuario_id, aid, rol).await?;
    }

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
        conditions.push(format!("r.estado = ${}", param_idx));
        estado_val = estado.clone();
        param_idx += 1;
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

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        r#"SELECT
            r.id, r.numero_documento, p.nombre as proveedor_nombre, p.icono as proveedor_icono,
            r.guia_despacho, r.estado, r.fecha_recepcion, u.nombre as usuario_nombre,
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
    if params.estado.is_some() {
        query = query.bind(estado_val);
    }
    if params.desde.is_some() {
        query = query.bind(desde_val);
    }
    if params.hasta.is_some() {
        query = query.bind(hasta_val);
    }
    if params.busqueda.is_some() {
        query = query.bind(busqueda_val);
    }
    if params.area_id.is_some() {
        query = query.bind(aid_val);
    }

    let data = query.bind(per_page).bind(offset).fetch_all(pool).await?;

    let total: i32 = sqlx::query_scalar("SELECT COUNT(*)::INT4 FROM recepciones")
        .fetch_one(pool)
        .await?;

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

            let (lote_id, codigo_interno): (Uuid, String) = sqlx::query_as(
                r#"INSERT INTO lotes (producto_id, proveedor_id, numero_lote, fecha_vencimiento, costo_unitario, codigo_interno)
                   VALUES ($1, $2, $3, $4, $5, 'L' || LPAD(nextval('seq_lot_numero')::text, 6, '0'))
                   ON CONFLICT (producto_id, numero_lote)
                   DO UPDATE SET fecha_vencimiento = EXCLUDED.fecha_vencimiento, costo_unitario = EXCLUDED.costo_unitario
                   RETURNING id, codigo_interno"#
            )
            .bind(item.producto_id)
            .bind(req.proveedor_id)
            .bind(&item.numero_lote)
            .bind(item.fecha_vencimiento)
            .bind(item.costo_unitario)
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
                )
                .await?;
            }

            lotes_creados.push(LoteCreado {
                lote_id,
                codigo_interno,
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

    tx.commit().await?;
    Ok((recepcion_id, lotes_creados))
}

#[allow(dead_code)]
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
        )
        .await?;
    }

    sqlx::query("UPDATE recepciones SET estado = 'completa' WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    if let Some(sid) = solicitud_id {
        sqlx::query("UPDATE solicitudes_compra SET estado = 'completada' WHERE id = $1")
            .bind(sid)
            .execute(&mut *tx)
            .await?;
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
            a.nombre as area_destino
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

use crate::dto::lab_campo::{
    CreateLabCampoDefinicion, LabCampoDetalle, UpdateLabCampoDefinicion, UpsertLabCampoValor,
};
use crate::errors::AppError;
use crate::models::lab_campo::LabCampoDefinicion;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn listar_definiciones(pool: &PgPool) -> Result<Vec<LabCampoDefinicion>, AppError> {
    sqlx::query_as::<_, LabCampoDefinicion>(
        "SELECT id, nombre, tipo_dato, opciones_lista, requerido, considerar_filtro, orden, activo, alcance, created_at, updated_at \
         FROM lab_campo_definicion ORDER BY orden, nombre",
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn crear_definicion(
    pool: &PgPool,
    req: CreateLabCampoDefinicion,
) -> Result<LabCampoDefinicion, AppError> {
    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }

    let opciones_json = req
        .opciones_lista
        .map(|opts| serde_json::to_value(opts).unwrap_or(serde_json::Value::Null));
    let alcance = req.alcance.as_deref().unwrap_or("laboratorio");
    if !matches!(alcance, "laboratorio" | "producto") {
        return Err(AppError::Validation(
            "alcance debe ser 'laboratorio' o 'producto'".into(),
        ));
    }

    let def = sqlx::query_as::<_, LabCampoDefinicion>(
        "INSERT INTO lab_campo_definicion (nombre, tipo_dato, opciones_lista, requerido, considerar_filtro, orden, alcance) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, nombre, tipo_dato, opciones_lista, requerido, considerar_filtro, orden, activo, alcance, created_at, updated_at",
    )
    .bind(&nombre)
    .bind(&req.tipo_dato)
    .bind(&opciones_json)
    .bind(req.requerido.unwrap_or(false))
    .bind(req.considerar_filtro.unwrap_or(false))
    .bind(req.orden.unwrap_or(0))
    .bind(alcance)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict(format!("Ya existe un campo con el nombre '{}'", nombre))
        }
        _ => e.into(),
    })?;

    Ok(def)
}

pub async fn actualizar_definicion(
    pool: &PgPool,
    id: Uuid,
    req: UpdateLabCampoDefinicion,
) -> Result<LabCampoDefinicion, AppError> {
    let anterior = sqlx::query_as::<_, LabCampoDefinicion>(
        "SELECT id, nombre, tipo_dato, opciones_lista, requerido, considerar_filtro, orden, activo, alcance, created_at, updated_at \
         FROM lab_campo_definicion WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Campo no encontrado".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let tipo_dato = req.tipo_dato.as_deref().unwrap_or(&anterior.tipo_dato);
    let opciones_json = req
        .opciones_lista
        .map(|opts| serde_json::to_value(opts).unwrap_or(serde_json::Value::Null))
        .or(anterior.opciones_lista);
    let requerido = req.requerido.unwrap_or(anterior.requerido);
    let considerar_filtro = req.considerar_filtro.unwrap_or(anterior.considerar_filtro);
    let orden = req.orden.unwrap_or(anterior.orden);
    let activo = req.activo.unwrap_or(anterior.activo);
    let alcance = req.alcance.as_deref().unwrap_or(&anterior.alcance);
    if !matches!(alcance, "laboratorio" | "producto") {
        return Err(AppError::Validation(
            "alcance debe ser 'laboratorio' o 'producto'".into(),
        ));
    }

    let def = sqlx::query_as::<_, LabCampoDefinicion>(
        "UPDATE lab_campo_definicion \
         SET nombre = $1, tipo_dato = $2, opciones_lista = $3, requerido = $4, considerar_filtro = $5, orden = $6, activo = $7, alcance = $8, updated_at = NOW() \
         WHERE id = $9 \
         RETURNING id, nombre, tipo_dato, opciones_lista, requerido, considerar_filtro, orden, activo, alcance, created_at, updated_at",
    )
    .bind(nombre)
    .bind(tipo_dato)
    .bind(&opciones_json)
    .bind(requerido)
    .bind(considerar_filtro)
    .bind(orden)
    .bind(activo)
    .bind(alcance)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Campo no encontrado".into()))?;

    Ok(def)
}

pub async fn eliminar_definicion(pool: &PgPool, id: Uuid) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM lab_campo_definicion WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Campo no encontrado".into()));
    }

    Ok(())
}

pub async fn obtener_detalles(pool: &PgPool) -> Result<Vec<LabCampoDetalle>, AppError> {
    sqlx::query_as::<_, LabCampoDetalle>(
        "SELECT d.id, d.nombre, d.tipo_dato, d.opciones_lista, d.requerido, d.considerar_filtro, d.orden, d.activo, d.alcance, \
                v.valor_entero, v.valor_booleano, v.valor_fecha, v.valor_texto \
         FROM lab_campo_definicion d \
         LEFT JOIN lab_campo_valor v ON v.definicion_id = d.id \
         WHERE d.activo = true AND d.alcance = 'laboratorio' \
         ORDER BY d.orden, d.nombre",
    )
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn upsert_valores(
    pool: &PgPool,
    valores: Vec<UpsertLabCampoValor>,
) -> Result<(), AppError> {
    for v in valores {
        let valor_fecha_parsed = v
            .valor_fecha
            .as_deref()
            .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        sqlx::query(
            "INSERT INTO lab_campo_valor (definicion_id, valor_entero, valor_booleano, valor_fecha, valor_texto) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (definicion_id) DO UPDATE \
             SET valor_entero = EXCLUDED.valor_entero, valor_booleano = EXCLUDED.valor_booleano, \
                 valor_fecha = EXCLUDED.valor_fecha, valor_texto = EXCLUDED.valor_texto, updated_at = NOW()",
        )
        .bind(v.definicion_id)
        .bind(v.valor_entero)
        .bind(v.valor_booleano)
        .bind(valor_fecha_parsed)
        .bind(v.valor_texto)
        .execute(pool)
        .await?;
    }
    Ok(())
}

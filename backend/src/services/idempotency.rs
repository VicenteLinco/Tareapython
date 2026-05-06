use axum::http::HeaderMap;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;

/// Extrae X-Idempotency-Key del header. Retorna error si no está presente.
/// Valida longitud máxima de 256 caracteres y que contenga solo caracteres seguros.
pub fn extract_idempotency_key(headers: &HeaderMap) -> Result<String, AppError> {
    let key = headers
        .get("X-Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or(AppError::Validation(
            "Header X-Idempotency-Key es requerido".into(),
        ))?;

    if key.is_empty() || key.len() > 256 {
        return Err(AppError::Validation(
            "X-Idempotency-Key debe tener entre 1 y 256 caracteres".into(),
        ));
    }

    if !key
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "X-Idempotency-Key solo acepta caracteres alfanuméricos, guiones y guiones bajos"
                .into(),
        ));
    }

    Ok(key)
}

/// Intenta reclamar la key. Retorna:
/// - Ok(None) si se insertó (este thread ganó, proceder con la operación)
/// - Ok(Some(response)) si ya existía (retornar la respuesta guardada)
pub async fn try_claim(
    pool: &PgPool,
    key: &str,
    endpoint: &str,
    usuario_id: Uuid,
) -> Result<Option<(i16, serde_json::Value)>, AppError> {
    // INSERT ... ON CONFLICT DO NOTHING, luego verificar si se insertó
    let result = sqlx::query(
        r#"INSERT INTO idempotency_keys (key, endpoint, response_status, response_body, usuario_id)
           VALUES ($1, $2, 0, '{}'::jsonb, $3)
           ON CONFLICT (key) DO NOTHING"#,
    )
    .bind(key)
    .bind(endpoint)
    .bind(usuario_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 1 {
        // Este thread ganó
        Ok(None)
    } else {
        // Ya existe, leer la respuesta guardada
        let existing = sqlx::query_as::<_, IdempotencyRow>(
            "SELECT response_status, response_body FROM idempotency_keys WHERE key = $1",
        )
        .bind(key)
        .fetch_one(pool)
        .await?;

        // Si status es 0, otro thread está procesando. Esperar un poco y reintentar.
        if existing.response_status == 0 {
            return Err(AppError::Conflict(
                "Operación en proceso, intente nuevamente".into(),
            ));
        }

        Ok(Some((existing.response_status, existing.response_body)))
    }
}

/// Guarda la respuesta para una key ya reclamada.
pub async fn save_response(
    pool: &PgPool,
    key: &str,
    status: i16,
    body: &serde_json::Value,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3",
    )
    .bind(status)
    .bind(body)
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}

/// Limpia la key si la operación falló (para permitir reintento).
pub async fn cleanup_on_error(pool: &PgPool, key: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM idempotency_keys WHERE key = $1")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
struct IdempotencyRow {
    response_status: i16,
    response_body: serde_json::Value,
}

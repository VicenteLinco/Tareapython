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

/// Valida el formato de una idempotency key según las reglas del extractor.
/// Lógica pura extraída para poder testearla sin DB.
pub fn validate_idempotency_key_format(key: &str) -> Result<(), AppError> {
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Tests de lógica pura (sin DB) ──────────────────────────────────────

    #[test]
    fn idempotency_key_valida_acepta_formato_correcto() {
        assert!(validate_idempotency_key_format("ABC-123_xyz").is_ok());
        assert!(validate_idempotency_key_format("a").is_ok());
        assert!(validate_idempotency_key_format(&"x".repeat(256)).is_ok());
    }

    #[test]
    fn idempotency_key_invalida_rechaza_vacia() {
        let err = validate_idempotency_key_format("").expect_err("vacía debe fallar");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn idempotency_key_invalida_rechaza_demasiado_larga() {
        let err = validate_idempotency_key_format(&"x".repeat(257)).expect_err("demasiado larga");
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn idempotency_key_invalida_rechaza_caracteres_especiales() {
        let err =
            validate_idempotency_key_format("key con espacio").expect_err("espacios no permitidos");
        assert!(matches!(err, AppError::Validation(_)));
        let err2 =
            validate_idempotency_key_format("key@dominio").expect_err("@ no permitida");
        assert!(matches!(err2, AppError::Validation(_)));
    }

    // ─── Tests de integración con DB (requieren DATABASE_URL) ───────────────
    // Marcados con #[ignore] porque necesitan una PgPool real con las migraciones
    // aplicadas. Ejecutar con: cargo test -- --ignored

    /// D6-I1: try_claim con key nueva retorna Ok(None) — el thread gana el claim.
    #[tokio::test]
    #[ignore = "requiere DATABASE_URL y migraciones aplicadas"]
    async fn idempotency_key_nueva_permite_procesar() {
        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL debe estar definida para este test");
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("conectar a DB");

        let key = format!("test-nueva-{}", uuid::Uuid::new_v4().simple());
        let usuario_id = uuid::Uuid::new_v4();

        let result = try_claim(&pool, &key, "/test", usuario_id)
            .await
            .expect("try_claim no debe fallar");

        assert!(result.is_none(), "key nueva debe retornar None (proceder)");

        // Limpiar
        cleanup_on_error(&pool, &key).await.ok();
    }

    /// D6-I2: try_claim + save_response + try_claim de nuevo → retorna la respuesta guardada.
    #[tokio::test]
    #[ignore = "requiere DATABASE_URL y migraciones aplicadas"]
    async fn idempotency_key_reutilizada_despues_de_save() {
        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL debe estar definida para este test");
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("conectar a DB");

        let key = format!("test-reutilizada-{}", uuid::Uuid::new_v4().simple());
        let usuario_id = uuid::Uuid::new_v4();
        let body = serde_json::json!({ "id": "abc123", "status": "ok" });

        // Primer claim — debe ganar
        let first = try_claim(&pool, &key, "/test", usuario_id)
            .await
            .expect("primer claim no debe fallar");
        assert!(first.is_none(), "primer claim debe retornar None");

        // Guardar respuesta
        save_response(&pool, &key, 200, &body)
            .await
            .expect("save_response no debe fallar");

        // Segundo claim — debe retornar la respuesta guardada
        let second = try_claim(&pool, &key, "/test", usuario_id)
            .await
            .expect("segundo claim no debe fallar");
        let (status, saved_body) = second.expect("debe retornar la respuesta guardada");
        assert_eq!(status, 200);
        assert_eq!(saved_body["id"], "abc123");

        // Limpiar
        cleanup_on_error(&pool, &key).await.ok();
    }
}

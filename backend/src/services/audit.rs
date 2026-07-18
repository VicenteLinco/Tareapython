use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::errors::AppError;

/// Inserta una entrada en el audit_log.
/// Llamar dentro de una transacción o directamente según el contexto.
pub async fn registrar(
    pool: &PgPool,
    tabla: &str,
    registro_id: &str,
    accion: &str,
    datos_anteriores: Option<Value>,
    datos_nuevos: Option<Value>,
    usuario_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO audit_log
           (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(tabla)
    .bind(registro_id)
    .bind(accion)
    .bind(datos_anteriores)
    .bind(datos_nuevos)
    .bind(usuario_id)
    .execute(pool)
    .await?;
    Ok(())
}

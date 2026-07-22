use sqlx::PgPool;
use uuid::Uuid;

use crate::dto::notificacion::{NotificacionResponse, UnreadCountResponse};
use crate::dto::pagination::PaginatedResponse;
use crate::errors::AppError;

/// Listar las notificaciones de un usuario de manera paginada.
pub async fn listar(
    pool: &PgPool,
    usuario_id: Uuid,
    page: i64,
    per_page: i64,
) -> Result<PaginatedResponse<NotificacionResponse>, AppError> {
    let offset = (page - 1) * per_page;

    let total: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM notificaciones WHERE usuario_id = $1")
            .bind(usuario_id)
            .fetch_one(pool)
            .await?;

    let rows = sqlx::query_as::<_, NotificacionResponse>(
        r#"SELECT id, usuario_id, titulo, mensaje, tipo, leido, created_at
           FROM notificaciones
           WHERE usuario_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3"#,
    )
    .bind(usuario_id)
    .bind(per_page)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(PaginatedResponse::new(rows, total, page, per_page))
}

/// Obtener el conteo de notificaciones no leídas para un usuario.
pub async fn obtener_conteo_no_leidas(
    pool: &PgPool,
    usuario_id: Uuid,
) -> Result<UnreadCountResponse, AppError> {
    let count: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notificaciones WHERE usuario_id = $1 AND leido = false",
    )
    .bind(usuario_id)
    .fetch_one(pool)
    .await?;

    Ok(UnreadCountResponse {
        conteo: count as i32,
    })
}

/// Marcar una notificación específica como leída.
pub async fn marcar_leida(
    pool: &PgPool,
    usuario_id: Uuid,
    notificacion_id: Uuid,
) -> Result<(), AppError> {
    let rows_affected =
        sqlx::query("UPDATE notificaciones SET leido = true WHERE id = $1 AND usuario_id = $2")
            .bind(notificacion_id)
            .bind(usuario_id)
            .execute(pool)
            .await?
            .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound("Notificación no encontrada".to_string()));
    }

    Ok(())
}

/// Marcar todas las notificaciones de un usuario como leídas.
pub async fn marcar_todas_leidas(pool: &PgPool, usuario_id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE notificaciones SET leido = true WHERE usuario_id = $1 AND leido = false")
        .bind(usuario_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Eliminar/Limpiar todas las notificaciones de un usuario.
pub async fn eliminar_todas(pool: &PgPool, usuario_id: Uuid) -> Result<(), AppError> {
    sqlx::query("DELETE FROM notificaciones WHERE usuario_id = $1")
        .bind(usuario_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Crear una notificación para un usuario específico.
pub async fn crear(
    pool: &PgPool,
    usuario_id: Uuid,
    titulo: &str,
    mensaje: &str,
    tipo: &str,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO notificaciones (id, usuario_id, titulo, mensaje, tipo)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(usuario_id)
    .bind(titulo)
    .bind(mensaje)
    .bind(tipo)
    .execute(pool)
    .await?;

    Ok(id)
}

/// Crear una notificación para todos los administradores (fan-out).
pub async fn crear_para_admins(
    pool: &PgPool,
    titulo: &str,
    mensaje: &str,
    tipo: &str,
) -> Result<(), AppError> {
    let admins: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM usuarios WHERE rol = 'admin' AND deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await?;

    for admin_id in admins {
        crear(pool, admin_id, titulo, mensaje, tipo).await?;
    }

    Ok(())
}

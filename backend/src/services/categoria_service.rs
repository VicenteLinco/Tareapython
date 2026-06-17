use crate::dto::categoria::{CreateCategoria, UpdateCategoria};
use crate::errors::AppError;
use crate::models::categoria::Categoria;
use crate::domain::CategoriaRepository;
use crate::persistence::SqlxCategoriaRepository;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

pub async fn listar(pool: &PgPool) -> Result<Vec<Categoria>, AppError> {
    let repo = SqlxCategoriaRepository::new(pool.clone());
    repo.listar().await
}

pub async fn crear(
    pool: &PgPool,
    req: CreateCategoria,
    usuario_id: Uuid,
) -> Result<Categoria, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();

    let repo = SqlxCategoriaRepository::new(pool.clone());
    let existente = repo.buscar_por_nombre(&nombre).await?;

    if let Some((_, true)) = existente {
        return Err(AppError::Conflict(format!(
            "La categoría '{}' ya existe",
            nombre
        )));
    }

    let categoria = if let Some((id, false)) = existente {
        repo.reactivar_y_describir(id, req.descripcion.as_deref()).await?
    } else {
        repo.insertar(&nombre, req.descripcion.as_deref()).await?
    };

    crate::services::audit::registrar(
        pool,
        "categorias",
        &categoria.id.to_string(),
        "CREATE",
        None,
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        usuario_id,
    )
    .await?;

    Ok(categoria)
}

pub async fn actualizar(
    pool: &PgPool,
    id: i32,
    req: UpdateCategoria,
    usuario_id: Uuid,
) -> Result<Categoria, AppError> {
    req.validate()?;

    let repo = SqlxCategoriaRepository::new(pool.clone());
    let anterior = repo
        .buscar_por_id(id)
        .await?
        .ok_or(AppError::NotFound("Categoría no encontrada".into()))?;

    let nombre = req
        .nombre
        .as_deref()
        .map(str::trim)
        .unwrap_or(&anterior.nombre);
    let descripcion = req
        .descripcion
        .as_deref()
        .or(anterior.descripcion.as_deref());

    let categoria = repo.actualizar(id, nombre, descripcion, req.version).await?;

    crate::services::audit::registrar(
        pool,
        "categorias",
        &id.to_string(),
        "UPDATE",
        Some(json!({"nombre": &anterior.nombre, "descripcion": &anterior.descripcion})),
        Some(json!({"nombre": &categoria.nombre, "descripcion": &categoria.descripcion})),
        usuario_id,
    )
    .await?;

    Ok(categoria)
}

pub async fn eliminar(pool: &PgPool, id: i32, usuario_id: Uuid) -> Result<(), AppError> {
    let repo = SqlxCategoriaRepository::new(pool.clone());
    let deleted = repo.eliminar(id).await?;

    if !deleted {
        return Err(AppError::NotFound(
            "Categoría no encontrada o ya inactiva".into(),
        ));
    }

    crate::services::audit::registrar(
        pool,
        "categorias",
        &id.to_string(),
        "DELETE",
        None,
        None,
        usuario_id,
    )
    .await?;

    Ok(())
}


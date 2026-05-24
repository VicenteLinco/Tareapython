use std::path::{Component, PathBuf};

use axum::body::Body;
use axum::extract::Path;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::Response;

use crate::errors::AppError;

fn safe_upload_path(path: &str) -> Result<PathBuf, AppError> {
    if path.is_empty() {
        return Err(AppError::NotFound("Archivo no encontrado".into()));
    }

    let relative = PathBuf::from(path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(AppError::Forbidden("Ruta de archivo invalida".into()));
    }

    Ok(PathBuf::from("uploads").join(relative))
}

fn content_type_for(path: &str) -> &'static str {
    if path.ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    }
}

async fn obtener(Path(path): Path<String>) -> Result<Response, AppError> {
    let full_path = safe_upload_path(&path)?;
    let bytes = tokio::fs::read(&full_path)
        .await
        .map_err(|_| AppError::NotFound("Archivo no encontrado".into()))?;

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(&path)),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok(response)
}

pub fn routes() -> axum::Router<crate::db::AppState> {
    axum::Router::new().route("/{*path}", axum::routing::get(obtener))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_upload_path_acepta_rutas_relativas_normales() {
        let path = safe_upload_path("recepciones/foto.jpg").expect("ruta valida");
        assert!(path.ends_with(PathBuf::from("uploads").join("recepciones").join("foto.jpg")));
    }

    #[test]
    fn safe_upload_path_rechaza_traversal() {
        assert!(safe_upload_path("../secret.txt").is_err());
        assert!(safe_upload_path("recepciones/../../secret.txt").is_err());
    }
}

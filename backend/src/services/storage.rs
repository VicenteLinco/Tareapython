use base64::Engine;
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

use crate::errors::AppError;

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024; // 5 MB

fn validar_magic_bytes(bytes: &[u8], extension: &str) -> bool {
    match extension {
        "jpg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "png" => bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        _ => false,
    }
}

pub async fn save_base64_image(
    data_url: &str,
    directory: &str,
    prefix: &str,
) -> Result<String, AppError> {
    // 1. Validar y limpiar el data URL
    let base64_part = data_url
        .split(',')
        .nth(1)
        .ok_or_else(|| AppError::Validation("Formato de imagen inválido".into()))?;

    // Determinar la extensión (basada en el mime type del data_url)
    let extension =
        if data_url.starts_with("data:image/jpeg") || data_url.starts_with("data:image/jpg") {
            "jpg"
        } else if data_url.starts_with("data:image/png") {
            "png"
        } else {
            return Err(AppError::Validation("Solo se aceptan JPEG o PNG".into()));
        };

    // 2. Decodificar base64
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_part)
        .map_err(|_| AppError::Validation("Imagen corrupta o inválida".into()))?;

    // 3. Límite de tamaño (5 MB)
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Validation(
            "La imagen no puede superar 5 MB".into(),
        ));
    }

    // 4. Validar magic bytes (evitar spoofing de extensión)
    if !validar_magic_bytes(&bytes, extension) {
        return Err(AppError::Validation(
            "El contenido del archivo no corresponde al tipo declarado".into(),
        ));
    }

    // 5. Crear el nombre del archivo único
    let filename = format!("{}_{}.{}", prefix, Uuid::new_v4(), extension);

    // 6. Asegurar que el directorio existe
    let upload_dir = PathBuf::from("uploads").join(directory);
    if !upload_dir.exists() {
        fs::create_dir_all(&upload_dir).await.map_err(|e| {
            AppError::Internal(format!("Error creando directorio de subida: {}", e))
        })?;
    }

    let file_path = upload_dir.join(&filename);

    // 7. Escribir el archivo en disco
    fs::write(&file_path, bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Error guardando archivo en disco: {}", e)))?;

    // Retornamos la ruta relativa para guardar en la base de datos
    Ok(format!("{}/{}", directory, filename))
}

pub async fn save_image_bytes(
    bytes: &[u8],
    content_type: Option<&str>,
    directory: &str,
    prefix: &str,
) -> Result<String, AppError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Validation(
            "La imagen no puede superar 5 MB".into(),
        ));
    }

    let extension = match content_type {
        Some("image/jpeg") | Some("image/jpg") => "jpg",
        Some("image/png") => "png",
        _ => {
            return Err(AppError::Validation("Solo se aceptan JPEG o PNG".into()));
        }
    };

    if !validar_magic_bytes(bytes, extension) {
        return Err(AppError::Validation(
            "El contenido del archivo no corresponde al tipo declarado".into(),
        ));
    }

    let filename = format!("{}_{}.{}", prefix, Uuid::new_v4(), extension);
    let upload_dir = PathBuf::from("uploads").join(directory);
    if !upload_dir.exists() {
        fs::create_dir_all(&upload_dir).await.map_err(|e| {
            AppError::Internal(format!("Error creando directorio de subida: {}", e))
        })?;
    }

    let file_path = upload_dir.join(&filename);
    fs::write(&file_path, bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Error guardando archivo en disco: {}", e)))?;

    Ok(format!("{}/{}", directory, filename))
}

pub async fn delete_image(path: &str) -> Result<(), AppError> {
    let full_path = PathBuf::from("uploads").join(path);
    if full_path.exists() {
        fs::remove_file(full_path)
            .await
            .map_err(|e| AppError::Internal(format!("Error eliminando archivo: {}", e)))?;
    }
    Ok(())
}

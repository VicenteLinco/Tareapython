use axum::extract::State;
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;

#[derive(Debug, Serialize)]
struct Configuracion {
    nombre_laboratorio: String,
    logo_base64: String,
}

#[derive(Debug, Deserialize)]
struct UpdateConfiguracion {
    nombre_laboratorio: Option<String>,
    logo_base64: Option<String>,
}

/// GET /api/v1/configuracion — Obtener configuración del sistema
async fn obtener(
    State(state): State<AppState>,
) -> Result<Json<Configuracion>, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor FROM configuracion WHERE clave IN ('nombre_laboratorio', 'logo_base64')",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut logo_base64 = String::new();

    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "logo_base64" => logo_base64 = valor,
            _ => {}
        }
    }

    Ok(Json(Configuracion { nombre_laboratorio, logo_base64 }))
}

/// PUT /api/v1/configuracion — Actualizar configuración (solo admin)
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateConfiguracion>,
) -> Result<Json<Configuracion>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if let Some(nombre) = &body.nombre_laboratorio {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor) VALUES ('nombre_laboratorio', $1)
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
        )
        .bind(nombre)
        .execute(&state.pool)
        .await?;
    }

    if let Some(logo) = &body.logo_base64 {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor) VALUES ('logo_base64', $1)
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor",
        )
        .bind(logo)
        .execute(&state.pool)
        .await?;
    }

    obtener(State(state)).await
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(obtener).put(actualizar))
}

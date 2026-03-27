use axum::extract::State;
use axum::routing::get;
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::models::Claims;
use crate::db::AppState;
use crate::errors::AppError;

// What GET /configuracion returns
#[derive(Debug, Serialize)]
struct ConfiguracionResponse {
    nombre_laboratorio: String,
    logo_base64: String,
    pin_kiosko: String,
}

#[derive(Debug, Deserialize)]
struct UpdateConfiguracion {
    nombre_laboratorio: Option<String>,
    logo_base64: Option<String>,
    pin_kiosko: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VerificarPinInput {
    pin: String,
}

/// GET /api/v1/configuracion — Obtener configuración del sistema
async fn obtener(
    State(state): State<AppState>,
) -> Result<Json<ConfiguracionResponse>, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN ('nombre_laboratorio', 'logo_base64', 'pin_kiosko')",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut logo_base64 = String::new();
    let mut pin_kiosko = String::new();

    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "logo_base64" => logo_base64 = valor,
            "pin_kiosko" => pin_kiosko = valor,
            _ => {}
        }
    }

    Ok(Json(ConfiguracionResponse { nombre_laboratorio, logo_base64, pin_kiosko }))
}

/// PUT /api/v1/configuracion — Actualizar configuración (solo admin)
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateConfiguracion>,
) -> Result<Json<ConfiguracionResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    if let Some(nombre) = &body.nombre_laboratorio {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('nombre_laboratorio', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(nombre)
        .execute(&state.pool)
        .await?;
    }

    if let Some(logo) = &body.logo_base64 {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('logo_base64', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(logo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(pin) = &body.pin_kiosko {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('pin_kiosko', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(pin)
        .execute(&state.pool)
        .await?;
    }

    obtener(State(state)).await
}

/// POST /api/v1/configuracion/verificar-pin
/// Verifica el PIN de salida de modo kiosko/QR. No requiere auth.
/// (Intranet only — rate limiting not needed for this deployment)
async fn verificar_pin(
    State(state): State<AppState>,
    Json(body): Json<VerificarPinInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT valor_texto FROM configuracion WHERE clave = 'pin_kiosko'",
    )
    .fetch_optional(&state.pool)
    .await?;

    // Si no hay PIN configurado, siempre válido (setup inicial)
    let valido = match stored.as_deref() {
        None | Some("") => true,
        Some(pin) => pin == body.pin.trim(),
    };

    Ok(Json(serde_json::json!({ "valido": valido })))
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(obtener).put(actualizar))
        .route("/verificar-pin", axum::routing::post(verificar_pin))
}

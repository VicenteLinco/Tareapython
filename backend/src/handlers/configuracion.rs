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
    conteo_ciego: bool,
    dias_autonomia_objetivo: i32,
    lead_time_default: i32,
    moneda_codigo: String,
    moneda_simbolo: String,
    conteo_periodo_dias: i32,
}

#[derive(Debug, Deserialize)]
struct UpdateConfiguracion {
    nombre_laboratorio: Option<String>,
    logo_base64: Option<String>,
    pin_kiosko: Option<String>,
    conteo_ciego: Option<bool>,
    dias_autonomia_objetivo: Option<i32>,
    lead_time_default: Option<i32>,
    moneda_codigo: Option<String>,
    moneda_simbolo: Option<String>,
    conteo_periodo_dias: Option<i32>,
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
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN (
            'nombre_laboratorio','logo_base64','pin_kiosko','conteo_ciego',
            'dias_autonomia_objetivo','lead_time_default',
            'moneda_codigo','moneda_simbolo','conteo_periodo_dias'
        )",
    )
    .fetch_all(&state.pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut logo_base64 = String::new();
    let mut pin_kiosko = String::new();
    let mut conteo_ciego = false;
    let mut dias_autonomia_objetivo = 15;
    let mut lead_time_default = 3;
    let mut moneda_codigo = "CLP".to_string();
    let mut moneda_simbolo = "$".to_string();
    let mut conteo_periodo_dias = 30;

    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "logo_base64" => logo_base64 = valor,
            "pin_kiosko" => pin_kiosko = valor,
            "conteo_ciego" => conteo_ciego = valor == "true",
            "dias_autonomia_objetivo" => dias_autonomia_objetivo = valor.parse().unwrap_or(15),
            "lead_time_default" => lead_time_default = valor.parse().unwrap_or(3),
            "moneda_codigo" => moneda_codigo = valor,
            "moneda_simbolo" => moneda_simbolo = valor,
            "conteo_periodo_dias" => conteo_periodo_dias = valor.parse().unwrap_or(30),
            _ => {}
        }
    }

    Ok(Json(ConfiguracionResponse {
        nombre_laboratorio,
        logo_base64,
        pin_kiosko,
        conteo_ciego,
        dias_autonomia_objetivo,
        lead_time_default,
        moneda_codigo,
        moneda_simbolo,
        conteo_periodo_dias,
    }))
}

/// PUT /api/v1/configuracion — Actualizar configuración (solo admin)
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateConfiguracion>,
) -> Result<Json<ConfiguracionResponse>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let mut log_changes = Vec::new();

    if let Some(nombre) = &body.nombre_laboratorio {
        let ant: Option<String> = sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = 'nombre_laboratorio'").fetch_optional(&state.pool).await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('nombre_laboratorio', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(nombre)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(nombre) {
            log_changes.push(("nombre_laboratorio", ant.unwrap_or_default(), nombre.clone()));
        }
    }

    if let Some(logo) = &body.logo_base64 {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('logo_base64', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(logo)
        .execute(&state.pool)
        .await?;
        log_changes.push(("logo_base64", "old_logo".to_string(), "new_logo".to_string()));
    }

    if let Some(pin) = &body.pin_kiosko {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('pin_kiosko', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(pin)
        .execute(&state.pool)
        .await?;
        log_changes.push(("pin_kiosko", "***".to_string(), "***".to_string()));
    }

    if let Some(ciego) = body.conteo_ciego {
        let val = if ciego { "true" } else { "false" };
        let ant: Option<String> = sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = 'conteo_ciego'").fetch_optional(&state.pool).await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_ciego', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(val)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(val) {
            log_changes.push(("conteo_ciego", ant.unwrap_or_else(|| "false".to_string()), val.to_string()));
        }
    }

    if let Some(dias) = body.dias_autonomia_objetivo {
        let val = dias.to_string();
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('dias_autonomia_objetivo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
        log_changes.push(("dias_autonomia_objetivo", "old".to_string(), val));
    }

    if let Some(lead) = body.lead_time_default {
        let val = lead.to_string();
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('lead_time_default', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
        log_changes.push(("lead_time_default", "old".to_string(), val));
    }

    if let Some(codigo) = &body.moneda_codigo {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_codigo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(codigo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(simbolo) = &body.moneda_simbolo {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('moneda_simbolo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(simbolo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(periodo) = body.conteo_periodo_dias {
        let val = periodo.to_string();
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_periodo_dias', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
    }

    for (clave, ant, nuev) in log_changes {
        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id)
             VALUES ('configuracion', $1, 'UPDATE', $2, $3, $4)"
        )
        .bind(clave)
        .bind(serde_json::json!({"valor": ant}))
        .bind(serde_json::json!({"valor": nuev}))
        .bind(claims.sub)
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

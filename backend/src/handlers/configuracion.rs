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
    ventana_consumo_dias: i32,
    periodo_revision_dias: i32,
    factor_historial_corto: f64,
    ia_proveedor: String,
    ia_modelo: String,
    ia_api_url: String,
    ia_api_key: String,
    whatsapp_api_url: String,
    whatsapp_api_key: String,
    whatsapp_webhook_secret: String,
    whatsapp_bot_phone: String,
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
    ventana_consumo_dias: Option<i32>,
    periodo_revision_dias: Option<i32>,
    factor_historial_corto: Option<f64>,
    ia_proveedor: Option<String>,
    ia_modelo: Option<String>,
    ia_api_url: Option<String>,
    ia_api_key: Option<String>,
    whatsapp_api_url: Option<String>,
    whatsapp_api_key: Option<String>,
    whatsapp_webhook_secret: Option<String>,
    whatsapp_bot_phone: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VerificarPinInput {
    pin: String,
}

/// GET /api/v1/configuracion — Obtener configuración del sistema
async fn obtener(State(state): State<AppState>) -> Result<Json<ConfiguracionResponse>, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN (
            'nombre_laboratorio','logo_base64','pin_kiosko','conteo_ciego',
            'dias_autonomia_objetivo','lead_time_default',
            'moneda_codigo','moneda_simbolo','conteo_periodo_dias',
            'ventana_consumo_dias','periodo_revision_dias','factor_historial_corto',
            'ia_proveedor','ia_modelo','ia_api_url','ia_api_key',
            'whatsapp_api_url','whatsapp_api_key','whatsapp_webhook_secret','whatsapp_bot_phone'
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
    let mut ventana_consumo_dias = 30;
    let mut periodo_revision_dias = 30;
    let mut factor_historial_corto = 0.35;
    let mut ia_proveedor = "gemini".to_string();
    let mut ia_modelo = "gemini-1.5-flash".to_string();
    let mut ia_api_url = String::new();
    let mut ia_api_key = String::new();
    let mut whatsapp_api_url = String::new();
    let mut whatsapp_api_key = String::new();
    let mut whatsapp_webhook_secret = String::new();
    let mut whatsapp_bot_phone = String::new();

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
            "ventana_consumo_dias" => ventana_consumo_dias = valor.parse().unwrap_or(30),
            "periodo_revision_dias" => periodo_revision_dias = valor.parse().unwrap_or(30),
            "factor_historial_corto" => {
                factor_historial_corto = valor.parse::<f64>().unwrap_or(0.35).clamp(0.0, 1.0)
            }
            "ia_proveedor" => ia_proveedor = valor,
            "ia_modelo" => ia_modelo = valor,
            "ia_api_url" => ia_api_url = valor,
            "ia_api_key" => {
                ia_api_key = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "whatsapp_api_url" => whatsapp_api_url = valor,
            "whatsapp_api_key" => {
                whatsapp_api_key = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "whatsapp_webhook_secret" => whatsapp_webhook_secret = valor,
            "whatsapp_bot_phone" => whatsapp_bot_phone = valor,
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
        ventana_consumo_dias,
        periodo_revision_dias,
        factor_historial_corto,
        ia_proveedor,
        ia_modelo,
        ia_api_url,
        ia_api_key,
        whatsapp_api_url,
        whatsapp_api_key,
        whatsapp_webhook_secret,
        whatsapp_bot_phone,
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
        let ant: Option<String> = sqlx::query_scalar(
            "SELECT valor_texto FROM configuracion WHERE clave = 'nombre_laboratorio'",
        )
        .fetch_optional(&state.pool)
        .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('nombre_laboratorio', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(nombre)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(nombre) {
            log_changes.push((
                "nombre_laboratorio",
                ant.unwrap_or_default(),
                nombre.clone(),
            ));
        }
    }

    if let Some(logo) = &body.logo_base64 {
        let ant_logo: Option<String> =
            sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = 'logo_base64'")
                .fetch_optional(&state.pool)
                .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('logo_base64', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(logo)
        .execute(&state.pool)
        .await?;
        let tenia_logo_antes = ant_logo.as_deref().map(|v| !v.is_empty()).unwrap_or(false);
        let tiene_logo_ahora = !logo.is_empty();
        if tenia_logo_antes != tiene_logo_ahora || !tenia_logo_antes {
            log_changes.push((
                "logo_base64",
                if tenia_logo_antes {
                    "logo_presente".to_string()
                } else {
                    "sin_logo".to_string()
                },
                if tiene_logo_ahora {
                    "logo_actualizado".to_string()
                } else {
                    "logo_eliminado".to_string()
                },
            ));
        }
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
        let ant: Option<String> = sqlx::query_scalar(
            "SELECT valor_texto FROM configuracion WHERE clave = 'conteo_ciego'",
        )
        .fetch_optional(&state.pool)
        .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('conteo_ciego', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(val)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(val) {
            log_changes.push((
                "conteo_ciego",
                ant.unwrap_or_else(|| "false".to_string()),
                val.to_string(),
            ));
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

    if let Some(ventana) = body.ventana_consumo_dias {
        let val = ventana.to_string();
        let ant: Option<String> = sqlx::query_scalar(
            "SELECT valor_texto FROM configuracion WHERE clave = 'ventana_consumo_dias'",
        )
        .fetch_optional(&state.pool)
        .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('ventana_consumo_dias', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "ventana_consumo_dias",
                ant.unwrap_or_else(|| "30".to_string()),
                val,
            ));
        }
    }

    if let Some(revision) = body.periodo_revision_dias {
        let val = revision.to_string();
        let ant: Option<String> = sqlx::query_scalar(
            "SELECT valor_texto FROM configuracion WHERE clave = 'periodo_revision_dias'",
        )
        .fetch_optional(&state.pool)
        .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('periodo_revision_dias', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "periodo_revision_dias",
                ant.unwrap_or_else(|| "30".to_string()),
                val,
            ));
        }
    }

    if let Some(factor) = body.factor_historial_corto {
        let factor = factor.clamp(0.0, 1.0);
        let val = format!("{:.4}", factor);
        let ant: Option<String> = sqlx::query_scalar(
            "SELECT valor_texto FROM configuracion WHERE clave = 'factor_historial_corto'",
        )
        .fetch_optional(&state.pool)
        .await?;
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('factor_historial_corto', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(&val)
        .execute(&state.pool)
        .await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "factor_historial_corto",
                ant.unwrap_or_else(|| "0.35".to_string()),
                val,
            ));
        }
    }

    if let Some(proveedor) = &body.ia_proveedor {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('ia_proveedor', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(proveedor)
        .execute(&state.pool)
        .await?;
    }

    if let Some(modelo) = &body.ia_modelo {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('ia_modelo', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(modelo)
        .execute(&state.pool)
        .await?;
    }

    if let Some(api_url) = &body.ia_api_url {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('ia_api_url', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(api_url)
        .execute(&state.pool)
        .await?;
    }

    if let Some(api_key) = &body.ia_api_key {
        if api_key != "***" {
            sqlx::query(
                "INSERT INTO configuracion (clave, valor_texto) VALUES ('ia_api_key', $1)
                 ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
            )
            .bind(api_key)
            .execute(&state.pool)
            .await?;
            log_changes.push(("ia_api_key", "***".to_string(), "***".to_string()));
        }
    }

    if let Some(wa_url) = &body.whatsapp_api_url {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('whatsapp_api_url', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(wa_url)
        .execute(&state.pool)
        .await?;
    }

    if let Some(wa_key) = &body.whatsapp_api_key {
        if wa_key != "***" {
            sqlx::query(
                "INSERT INTO configuracion (clave, valor_texto) VALUES ('whatsapp_api_key', $1)
                 ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
            )
            .bind(wa_key)
            .execute(&state.pool)
            .await?;
            log_changes.push(("whatsapp_api_key", "***".to_string(), "***".to_string()));
        }
    }

    if let Some(secret) = &body.whatsapp_webhook_secret {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('whatsapp_webhook_secret', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(secret)
        .execute(&state.pool)
        .await?;
    }

    if let Some(phone) = &body.whatsapp_bot_phone {
        sqlx::query(
            "INSERT INTO configuracion (clave, valor_texto) VALUES ('whatsapp_bot_phone', $1)
             ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
        )
        .bind(phone)
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
    let stored: Option<String> =
        sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = 'pin_kiosko'")
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

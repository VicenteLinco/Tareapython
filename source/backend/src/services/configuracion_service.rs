//! Acceso a datos y reglas de negocio de la configuración del sistema.
//!
//! Fachada sobre la tabla `configuracion` (clave/valor). Los handlers solo
//! parsean el request, verifican el rol y arman la respuesta; el SQL y las
//! reglas (enmascarado de secretos, audit log) viven acá.

use sqlx::PgPool;
use uuid::Uuid;

use crate::dto::configuracion::{BrandingResponse, ConfiguracionResponse, UpdateConfiguracion};
use crate::errors::AppError;

/// Regex simple para validar hex colors: `#` seguido de 6 hex digits.
fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod configured_model_secret_tests {
    use super::{mask_configured_model_secrets, merge_configured_model_secrets};

    #[test]
    fn configured_model_secrets_are_masked_and_preserved_on_save() {
        let stored = r#"[{"id":"vision-a","name":"Visión","provider":"openai","model":"gpt-4o-mini","api_url":"https://example.test","api_key":"secret"}]"#;
        let masked = mask_configured_model_secrets(stored);
        assert!(!masked.contains("secret"));
        assert!(masked.contains(r#""api_key":"***""#));

        let merged = merge_configured_model_secrets(&masked, stored)
            .expect("masked save should preserve secret");
        assert!(merged.contains(r#""api_key":"secret""#));
    }

    #[test]
    fn persistence_trims_ids_and_rejects_empty_or_normalized_duplicates() {
        let normalized =
            merge_configured_model_secrets(r#"[{"id":" vision-a ","api_key":"new"}]"#, "[]")
                .expect("whitespace should be canonicalized");
        assert!(normalized.contains(r#""id":"vision-a""#));

        for invalid in [
            r#"[{"id":"   "}]"#,
            r#"[{"id":"vision-a"},{"id":" vision-a "}]"#,
        ] {
            assert!(merge_configured_model_secrets(invalid, "[]").is_err());
        }
    }
}

fn mask_configured_model_secrets(raw: &str) -> String {
    let Ok(mut models) = serde_json::from_str::<Vec<serde_json::Value>>(raw) else {
        return "[]".to_string();
    };
    if models.iter().any(|model| !model.is_object()) {
        return "[]".to_string();
    }
    for model in &mut models {
        if let Some(object) = model.as_object_mut() {
            let has_secret = object
                .get("api_key")
                .and_then(|value| value.as_str())
                .is_some_and(|value| !value.is_empty());
            object.insert(
                "api_key".to_string(),
                serde_json::Value::String(if has_secret { "***" } else { "" }.to_string()),
            );
        }
    }
    serde_json::to_string(&models).unwrap_or_else(|_| "[]".to_string())
}

fn merge_configured_model_secrets(incoming: &str, existing: &str) -> Result<String, AppError> {
    let mut incoming_models: Vec<serde_json::Value> =
        serde_json::from_str(incoming).map_err(|_| {
            AppError::Validation("La lista de modelos de IA no contiene JSON válido.".to_string())
        })?;
    let existing_models: Vec<serde_json::Value> =
        serde_json::from_str(existing).unwrap_or_default();
    let mut seen_ids = std::collections::HashSet::new();

    for model in &mut incoming_models {
        let Some(object) = model.as_object_mut() else {
            return Err(AppError::Validation(
                "La lista de modelos de IA contiene una entrada inválida.".to_string(),
            ));
        };
        let id = object
            .get("id")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Validation("Un modelo de IA no tiene ID válido.".to_string()))?
            .to_string();
        if !seen_ids.insert(id.clone()) {
            return Err(AppError::Validation(
                "La lista de modelos de IA contiene IDs duplicados.".to_string(),
            ));
        }
        object.insert("id".to_string(), serde_json::Value::String(id.clone()));
        let submitted_secret = object.get("api_key").and_then(|value| value.as_str());
        if submitted_secret.is_none() || submitted_secret == Some("***") {
            let previous_secret = existing_models.iter().find_map(|previous| {
                let previous = previous.as_object()?;
                (previous.get("id")?.as_str()?.trim() == id)
                    .then(|| previous.get("api_key")?.as_str().map(str::to_string))
                    .flatten()
            });
            object.insert(
                "api_key".to_string(),
                serde_json::Value::String(previous_secret.unwrap_or_default()),
            );
        }
    }

    serde_json::to_string(&incoming_models).map_err(|_| {
        AppError::Validation("No se pudo guardar la lista de modelos de IA.".to_string())
    })
}

/// Upsert de una clave de configuración.
async fn set_config(pool: &PgPool, clave: &str, valor: &str) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO configuracion (clave, valor_texto) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto",
    )
    .bind(clave)
    .bind(valor)
    .execute(pool)
    .await?;
    Ok(())
}

async fn get_config(pool: &PgPool, clave: &str) -> Result<Option<String>, AppError> {
    sqlx::query_scalar("SELECT valor_texto FROM configuracion WHERE clave = $1")
        .bind(clave)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Lee la configuración completa para la vista de admin. Los secretos
/// (`*_api_key`) se devuelven enmascarados como `***` cuando tienen valor.
pub async fn obtener(pool: &PgPool) -> Result<ConfiguracionResponse, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN (
            'nombre_laboratorio','logo_base64','login_imagen_base64','pin_kiosko','conteo_ciego',
            'dias_autonomia_objetivo','lead_time_default',
            'moneda_codigo','moneda_simbolo','conteo_periodo_dias',
            'ventana_demanda_dias','periodo_revision_dias','factor_historial_corto',
            'ia_proveedor','ia_modelo','ia_api_url','ia_api_key',
            'ia_api_key_gemini','ia_api_key_openai','ia_api_key_deepseek','ia_api_key_github',
            'ia_api_url_openai','ia_api_url_deepseek','ia_api_url_github','ia_api_url_ollama',
            'ia_api_key_groq','ia_api_key_mistral','ia_api_url_groq','ia_api_url_mistral',
            'ia_modelos_configurados',
            'vencimiento_alerta_activa','vencimiento_vida_util_minima_dias','vencimiento_margen_tolerancia_pct',
            'quarantine_default',
            'favicon_base64','login_bg_color'
        )",
    )
    .fetch_all(pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut logo_base64 = String::new();
    let mut login_imagen_base64 = String::new();
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
    let mut ia_modelo = "gemini-2.0-flash".to_string();
    let mut ia_api_url = String::new();
    let mut ia_api_key = String::new();
    let mut ia_api_key_gemini = String::new();
    let mut ia_api_key_openai = String::new();
    let mut ia_api_key_deepseek = String::new();
    let mut ia_api_key_github = String::new();
    let mut ia_api_url_openai = String::new();
    let mut ia_api_url_deepseek = String::new();
    let mut ia_api_url_github = String::new();
    let mut ia_api_url_ollama = String::new();
    let mut ia_api_key_groq = String::new();
    let mut ia_api_key_mistral = String::new();
    let mut ia_api_url_groq = String::new();
    let mut ia_api_url_mistral = String::new();
    let mut ia_modelos_configurados = String::new();
    let mut vencimiento_alerta_activa = true;
    let mut vencimiento_vida_util_minima_dias = 30;
    let mut vencimiento_margen_tolerancia_pct = 10;
    let mut quarantine_default = true;
    let mut favicon_base64: Option<String> = None;
    let mut login_bg_color: Option<String> = None;

    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "logo_base64" => logo_base64 = valor,
            "login_imagen_base64" => login_imagen_base64 = valor,
            "pin_kiosko" => pin_kiosko = valor,
            "conteo_ciego" => conteo_ciego = valor == "true",
            "dias_autonomia_objetivo" => dias_autonomia_objetivo = valor.parse().unwrap_or(15),
            "lead_time_default" => lead_time_default = valor.parse().unwrap_or(3),
            "moneda_codigo" => moneda_codigo = valor,
            "moneda_simbolo" => moneda_simbolo = valor,
            "conteo_periodo_dias" => conteo_periodo_dias = valor.parse().unwrap_or(30),
            "ventana_demanda_dias" => ventana_consumo_dias = valor.parse().unwrap_or(30),
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
            "ia_api_key_gemini" => {
                ia_api_key_gemini = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_key_openai" => {
                ia_api_key_openai = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_key_deepseek" => {
                ia_api_key_deepseek = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_url_openai" => ia_api_url_openai = valor,
            "ia_api_url_deepseek" => ia_api_url_deepseek = valor,
            "ia_api_url_github" => ia_api_url_github = valor,
            "ia_api_url_ollama" => ia_api_url_ollama = valor,
            "ia_api_key_github" => {
                ia_api_key_github = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_key_groq" => {
                ia_api_key_groq = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_key_mistral" => {
                ia_api_key_mistral = if valor.is_empty() {
                    String::new()
                } else {
                    "***".to_string()
                };
            }
            "ia_api_url_groq" => ia_api_url_groq = valor,
            "ia_api_url_mistral" => ia_api_url_mistral = valor,
            "ia_modelos_configurados" => {
                ia_modelos_configurados = mask_configured_model_secrets(&valor)
            }
            "vencimiento_alerta_activa" => vencimiento_alerta_activa = valor == "true",
            "vencimiento_vida_util_minima_dias" => {
                vencimiento_vida_util_minima_dias = valor.parse().unwrap_or(30)
            }
            "vencimiento_margen_tolerancia_pct" => {
                vencimiento_margen_tolerancia_pct = valor.parse().unwrap_or(10)
            }
            "quarantine_default" => quarantine_default = valor == "true",
            "favicon_base64" => favicon_base64 = Some(valor),
            "login_bg_color" => login_bg_color = Some(valor),
            _ => {}
        }
    }

    Ok(ConfiguracionResponse {
        nombre_laboratorio,
        logo_base64,
        login_imagen_base64,
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
        ia_api_key_gemini,
        ia_api_key_openai,
        ia_api_key_deepseek,
        ia_api_key_github,
        ia_api_url_openai,
        ia_api_url_deepseek,
        ia_api_url_github,
        ia_api_url_ollama,
        ia_api_key_groq,
        ia_api_key_mistral,
        ia_api_url_groq,
        ia_api_url_mistral,
        ia_modelos_configurados,
        vencimiento_alerta_activa,
        vencimiento_vida_util_minima_dias,
        vencimiento_margen_tolerancia_pct,
        quarantine_default,
        favicon_base64,
        login_bg_color,
    })
}

/// Aplica los cambios presentes en `body` (solo los campos `Some`), registra el
/// audit log de los cambios relevantes y devuelve la configuración resultante.
/// La verificación de rol (solo admin) es responsabilidad del handler.
pub async fn actualizar(
    pool: &PgPool,
    body: UpdateConfiguracion,
    usuario_id: Uuid,
) -> Result<ConfiguracionResponse, AppError> {
    if let Some(dias) = body.vencimiento_vida_util_minima_dias {
        if dias < 0 {
            return Err(AppError::Validation(
                "La vida útil mínima debe ser mayor o igual a 0".to_string(),
            ));
        }
    }
    if let Some(margen) = body.vencimiento_margen_tolerancia_pct {
        if margen < 0 || margen > 100 {
            return Err(AppError::Validation(
                "El margen de tolerancia debe estar entre 0 y 100".to_string(),
            ));
        }
    }
    if let Some(ventana) = body.ventana_consumo_dias {
        if ventana < 14 {
            return Err(AppError::Validation(
                "La ventana de consumo debe ser mayor o igual a 14 días".to_string(),
            ));
        }
    }
    if let Some(factor) = body.factor_historial_corto {
        if factor < 0.0 || factor > 1.0 {
            return Err(AppError::Validation(
                "El factor de historial corto debe estar entre 0.0 y 1.0".to_string(),
            ));
        }
    }
    if let Some(periodo) = body.periodo_revision_dias {
        if periodo < 1 {
            return Err(AppError::Validation(
                "El período de revisión debe ser mayor o igual a 1 día".to_string(),
            ));
        }
    }
    if let Some(ref color) = body.login_bg_color {
        if !color.is_empty() && !is_valid_hex_color(color) {
            return Err(AppError::Validation(
                "El color de fondo debe ser un color hex válido (ej: #1a1a2e)".to_string(),
            ));
        }
    }

    let mut log_changes: Vec<(&str, String, String)> = Vec::new();

    if let Some(nombre) = &body.nombre_laboratorio {
        let ant = get_config(pool, "nombre_laboratorio").await?;
        set_config(pool, "nombre_laboratorio", nombre).await?;
        if ant.as_deref() != Some(nombre) {
            log_changes.push((
                "nombre_laboratorio",
                ant.unwrap_or_default(),
                nombre.clone(),
            ));
        }
    }

    if let Some(logo) = &body.logo_base64 {
        let ant_logo = get_config(pool, "logo_base64").await?;
        set_config(pool, "logo_base64", logo).await?;
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

    if let Some(login_img) = &body.login_imagen_base64 {
        let ant = get_config(pool, "login_imagen_base64").await?;
        set_config(pool, "login_imagen_base64", login_img).await?;
        let tenia_antes = ant.as_deref().map(|v| !v.is_empty()).unwrap_or(false);
        let tiene_ahora = !login_img.is_empty();
        if tenia_antes != tiene_ahora {
            log_changes.push((
                "login_imagen_base64",
                if tenia_antes {
                    "imagen_presente".to_string()
                } else {
                    "sin_imagen".to_string()
                },
                if tiene_ahora {
                    "imagen_actualizada".to_string()
                } else {
                    "imagen_eliminada".to_string()
                },
            ));
        }
    }

    if let Some(favicon) = &body.favicon_base64 {
        let ant = get_config(pool, "favicon_base64").await?;
        let valor = if favicon.is_empty() {
            String::new()
        } else {
            favicon.clone()
        };
        set_config(pool, "favicon_base64", &valor).await?;
        let tenia_antes = ant.as_deref().map(|v| !v.is_empty()).unwrap_or(false);
        let tiene_ahora = !valor.is_empty();
        if tenia_antes != tiene_ahora || !tenia_antes {
            log_changes.push((
                "favicon_base64",
                if tenia_antes {
                    "favicon_presente".to_string()
                } else {
                    "sin_favicon".to_string()
                },
                if tiene_ahora {
                    "favicon_actualizado".to_string()
                } else {
                    "favicon_eliminado".to_string()
                },
            ));
        }
    }

    if let Some(color) = &body.login_bg_color {
        let ant = get_config(pool, "login_bg_color").await?;
        let valor = if color.is_empty() {
            String::new()
        } else {
            color.clone()
        };
        set_config(pool, "login_bg_color", &valor).await?;
        if ant.as_deref() != Some(&valor) {
            log_changes.push(("login_bg_color", ant.unwrap_or_default(), valor));
        }
    }

    if let Some(pin) = &body.pin_kiosko {
        set_config(pool, "pin_kiosko", pin).await?;
        log_changes.push(("pin_kiosko", "***".to_string(), "***".to_string()));
    }

    if let Some(ciego) = body.conteo_ciego {
        let val = if ciego { "true" } else { "false" };
        let ant = get_config(pool, "conteo_ciego").await?;
        set_config(pool, "conteo_ciego", val).await?;
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
        set_config(pool, "dias_autonomia_objetivo", &val).await?;
        log_changes.push(("dias_autonomia_objetivo", "old".to_string(), val));
    }

    if let Some(lead) = body.lead_time_default {
        let val = lead.to_string();
        set_config(pool, "lead_time_default", &val).await?;
        log_changes.push(("lead_time_default", "old".to_string(), val));
    }

    if let Some(codigo) = &body.moneda_codigo {
        set_config(pool, "moneda_codigo", codigo).await?;
    }

    if let Some(simbolo) = &body.moneda_simbolo {
        set_config(pool, "moneda_simbolo", simbolo).await?;
    }

    if let Some(periodo) = body.conteo_periodo_dias {
        set_config(pool, "conteo_periodo_dias", &periodo.to_string()).await?;
    }

    if let Some(ventana) = body.ventana_consumo_dias {
        let val = ventana.to_string();
        let ant = get_config(pool, "ventana_demanda_dias").await?;
        set_config(pool, "ventana_demanda_dias", &val).await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "ventana_demanda_dias",
                ant.unwrap_or_else(|| "30".to_string()),
                val,
            ));
        }
    }

    if let Some(revision) = body.periodo_revision_dias {
        let val = revision.to_string();
        let ant = get_config(pool, "periodo_revision_dias").await?;
        set_config(pool, "periodo_revision_dias", &val).await?;
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
        let ant = get_config(pool, "factor_historial_corto").await?;
        set_config(pool, "factor_historial_corto", &val).await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "factor_historial_corto",
                ant.unwrap_or_else(|| "0.35".to_string()),
                val,
            ));
        }
    }

    if let Some(proveedor) = &body.ia_proveedor {
        set_config(pool, "ia_proveedor", proveedor).await?;
    }

    if let Some(modelo) = &body.ia_modelo {
        set_config(pool, "ia_modelo", modelo).await?;
    }

    if let Some(api_url) = &body.ia_api_url {
        set_config(pool, "ia_api_url", api_url).await?;
    }

    if let Some(api_key) = &body.ia_api_key {
        if api_key != "***" {
            set_config(pool, "ia_api_key", api_key).await?;
            log_changes.push(("ia_api_key", "***".to_string(), "***".to_string()));
        }
    }

    if let Some(key_gemini) = &body.ia_api_key_gemini {
        if key_gemini != "***" {
            set_config(pool, "ia_api_key_gemini", key_gemini).await?;
        }
    }

    if let Some(key_openai) = &body.ia_api_key_openai {
        if key_openai != "***" {
            set_config(pool, "ia_api_key_openai", key_openai).await?;
        }
    }

    if let Some(key_deepseek) = &body.ia_api_key_deepseek {
        if key_deepseek != "***" {
            set_config(pool, "ia_api_key_deepseek", key_deepseek).await?;
        }
    }

    if let Some(key_github) = &body.ia_api_key_github {
        if key_github != "***" {
            set_config(pool, "ia_api_key_github", key_github).await?;
        }
    }

    if let Some(url_openai) = &body.ia_api_url_openai {
        set_config(pool, "ia_api_url_openai", url_openai).await?;
    }

    if let Some(url_deepseek) = &body.ia_api_url_deepseek {
        set_config(pool, "ia_api_url_deepseek", url_deepseek).await?;
    }

    if let Some(url_github) = &body.ia_api_url_github {
        set_config(pool, "ia_api_url_github", url_github).await?;
    }

    if let Some(url_ollama) = &body.ia_api_url_ollama {
        set_config(pool, "ia_api_url_ollama", url_ollama).await?;
    }

    if let Some(key_groq) = &body.ia_api_key_groq {
        if key_groq != "***" {
            set_config(pool, "ia_api_key_groq", key_groq).await?;
        }
    }

    if let Some(key_mistral) = &body.ia_api_key_mistral {
        if key_mistral != "***" {
            set_config(pool, "ia_api_key_mistral", key_mistral).await?;
        }
    }

    if let Some(url_groq) = &body.ia_api_url_groq {
        set_config(pool, "ia_api_url_groq", url_groq).await?;
    }

    if let Some(url_mistral) = &body.ia_api_url_mistral {
        set_config(pool, "ia_api_url_mistral", url_mistral).await?;
    }

    if let Some(modelos) = &body.ia_modelos_configurados {
        let existing = get_config(pool, "ia_modelos_configurados")
            .await?
            .unwrap_or_else(|| "[]".to_string());
        let merged = merge_configured_model_secrets(modelos, &existing)?;
        set_config(pool, "ia_modelos_configurados", &merged).await?;
    }

    if let Some(activa) = body.vencimiento_alerta_activa {
        let val = if activa { "true" } else { "false" };
        let ant = get_config(pool, "vencimiento_alerta_activa").await?;
        set_config(pool, "vencimiento_alerta_activa", val).await?;
        if ant.as_deref() != Some(val) {
            log_changes.push((
                "vencimiento_alerta_activa",
                ant.unwrap_or_else(|| "true".to_string()),
                val.to_string(),
            ));
        }
    }

    if let Some(dias) = body.vencimiento_vida_util_minima_dias {
        let val = dias.to_string();
        let ant = get_config(pool, "vencimiento_vida_util_minima_dias").await?;
        set_config(pool, "vencimiento_vida_util_minima_dias", &val).await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "vencimiento_vida_util_minima_dias",
                ant.unwrap_or_else(|| "30".to_string()),
                val,
            ));
        }
    }

    if let Some(margen) = body.vencimiento_margen_tolerancia_pct {
        let val = margen.to_string();
        let ant = get_config(pool, "vencimiento_margen_tolerancia_pct").await?;
        set_config(pool, "vencimiento_margen_tolerancia_pct", &val).await?;
        if ant.as_deref() != Some(&val) {
            log_changes.push((
                "vencimiento_margen_tolerancia_pct",
                ant.unwrap_or_else(|| "10".to_string()),
                val,
            ));
        }
    }

    if let Some(quarantine) = body.quarantine_default {
        let val = if quarantine { "true" } else { "false" };
        let ant = get_config(pool, "quarantine_default").await?;
        set_config(pool, "quarantine_default", val).await?;
        if ant.as_deref() != Some(val) {
            log_changes.push((
                "quarantine_default",
                ant.unwrap_or_else(|| "true".to_string()),
                val.to_string(),
            ));
        }
    }

    for (clave, ant, nuev) in log_changes {
        sqlx::query(
            "INSERT INTO audit_log (tabla, registro_id, accion, datos_anteriores, datos_nuevos, usuario_id)
             VALUES ('configuracion', $1, 'UPDATE', $2, $3, $4)"
        )
        .bind(clave)
        .bind(serde_json::json!({"valor": ant}))
        .bind(serde_json::json!({"valor": nuev}))
        .bind(usuario_id)
        .execute(pool)
        .await?;
    }

    obtener(pool).await
}

/// Verifica el PIN de salida de modo kiosko/QR. Si no hay PIN configurado,
/// cualquier valor es válido (estado de setup inicial).
pub async fn verificar_pin(pool: &PgPool, pin: &str) -> Result<bool, AppError> {
    let stored = get_config(pool, "pin_kiosko").await?;
    Ok(match stored.as_deref() {
        None | Some("") => true,
        Some(p) => p == pin.trim(),
    })
}

/// Datos públicos para la pantalla de login. Solo expone nombre del laboratorio,
/// imagen de login, favicon y color de fondo; nunca secretos.
pub async fn obtener_branding(pool: &PgPool) -> Result<BrandingResponse, AppError> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion
         WHERE clave IN ('nombre_laboratorio','login_imagen_base64','favicon_base64','login_bg_color')",
    )
    .fetch_all(pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut login_imagen_base64 = String::new();
    let mut favicon_base64: Option<String> = None;
    let mut login_bg_color: Option<String> = None;
    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => {
                if let Some(v) = valor {
                    nombre_laboratorio = v;
                }
            }
            "login_imagen_base64" => {
                if let Some(v) = valor {
                    login_imagen_base64 = v;
                }
            }
            "favicon_base64" => favicon_base64 = valor,
            "login_bg_color" => login_bg_color = valor,
            _ => {}
        }
    }

    Ok(BrandingResponse {
        nombre_laboratorio,
        login_imagen_base64,
        favicon_base64,
        login_bg_color,
    })
}

/// Obtiene los modelos de IA disponibles haciendo una petición a la API del proveedor configurado
pub async fn obtener_ia_modelos(
    pool: &PgPool,
    provider_query: Option<String>,
    api_key_query: Option<String>,
    api_url_query: Option<String>,
) -> Result<Vec<String>, AppError> {
    let mut db_config = crate::services::llm::load_llm_config_for_discovery(pool).await?;

    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT clave, valor_texto FROM configuracion WHERE clave LIKE 'ia_%'")
            .fetch_all(pool)
            .await?;

    let mut key_gemini = String::new();
    let mut key_openai = String::new();
    let mut key_deepseek = String::new();
    let mut key_github = String::new();
    let mut key_groq = String::new();
    let mut key_mistral = String::new();
    let mut url_openai = String::new();
    let mut url_deepseek = String::new();
    let mut url_github = String::new();
    let mut url_ollama = String::new();
    let mut url_groq = String::new();
    let mut url_mistral = String::new();

    for (clave, valor) in rows {
        let trimmed = valor.trim().to_string();
        if !trimmed.is_empty() {
            match clave.as_str() {
                "ia_api_key_gemini" => key_gemini = trimmed,
                "ia_api_key_openai" => key_openai = trimmed,
                "ia_api_key_deepseek" => key_deepseek = trimmed,
                "ia_api_key_github" => key_github = trimmed,
                "ia_api_key_groq" => key_groq = trimmed,
                "ia_api_key_mistral" => key_mistral = trimmed,
                "ia_api_url_openai" => url_openai = trimmed,
                "ia_api_url_deepseek" => url_deepseek = trimmed,
                "ia_api_url_github" => url_github = trimmed,
                "ia_api_url_ollama" => url_ollama = trimmed,
                "ia_api_url_groq" => url_groq = trimmed,
                "ia_api_url_mistral" => url_mistral = trimmed,
                _ => {}
            }
        }
    }

    if let Some(prov) = provider_query {
        db_config.provider = prov;
        db_config.api_key = match db_config.provider.to_lowercase().as_str() {
            "gemini" => {
                if !key_gemini.is_empty() {
                    key_gemini
                } else {
                    db_config.api_key
                }
            }
            "openai" => {
                if !key_openai.is_empty() {
                    key_openai
                } else {
                    db_config.api_key
                }
            }
            "deepseek" => {
                if !key_deepseek.is_empty() {
                    key_deepseek
                } else {
                    db_config.api_key
                }
            }
            "github" => {
                if !key_github.is_empty() {
                    key_github
                } else {
                    db_config.api_key
                }
            }
            "groq" => {
                if !key_groq.is_empty() {
                    key_groq
                } else {
                    db_config.api_key
                }
            }
            "mistral" => {
                if !key_mistral.is_empty() {
                    key_mistral
                } else {
                    db_config.api_key
                }
            }
            _ => db_config.api_key,
        };
        db_config.api_url = match db_config.provider.to_lowercase().as_str() {
            "openai" => {
                if !url_openai.is_empty() {
                    url_openai
                } else {
                    db_config.api_url
                }
            }
            "deepseek" => {
                if !url_deepseek.is_empty() {
                    url_deepseek
                } else {
                    db_config.api_url
                }
            }
            "ollama" => {
                if !url_ollama.is_empty() {
                    url_ollama
                } else {
                    db_config.api_url
                }
            }
            "github" => {
                if !url_github.is_empty() {
                    url_github
                } else {
                    "https://models.inference.ai.azure.com".to_string()
                }
            }
            "groq" => {
                if !url_groq.is_empty() {
                    url_groq
                } else {
                    "https://api.groq.com/openai".to_string()
                }
            }
            "mistral" => {
                if !url_mistral.is_empty() {
                    url_mistral
                } else {
                    "https://api.mistral.ai".to_string()
                }
            }
            _ => db_config.api_url,
        };
    }

    if let Some(key) = api_key_query {
        if !key.is_empty() && key != "***" {
            db_config.api_key = key;
        }
    }

    if let Some(url) = api_url_query {
        if !url.is_empty() {
            db_config.api_url = url;
        }
    }

    let provider = db_config.provider.to_lowercase();
    let api_key = db_config.api_key;
    let api_url = db_config.api_url;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| AppError::Internal("No se pudo crear el cliente HTTP de IA".to_string()))?;

    if provider != "ollama"
        && provider != "custom"
        && (api_key.trim().is_empty() || api_key.eq_ignore_ascii_case("mock"))
    {
        return Err(AppError::BusinessLogic(
            "Configure una API Key real antes de consultar modelos multimodales.".to_string(),
            "AI_CONFIGURATION_ERROR".to_string(),
        ));
    }

    if provider == "gemini" {
        if api_key.is_empty() {
            return Err(AppError::Validation("Por favor configure la API Key de Gemini en la sección de Inteligencia Artificial antes de buscar modelos.".to_string()));
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key
        );

        let res = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => {
                tracing::warn!("Failed to fetch Gemini models list");
                return Err(crate::services::llm::provider_unavailable("Gemini"));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("Gemini models API returned {}: {}", status, text);
            return Err(crate::services::llm::provider_http_error("Gemini", status));
        }

        #[derive(Debug, serde::Deserialize)]
        struct GeminiModel {
            name: String,
            #[serde(rename = "supportedGenerationMethods")]
            supported_generation_methods: Option<Vec<String>>,
        }

        #[derive(Debug, serde::Deserialize)]
        struct GeminiListModelsResponse {
            models: Vec<GeminiModel>,
        }

        let response: GeminiListModelsResponse = match res.json().await {
            Ok(resp) => resp,
            Err(e) => {
                tracing::warn!("Failed to decode Gemini models JSON: {}", e);
                return Err(crate::services::llm::provider_invalid_response("Gemini"));
            }
        };

        let mut models = Vec::new();
        for m in response.models {
            let has_generate = m
                .supported_generation_methods
                .map(|methods| methods.contains(&"generateContent".to_string()))
                .unwrap_or(false);

            if has_generate {
                let clean_name = m
                    .name
                    .strip_prefix("models/")
                    .unwrap_or(&m.name)
                    .to_string();

                // The API does not expose input modalities. Intersect discovery with
                // the document analyzer's conservative multimodal capability policy.
                let is_gemini =
                    crate::services::llm::is_vision_capable_model("gemini", &clean_name);
                let is_noise = clean_name.contains("gemini-1.0")
                    || clean_name.contains("vision")
                    || clean_name.contains("-001")
                    || clean_name.contains("-002")
                    || clean_name.contains("-005")
                    || clean_name.contains("-exp")
                    || clean_name.contains("experimental")
                    || clean_name.contains("thinking")
                    || clean_name.contains("-latest")
                    || clean_name.contains("tuning")
                    || clean_name.contains("tuned");

                if is_gemini && !is_noise {
                    models.push(clean_name);
                }
            }
        }

        models.sort_by_key(|model| {
            (
                crate::services::llm::vision_model_rank("gemini", model).unwrap_or(u8::MAX),
                model.clone(),
            )
        });
        if models.is_empty() {
            return Err(AppError::BusinessLogic(
                "Gemini no informó modelos multimodales compatibles.".to_string(),
                "AI_NO_VISION_MODEL".to_string(),
            ));
        }
        Ok(models)
    } else if provider == "ollama" {
        let host = if api_url.is_empty() {
            "http://localhost:11434".to_string()
        } else {
            api_url
        };

        let url = format!("{}/api/tags", host);
        let res = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch Ollama models: {}", e);
                return Err(crate::services::llm::provider_unavailable("Ollama"));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            tracing::warn!("Ollama models API returned {}", status);
            return Err(crate::services::llm::provider_http_error("Ollama", status));
        }

        #[derive(Debug, serde::Deserialize)]
        struct OllamaModelInfo {
            name: String,
        }

        #[derive(Debug, serde::Deserialize)]
        struct OllamaTagsResponse {
            models: Vec<OllamaModelInfo>,
        }

        let response: OllamaTagsResponse = match res.json().await {
            Ok(resp) => resp,
            Err(e) => {
                tracing::warn!("Failed to decode Ollama models JSON: {}", e);
                return Err(crate::services::llm::provider_invalid_response("Ollama"));
            }
        };

        let mut models: Vec<String> = response
            .models
            .into_iter()
            .map(|m| m.name)
            .filter(|name| crate::services::llm::is_vision_capable_model("ollama", name))
            .collect();
        models.sort_by_key(|model| {
            (
                crate::services::llm::vision_model_rank("ollama", model).unwrap_or(u8::MAX),
                model.clone(),
            )
        });
        if models.is_empty() {
            return Err(AppError::BusinessLogic(
                "Ollama no tiene modelos multimodales compatibles instalados.".to_string(),
                "AI_NO_VISION_MODEL".to_string(),
            ));
        }
        Ok(models)
    } else if provider == "openai"
        || provider == "deepseek"
        || provider == "github"
        || provider == "groq"
        || provider == "mistral"
        || provider == "custom"
    {
        let base_url = if api_url.is_empty() {
            match provider.as_str() {
                "openai" => "https://api.openai.com".to_string(),
                "deepseek" => "https://api.deepseek.com".to_string(),
                "github" => "https://models.inference.ai.azure.com".to_string(),
                "groq" => "https://api.groq.com/openai".to_string(),
                "mistral" => "https://api.mistral.ai".to_string(),
                _ => "http://localhost:11434".to_string(),
            }
        } else {
            api_url.clone()
        };
        let api_root = base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{}/v1/models", api_root);

        let mut req = client.get(&url);
        if !api_key.is_empty() && api_key != "mock" && api_key != "***" {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch {} models: {}", provider, e);
                return Err(crate::services::llm::provider_unavailable(&provider));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("Models API for {} returned {}: {}", provider, status, text);
            return Err(crate::services::llm::provider_http_error(&provider, status));
        }

        #[derive(Debug, serde::Deserialize)]
        struct OpenAiModel {
            id: String,
        }

        #[derive(Debug, serde::Deserialize)]
        struct OpenAiModelsResponse {
            data: Vec<OpenAiModel>,
        }

        let response: OpenAiModelsResponse = match res.json().await {
            Ok(resp) => resp,
            Err(e) => {
                tracing::warn!("Failed to decode {} models JSON: {}", provider, e);
                return Err(crate::services::llm::provider_invalid_response(&provider));
            }
        };

        let mut models = Vec::new();
        for m in response.data {
            let id = m.id;
            if crate::services::llm::is_vision_capable_model(&provider, &id) {
                models.push(id);
            }
        }
        models.sort_by_key(|model| {
            (
                crate::services::llm::vision_model_rank(&provider, model).unwrap_or(u8::MAX),
                model.clone(),
            )
        });
        if models.is_empty() {
            return Err(AppError::BusinessLogic(
                format!("{} no informó modelos multimodales compatibles.", provider),
                "AI_NO_VISION_MODEL".to_string(),
            ));
        }
        Ok(models)
    } else {
        Err(AppError::BusinessLogic(
            format!("El proveedor de IA '{}' no está soportado.", provider),
            "AI_PROVIDER_UNSUPPORTED".to_string(),
        ))
    }
}

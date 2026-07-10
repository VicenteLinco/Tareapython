//! Acceso a datos y reglas de negocio de la configuración del sistema.
//!
//! Fachada sobre la tabla `configuracion` (clave/valor). Los handlers solo
//! parsean el request, verifican el rol y arman la respuesta; el SQL y las
//! reglas (enmascarado de secretos, audit log) viven acá.

use sqlx::PgPool;
use uuid::Uuid;

use crate::dto::configuracion::{BrandingResponse, ConfiguracionResponse, UpdateConfiguracion};
use crate::errors::AppError;

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
            'ventana_consumo_dias','periodo_revision_dias','factor_historial_corto',
            'ia_proveedor','ia_modelo','ia_api_url','ia_api_key',
            'ia_api_key_gemini','ia_api_key_openai','ia_api_key_deepseek','ia_api_key_github',
            'ia_api_url_openai','ia_api_url_deepseek','ia_api_url_github','ia_api_url_ollama',
            'ia_modelos_configurados',
            'vencimiento_alerta_activa','vencimiento_vida_util_minima_dias','vencimiento_margen_tolerancia_pct'
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
    let mut ia_modelo = "gemini-2.5-flash".to_string();
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
    let mut ia_modelos_configurados = String::new();
    let mut vencimiento_alerta_activa = true;
    let mut vencimiento_vida_util_minima_dias = 30;
    let mut vencimiento_margen_tolerancia_pct = 10;

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
            "ia_modelos_configurados" => ia_modelos_configurados = valor,
            "vencimiento_alerta_activa" => vencimiento_alerta_activa = valor == "true",
            "vencimiento_vida_util_minima_dias" => {
                vencimiento_vida_util_minima_dias = valor.parse().unwrap_or(30)
            }
            "vencimiento_margen_tolerancia_pct" => {
                vencimiento_margen_tolerancia_pct = valor.parse().unwrap_or(10)
            }
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
        ia_modelos_configurados,
        vencimiento_alerta_activa,
        vencimiento_vida_util_minima_dias,
        vencimiento_margen_tolerancia_pct,
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
            return Err(AppError::Validation("La vida útil mínima debe ser mayor o igual a 0".to_string()));
        }
    }
    if let Some(margen) = body.vencimiento_margen_tolerancia_pct {
        if margen < 0 || margen > 100 {
            return Err(AppError::Validation("El margen de tolerancia debe estar entre 0 y 100".to_string()));
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
        let ant = get_config(pool, "ventana_consumo_dias").await?;
        set_config(pool, "ventana_consumo_dias", &val).await?;
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

    if let Some(modelos) = &body.ia_modelos_configurados {
        set_config(pool, "ia_modelos_configurados", modelos).await?;
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

/// Datos públicos para la pantalla de login. Solo expone nombre del laboratorio
/// e imagen de login; nunca secretos.
pub async fn obtener_branding(pool: &PgPool) -> Result<BrandingResponse, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion
         WHERE clave IN ('nombre_laboratorio','login_imagen_base64')",
    )
    .fetch_all(pool)
    .await?;

    let mut nombre_laboratorio = "Laboratorio Clínico".to_string();
    let mut login_imagen_base64 = String::new();
    for (clave, valor) in rows {
        match clave.as_str() {
            "nombre_laboratorio" => nombre_laboratorio = valor,
            "login_imagen_base64" => login_imagen_base64 = valor,
            _ => {}
        }
    }

    Ok(BrandingResponse {
        nombre_laboratorio,
        login_imagen_base64,
    })
}

/// Obtiene los modelos de IA disponibles haciendo una petición a la API del proveedor configurado
pub async fn obtener_ia_modelos(
    pool: &PgPool,
    provider_query: Option<String>,
    api_key_query: Option<String>,
    api_url_query: Option<String>,
) -> Result<Vec<String>, AppError> {
    let mut db_config = crate::services::llm::load_llm_config(pool).await?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave LIKE 'ia_%'"
    )
    .fetch_all(pool)
    .await?;

    let mut key_gemini = String::new();
    let mut key_openai = String::new();
    let mut key_deepseek = String::new();
    let mut key_github = String::new();
    let mut url_openai = String::new();
    let mut url_deepseek = String::new();
    let mut url_github = String::new();
    let mut url_ollama = String::new();

    for (clave, valor) in rows {
        let trimmed = valor.trim().to_string();
        if !trimmed.is_empty() {
            match clave.as_str() {
                "ia_api_key_gemini" => key_gemini = trimmed,
                "ia_api_key_openai" => key_openai = trimmed,
                "ia_api_key_deepseek" => key_deepseek = trimmed,
                "ia_api_key_github" => key_github = trimmed,
                "ia_api_url_openai" => url_openai = trimmed,
                "ia_api_url_deepseek" => url_deepseek = trimmed,
                "ia_api_url_github" => url_github = trimmed,
                "ia_api_url_ollama" => url_ollama = trimmed,
                _ => {}
            }
        }
    }

    if let Some(prov) = provider_query {
        db_config.provider = prov;
        db_config.api_key = match db_config.provider.to_lowercase().as_str() {
            "gemini" => if !key_gemini.is_empty() { key_gemini } else { db_config.api_key },
            "openai" => if !key_openai.is_empty() { key_openai } else { db_config.api_key },
            "deepseek" => if !key_deepseek.is_empty() { key_deepseek } else { db_config.api_key },
            "github" => if !key_github.is_empty() { key_github } else { db_config.api_key },
            _ => db_config.api_key,
        };
        db_config.api_url = match db_config.provider.to_lowercase().as_str() {
            "openai" => if !url_openai.is_empty() { url_openai } else { db_config.api_url },
            "deepseek" => if !url_deepseek.is_empty() { url_deepseek } else { db_config.api_url },
            "ollama" => if !url_ollama.is_empty() { url_ollama } else { db_config.api_url },
            "github" => if !url_github.is_empty() { url_github } else { "https://models.inference.ai.azure.com".to_string() },
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

    if provider == "gemini" {
        if api_key.is_empty() {
            return Err(AppError::Validation("Por favor configure la API Key de Gemini en la sección de Inteligencia Artificial antes de buscar modelos.".to_string()));
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key
        );

        let client = reqwest::Client::new();
        let res = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch Gemini models list: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider("gemini"));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("Gemini API returned status code {} when fetching models: {}. Returning default models.", status, text);
            return Ok(get_default_models_for_provider("gemini"));
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
                tracing::warn!("Failed to decode Gemini models JSON: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider("gemini"));
            }
        };

        let deprecated_models = vec![
            "gemini-2.5-flash",
            "gemini-1.0-pro",
            "gemini-1.5-flash-001",
            "gemini-1.5-pro-001",
        ];

        let mut models = Vec::new();
        for m in response.models {
            let has_generate = m
                .supported_generation_methods
                .map(|methods| methods.contains(&"generateContent".to_string()))
                .unwrap_or(false);

            if has_generate {
                let clean_name = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
                let is_deprecated = deprecated_models.iter().any(|&dep| clean_name == dep || clean_name.contains("gemini-1.0"));
                if !is_deprecated {
                    models.push(clean_name);
                }
            }
        }
        
        models.sort();
        Ok(models)
    } else if provider == "ollama" {
        let host = if api_url.is_empty() {
            "http://localhost:11434".to_string()
        } else {
            api_url
        };

        let url = format!("{}/api/tags", host);
        let client = reqwest::Client::new();
        let res = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch Ollama models: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider("ollama"));
            }
        };

        if !res.status().is_success() {
            tracing::warn!("Ollama returned status code {} when fetching models. Returning default models.", res.status());
            return Ok(get_default_models_for_provider("ollama"));
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
                tracing::warn!("Failed to decode Ollama models JSON: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider("ollama"));
            }
        };

        let mut models: Vec<String> = response.models.into_iter().map(|m| m.name).collect();
        models.sort();
        Ok(models)
    } else if provider == "openai" || provider == "deepseek" || provider == "github" || provider == "custom" {
        let base_url = if api_url.is_empty() {
            match provider.as_str() {
                "openai" => "https://api.openai.com".to_string(),
                "deepseek" => "https://api.deepseek.com".to_string(),
                "github" => "https://models.inference.ai.azure.com".to_string(),
                _ => "http://localhost:11434".to_string(),
            }
        } else {
            api_url.clone()
        };
        let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

        let client = reqwest::Client::new();
        let mut req = client.get(&url);
        if !api_key.is_empty() && api_key != "mock" && api_key != "***" {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }
        
        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Failed to fetch OpenAI/DeepSeek/GitHub models: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider(&provider));
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            tracing::warn!("Models API for {} returned status code {}: {}. Returning default models.", provider, status, text);
            return Ok(get_default_models_for_provider(&provider));
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
                tracing::warn!("Failed to decode OpenAI/DeepSeek/GitHub models JSON: {}. Returning default models.", e);
                return Ok(get_default_models_for_provider(&provider));
            }
        };

        let mut models: Vec<String> = response.data.into_iter().map(|m| m.id).collect();
        models.sort();
        Ok(models)
    } else {
        Ok(vec![])
    }
}

fn get_default_models_for_provider(provider: &str) -> Vec<String> {
    match provider.to_lowercase().as_str() {
        "openai" => vec!["gpt-4o-mini".to_string(), "gpt-4o".to_string()],
        "deepseek" => vec!["deepseek-chat".to_string()],
        "github" => vec![
            "gpt-4o-mini".to_string(),
            "gpt-4o".to_string(),
            "meta-llama-3.1-405b-instruct".to_string(),
            "cohere-command-r-plus".to_string(),
        ],
        "gemini" => vec![
            "gemini-2.0-flash".to_string(),
            "gemini-1.5-flash".to_string(),
            "gemini-1.5-pro".to_string(),
        ],
        _ => vec!["gpt-4o-mini".to_string()],
    }
}

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
            'whatsapp_api_url','whatsapp_api_key','whatsapp_webhook_secret','whatsapp_bot_phone'
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
        whatsapp_api_url,
        whatsapp_api_key,
        whatsapp_webhook_secret,
        whatsapp_bot_phone,
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
    let mut log_changes: Vec<(&str, String, String)> = Vec::new();

    if let Some(nombre) = &body.nombre_laboratorio {
        let ant = get_config(pool, "nombre_laboratorio").await?;
        set_config(pool, "nombre_laboratorio", nombre).await?;
        if ant.as_deref() != Some(nombre) {
            log_changes.push(("nombre_laboratorio", ant.unwrap_or_default(), nombre.clone()));
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

    if let Some(wa_url) = &body.whatsapp_api_url {
        set_config(pool, "whatsapp_api_url", wa_url).await?;
    }

    if let Some(wa_key) = &body.whatsapp_api_key {
        if wa_key != "***" {
            set_config(pool, "whatsapp_api_key", wa_key).await?;
            log_changes.push(("whatsapp_api_key", "***".to_string(), "***".to_string()));
        }
    }

    if let Some(secret) = &body.whatsapp_webhook_secret {
        set_config(pool, "whatsapp_webhook_secret", secret).await?;
    }

    if let Some(phone) = &body.whatsapp_bot_phone {
        set_config(pool, "whatsapp_bot_phone", phone).await?;
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

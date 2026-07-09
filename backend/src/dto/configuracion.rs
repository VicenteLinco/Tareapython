use serde::{Deserialize, Serialize};

/// Respuesta de GET /configuracion. Los secretos (`*_api_key`) se devuelven
/// enmascarados como `***` cuando tienen valor.
#[derive(Debug, Serialize)]
pub struct ConfiguracionResponse {
    pub nombre_laboratorio: String,
    pub logo_base64: String,
    pub login_imagen_base64: String,
    pub pin_kiosko: String,
    pub conteo_ciego: bool,
    pub dias_autonomia_objetivo: i32,
    pub lead_time_default: i32,
    pub moneda_codigo: String,
    pub moneda_simbolo: String,
    pub conteo_periodo_dias: i32,
    pub ventana_consumo_dias: i32,
    pub periodo_revision_dias: i32,
    pub factor_historial_corto: f64,
    pub ia_proveedor: String,
    pub ia_modelo: String,
    pub ia_api_url: String,
    pub ia_api_key: String,
    pub ia_api_key_gemini: String,
    pub ia_api_key_openai: String,
    pub ia_api_key_deepseek: String,
    pub ia_api_key_github: String,
    pub ia_api_url_openai: String,
    pub ia_api_url_deepseek: String,
    pub ia_api_url_github: String,
    pub ia_api_url_ollama: String,
    pub whatsapp_api_url: String,
    pub whatsapp_api_key: String,
    pub whatsapp_webhook_secret: String,
    pub whatsapp_bot_phone: String,
    pub vencimiento_alerta_activa: bool,
    pub vencimiento_vida_util_minima_dias: i32,
    pub vencimiento_margen_tolerancia_pct: i32,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConfiguracion {
    pub nombre_laboratorio: Option<String>,
    pub logo_base64: Option<String>,
    pub login_imagen_base64: Option<String>,
    pub pin_kiosko: Option<String>,
    pub conteo_ciego: Option<bool>,
    pub dias_autonomia_objetivo: Option<i32>,
    pub lead_time_default: Option<i32>,
    pub moneda_codigo: Option<String>,
    pub moneda_simbolo: Option<String>,
    pub conteo_periodo_dias: Option<i32>,
    pub ventana_consumo_dias: Option<i32>,
    pub periodo_revision_dias: Option<i32>,
    pub factor_historial_corto: Option<f64>,
    pub ia_proveedor: Option<String>,
    pub ia_modelo: Option<String>,
    pub ia_api_url: Option<String>,
    pub ia_api_key: Option<String>,
    pub ia_api_key_gemini: Option<String>,
    pub ia_api_key_openai: Option<String>,
    pub ia_api_key_deepseek: Option<String>,
    pub ia_api_key_github: Option<String>,
    pub ia_api_url_openai: Option<String>,
    pub ia_api_url_deepseek: Option<String>,
    pub ia_api_url_github: Option<String>,
    pub ia_api_url_ollama: Option<String>,
    pub whatsapp_api_url: Option<String>,
    pub whatsapp_api_key: Option<String>,
    pub whatsapp_webhook_secret: Option<String>,
    pub whatsapp_bot_phone: Option<String>,
    pub vencimiento_alerta_activa: Option<bool>,
    pub vencimiento_vida_util_minima_dias: Option<i32>,
    pub vencimiento_margen_tolerancia_pct: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct VerificarPinInput {
    pub pin: String,
}

/// Datos públicos para personalizar la pantalla de login (sin secretos).
#[derive(Debug, Serialize)]
pub struct BrandingResponse {
    pub nombre_laboratorio: String,
    pub login_imagen_base64: String,
}

use serde::{Deserialize, Serialize};
use crate::errors::AppError;
use crate::handlers::whatsapp::{ActiveUser, execute_tool, log_webhook_transaction, send_whatsapp_reply};

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub provider: String, // "gemini" | "ollama"
    pub model: String,    // e.g. "gemini-1.5-flash"
    pub api_url: String,  // URL for Ollama API
    pub api_key: String,  // API Key for Gemini
}

#[async_trait::async_trait]
pub trait LlmClient {
    async fn chat_with_tools(
        &self,
        system_instruction: &str,
        user_prompt: &str,
        pool: &sqlx::PgPool,
        user: &ActiveUser,
        msg_id: &str,
        sender_phone: &str,
        raw_payload: &str,
        from_phone: &str,
        config: &crate::config::AppConfig,
    ) -> Result<String, AppError>;
}

// Gemini REST API Structs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiContentPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_call: Option<GeminiFunctionCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_response: Option<GeminiFunctionResponse>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiFunctionCall {
    pub name: String,
    pub args: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiFunctionResponse {
    pub name: String,
    pub response: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiContent {
    pub role: String,
    pub parts: Vec<GeminiContentPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiSystemInstruction {
    pub parts: Vec<GeminiSystemInstructionPart>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiSystemInstructionPart {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiFunctionDeclaration {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiTool {
    pub function_declarations: Vec<GeminiFunctionDeclaration>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<GeminiTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_instruction: Option<GeminiSystemInstruction>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiResponse {
    pub candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiCandidate {
    pub content: GeminiContent,
    pub finish_reason: Option<String>,
}

pub struct GeminiClient {
    #[allow(dead_code)]
    config: LlmConfig,
}

impl GeminiClient {
    pub fn new(config: LlmConfig) -> Self {
        Self { config }
    }
}

fn get_gemini_tools() -> Vec<GeminiTool> {
    vec![GeminiTool {
        function_declarations: vec![
            GeminiFunctionDeclaration {
                name: "buscar_stock".to_string(),
                description: "Busca el stock disponible de un producto filtrando por el término ingresado. Devuelve los nombres de productos, códigos, cantidades y áreas de almacenamiento.".to_string(),
                parameters: serde_json::json!({
                    "type": "OBJECT",
                    "properties": {
                        "busqueda": {
                            "type": "STRING",
                            "description": "Código interno o nombre del producto a buscar"
                        }
                    },
                    "required": ["busqueda"]
                }),
            },
            GeminiFunctionDeclaration {
                name: "registrar_ingreso".to_string(),
                description: "Registra el ingreso de stock de un producto específico en un área determinada. Requiere rol de admin o tecnólogo.".to_string(),
                parameters: serde_json::json!({
                    "type": "OBJECT",
                    "properties": {
                        "producto": {
                            "type": "STRING",
                            "description": "Código interno del producto o código de barras de la presentación"
                        },
                        "cantidad": {
                            "type": "NUMBER",
                            "description": "Cantidad física a ingresar (número positivo, máx 2 decimales)"
                        },
                        "lote": {
                            "type": "STRING",
                            "description": "Código identificador de lote suministrado por el fabricante"
                        },
                        "vencimiento": {
                            "type": "STRING",
                            "description": "Fecha de vencimiento en formato AAAA-MM-DD (debe ser futura)"
                        },
                        "area_id": {
                            "type": "INTEGER",
                            "description": "ID numérico del área de destino donde se almacenará"
                        }
                    },
                    "required": ["producto", "cantidad", "lote", "vencimiento", "area_id"]
                }),
            },
            GeminiFunctionDeclaration {
                name: "crear_solicitud_compra".to_string(),
                description: "Crea o actualiza una sugerencia de compra (solicitud borrador) para un producto específico.".to_string(),
                parameters: serde_json::json!({
                    "type": "OBJECT",
                    "properties": {
                        "producto": {
                            "type": "STRING",
                            "description": "Código interno o código de barras del producto"
                        },
                        "cantidad": {
                            "type": "NUMBER",
                            "description": "Cantidad sugerida (número positivo)"
                        },
                        "nota": {
                            "type": "STRING",
                            "description": "Nota descriptiva o justificación opcional"
                        }
                    },
                    "required": ["producto", "cantidad"]
                }),
            },
        ],
    }]
}

#[async_trait::async_trait]
impl LlmClient for GeminiClient {
    async fn chat_with_tools(
        &self,
        system_instruction: &str,
        user_prompt: &str,
        pool: &sqlx::PgPool,
        user: &ActiveUser,
        msg_id: &str,
        sender_phone: &str,
        raw_payload: &str,
        from_phone: &str,
        config: &crate::config::AppConfig,
    ) -> Result<String, AppError> {
        let db_config = load_llm_config(pool).await?;
        let client = reqwest::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            db_config.model, db_config.api_key
        );

        let mut contents = vec![GeminiContent {
            role: "user".to_string(),
            parts: vec![GeminiContentPart {
                text: Some(user_prompt.to_string()),
                function_call: None,
                function_response: None,
            }],
        }];

        let mut command_type: Option<String> = None;
        let mut status = "SUCCESS".to_string();
        let mut loop_count = 0;
        let max_loops = 5;

        loop {
            loop_count += 1;
            if loop_count > max_loops {
                return Err(AppError::Internal("Max tool call loop iterations reached".to_string()));
            }

            let request_payload = GeminiRequest {
                contents: contents.clone(),
                tools: Some(get_gemini_tools()),
                system_instruction: Some(GeminiSystemInstruction {
                    parts: vec![GeminiSystemInstructionPart {
                        text: system_instruction.to_string(),
                    }],
                }),
            };

            let response = client
                .post(&url)
                .json(&request_payload)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Gemini request failed: {}", e)))?;

            if !response.status().is_success() {
                let status_code = response.status();
                let err_text = response.text().await.unwrap_or_default();
                return Err(AppError::Internal(format!(
                    "Gemini API returned error code {}: {}",
                    status_code, err_text
                )));
            }

            let gemini_resp: GeminiResponse = response
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to parse Gemini response: {}", e)))?;

            let candidates = gemini_resp.candidates.ok_or_else(|| {
                AppError::Internal("Gemini response returned no candidates".to_string())
            })?;

            if candidates.is_empty() {
                return Err(AppError::Internal("Gemini response candidates list is empty".to_string()));
            }

            let candidate = &candidates[0];
            let model_content = &candidate.content;

            contents.push(model_content.clone());

            let mut function_call_found = false;
            for part in &model_content.parts {
                if let Some(ref call) = part.function_call {
                    function_call_found = true;

                    let (cmd_type, current_tool_status) = match call.name.as_str() {
                        "buscar_stock" => ("STOCK", "SUCCESS"),
                        "registrar_ingreso" => ("RECIBIR", "SUCCESS"),
                        "crear_solicitud_compra" => ("CREAR", "SUCCESS"),
                        _ => ("INVALIDO", "SYNTAX_ERROR"),
                    };
                    command_type = Some(cmd_type.to_string());
                    if current_tool_status == "SYNTAX_ERROR" {
                        status = "SYNTAX_ERROR".to_string();
                    }

                    let tool_result = match execute_tool(pool, user, &call.name, call.args.clone()).await {
                        Ok(val) => {
                            if let Some(status_field) = val.get("status").and_then(|s| s.as_str()) {
                                if status_field == "error" {
                                    if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                                        if msg.contains("autorización") || msg.contains("rol") {
                                            status = "UNAUTHORIZED".to_string();
                                        } else if msg.contains("no existe") || msg.contains("formato") || msg.contains("futura") || msg.contains("decimales") || msg.contains("cero") {
                                            status = "SYNTAX_ERROR".to_string();
                                        } else {
                                            status = "DB_ERROR".to_string();
                                        }
                                    } else {
                                        status = "SYNTAX_ERROR".to_string();
                                    }
                                }
                            }
                            val
                        }
                        Err(e) => {
                            status = match e {
                                AppError::Forbidden(_) => "UNAUTHORIZED".to_string(),
                                AppError::Sqlx(_) => "DB_ERROR".to_string(),
                                _ => "SYNTAX_ERROR".to_string(),
                            };
                            let error_msg = match e {
                                AppError::Forbidden(m) => m,
                                _ => "Error en la ejecución de la herramienta.".to_string(),
                            };
                            serde_json::json!({
                                "status": "error",
                                "message": error_msg,
                            })
                        }
                    };

                    contents.push(GeminiContent {
                        role: "function".to_string(),
                        parts: vec![GeminiContentPart {
                            text: None,
                            function_call: None,
                            function_response: Some(GeminiFunctionResponse {
                                name: call.name.clone(),
                                response: tool_result,
                            }),
                        }],
                    });
                    break;
                }
            }

            if !function_call_found {
                let final_text = model_content
                    .parts
                    .iter()
                    .filter_map(|p| p.text.clone())
                    .collect::<Vec<String>>()
                    .join("\n");

                let _ = log_webhook_transaction(
                    pool,
                    msg_id,
                    sender_phone,
                    Some(user.id),
                    raw_payload,
                    command_type.as_deref(),
                    &status,
                    Some(&final_text),
                ).await;

                let _ = send_whatsapp_reply(config, from_phone, &final_text).await;
                return Ok(final_text);
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiToolCall {
    pub id: String,
    pub r#type: String, // "function"
    pub function: OpenAiFunctionCall,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiFunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiFunction {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiTool {
    pub r#type: String, // "function"
    pub function: OpenAiFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiRequest {
    pub model: String,
    pub messages: Vec<OpenAiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OpenAiTool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiResponse {
    pub choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OpenAiChoice {
    pub message: OpenAiMessage,
    pub finish_reason: Option<String>,
}

pub struct OllamaClient {
    #[allow(dead_code)]
    config: LlmConfig,
}

impl OllamaClient {
    pub fn new(config: LlmConfig) -> Self {
        Self { config }
    }
}

fn get_openai_tools() -> Vec<OpenAiTool> {
    vec![
        OpenAiTool {
            r#type: "function".to_string(),
            function: OpenAiFunction {
                name: "buscar_stock".to_string(),
                description: "Busca el stock disponible de un producto filtrando por el término ingresado. Devuelve los nombres de productos, códigos, cantidades y áreas de almacenamiento.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "busqueda": {
                            "type": "string",
                            "description": "Código interno o nombre del producto a buscar"
                        }
                    },
                    "required": ["busqueda"]
                }),
            },
        },
        OpenAiTool {
            r#type: "function".to_string(),
            function: OpenAiFunction {
                name: "registrar_ingreso".to_string(),
                description: "Registra el ingreso de stock de un producto específico en un área determinada. Requiere rol de admin o tecnólogo.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "producto": {
                            "type": "string",
                            "description": "Código interno del producto o código de barras de la presentación"
                        },
                        "cantidad": {
                            "type": "number",
                            "description": "Cantidad física a ingresar (número positivo, máx 2 decimales)"
                        },
                        "lote": {
                            "type": "string",
                            "description": "Código identificador de lote suministrado por el fabricante"
                        },
                        "vencimiento": {
                            "type": "string",
                            "description": "Fecha de vencimiento en formato AAAA-MM-DD (debe ser futura)"
                        },
                        "area_id": {
                            "type": "integer",
                            "description": "ID numérico del área de destino donde se almacenará"
                        }
                    },
                    "required": ["producto", "cantidad", "lote", "vencimiento", "area_id"]
                }),
            },
        },
        OpenAiTool {
            r#type: "function".to_string(),
            function: OpenAiFunction {
                name: "crear_solicitud_compra".to_string(),
                description: "Crea o actualiza una sugerencia de compra (solicitud borrador) para un producto específico.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "producto": {
                            "type": "string",
                            "description": "Código interno o código de barras del producto"
                        },
                        "cantidad": {
                            "type": "number",
                            "description": "Cantidad sugerida (número positivo)"
                        },
                        "nota": {
                            "type": "string",
                            "description": "Nota descriptiva o justificación opcional"
                        }
                    },
                    "required": ["producto", "cantidad"]
                }),
            },
        },
    ]
}

#[async_trait::async_trait]
impl LlmClient for OllamaClient {
    async fn chat_with_tools(
        &self,
        system_instruction: &str,
        user_prompt: &str,
        pool: &sqlx::PgPool,
        user: &ActiveUser,
        msg_id: &str,
        sender_phone: &str,
        raw_payload: &str,
        from_phone: &str,
        config: &crate::config::AppConfig,
    ) -> Result<String, AppError> {
        let db_config = load_llm_config(pool).await?;
        let client = reqwest::Client::new();
        let base_url = if db_config.api_url.is_empty() {
            "http://localhost:11434".to_string()
        } else {
            db_config.api_url.trim_end_matches('/').to_string()
        };
        let url = format!("{}/v1/chat/completions", base_url);

        let mut messages = vec![
            OpenAiMessage {
                role: "system".to_string(),
                content: Some(system_instruction.to_string()),
                tool_calls: None,
                tool_call_id: None,
            },
            OpenAiMessage {
                role: "user".to_string(),
                content: Some(user_prompt.to_string()),
                tool_calls: None,
                tool_call_id: None,
            },
        ];

        let mut command_type: Option<String> = None;
        let mut status = "SUCCESS".to_string();
        let mut loop_count = 0;
        let max_loops = 5;

        loop {
            loop_count += 1;
            if loop_count > max_loops {
                return Err(AppError::Internal("Max tool call loop iterations reached".to_string()));
            }

            let request_payload = OpenAiRequest {
                model: db_config.model.clone(),
                messages: messages.clone(),
                tools: Some(get_openai_tools()),
            };

            let response = client
                .post(&url)
                .json(&request_payload)
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Ollama request failed: {}", e)))?;

            if !response.status().is_success() {
                let status_code = response.status();
                let err_text = response.text().await.unwrap_or_default();
                return Err(AppError::Internal(format!(
                    "Ollama API returned error code {}: {}",
                    status_code, err_text
                )));
            }

            let openai_resp: OpenAiResponse = response
                .json()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to parse Ollama response: {}", e)))?;

            if openai_resp.choices.is_empty() {
                return Err(AppError::Internal("Ollama response choices list is empty".to_string()));
            }

            let choice = &openai_resp.choices[0];
            let model_message = &choice.message;

            messages.push(model_message.clone());

            if let Some(ref tool_calls) = model_message.tool_calls {
                if !tool_calls.is_empty() {
                    let tool_call = &tool_calls[0];

                    let (cmd_type, current_tool_status) = match tool_call.function.name.as_str() {
                        "buscar_stock" => ("STOCK", "SUCCESS"),
                        "registrar_ingreso" => ("RECIBIR", "SUCCESS"),
                        "crear_solicitud_compra" => ("CREAR", "SUCCESS"),
                        _ => ("INVALIDO", "SYNTAX_ERROR"),
                    };
                    command_type = Some(cmd_type.to_string());
                    if current_tool_status == "SYNTAX_ERROR" {
                        status = "SYNTAX_ERROR".to_string();
                    }

                    let args_val: serde_json::Value = serde_json::from_str(&tool_call.function.arguments)
                        .unwrap_or(serde_json::Value::Null);

                    let tool_result = match execute_tool(pool, user, &tool_call.function.name, args_val).await {
                        Ok(val) => {
                            if let Some(status_field) = val.get("status").and_then(|s| s.as_str()) {
                                if status_field == "error" {
                                    if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                                        if msg.contains("autorización") || msg.contains("rol") {
                                            status = "UNAUTHORIZED".to_string();
                                        } else if msg.contains("no existe") || msg.contains("formato") || msg.contains("futura") || msg.contains("decimales") || msg.contains("cero") {
                                            status = "SYNTAX_ERROR".to_string();
                                        } else {
                                            status = "DB_ERROR".to_string();
                                        }
                                    } else {
                                        status = "SYNTAX_ERROR".to_string();
                                    }
                                }
                            }
                            val
                        }
                        Err(e) => {
                            status = match e {
                                AppError::Forbidden(_) => "UNAUTHORIZED".to_string(),
                                AppError::Sqlx(_) => "DB_ERROR".to_string(),
                                _ => "SYNTAX_ERROR".to_string(),
                            };
                            let error_msg = match e {
                                AppError::Forbidden(m) => m,
                                _ => "Error en la ejecución de la herramienta.".to_string(),
                            };
                            serde_json::json!({
                                "status": "error",
                                "message": error_msg,
                            })
                        }
                    };

                    messages.push(OpenAiMessage {
                        role: "tool".to_string(),
                        content: Some(serde_json::to_string(&tool_result).unwrap()),
                        tool_calls: None,
                        tool_call_id: Some(tool_call.id.clone()),
                    });
                    continue;
                }
            }

            let final_text = model_message.content.clone().unwrap_or_default();

            let _ = log_webhook_transaction(
                pool,
                msg_id,
                sender_phone,
                Some(user.id),
                raw_payload,
                command_type.as_deref(),
                &status,
                Some(&final_text),
            ).await;

            let _ = send_whatsapp_reply(config, from_phone, &final_text).await;
            return Ok(final_text);
        }
    }
}

pub async fn load_llm_config(pool: &sqlx::PgPool) -> Result<LlmConfig, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT clave, valor_texto FROM configuracion WHERE clave IN ('ia_proveedor', 'ia_modelo', 'ia_api_url', 'ia_api_key')"
    )
    .fetch_all(pool)
    .await?;

    let mut provider = "gemini".to_string();
    let mut model = "gemini-1.5-flash".to_string();
    let mut api_url = String::new();
    let mut api_key = String::new();

    for (clave, valor) in rows {
        match clave.as_str() {
            "ia_proveedor" => provider = valor,
            "ia_modelo" => model = valor,
            "ia_api_url" => api_url = valor,
            "ia_api_key" => api_key = valor,
            _ => {}
        }
    }

    Ok(LlmConfig {
        provider,
        model,
        api_url,
        api_key,
    })
}

pub struct LlmFactory;

impl LlmFactory {
    pub fn create(config: LlmConfig) -> Result<Box<dyn LlmClient + Send + Sync>, AppError> {
        match config.provider.to_lowercase().as_str() {
            "gemini" => Ok(Box::new(GeminiClient::new(config))),
            "ollama" => Ok(Box::new(OllamaClient::new(config))),
            other => Err(AppError::Internal(format!("Unsupported AI provider: {}", other))),
        }
    }
}

pub fn get_system_prompt() -> String {
    r#"Eres el Asistente de Inteligencia Artificial del Laboratorio Clínico. Tu objetivo es ayudar al personal del laboratorio a gestionar el inventario mediante comandos en lenguaje natural recibidos a través de WhatsApp.

REGLAS DE COMPORTAMIENTO GENERAL:
1. Comunícate en español neutro o español de Chile. Mantén un tono profesional, educado, claro y conciso.
2. Responde directamente la solicitud del usuario en un mensaje corto. Evita introducciones innecesarias o explicaciones redundantes.
3. El sistema opera de manera transaccional. Para interactuar con los datos del inventario, DEBES llamar a la función (herramienta/tool) correspondiente cuando detectes la intención del usuario.

REGLAS DE CONTROL DE ACCESO (RBAC):
- El rol del usuario y sus áreas asignadas rigen qué herramientas puede usar:
  * Consultar stock ('buscar_stock'): Solo permitido para roles 'admin' y 'tecnologo'.
  * Registrar recepción ('registrar_ingreso'): Solo permitido para roles 'admin' y 'tecnologo'.
  * Crear sugerencia de compra ('crear_solicitud_compra'): Permitido para todos los roles activos.
- Si un usuario con un rol no autorizado te pide realizar una acción prohibida, NO invoques la herramienta. Responde amablemente: "Lo siento, tu rol de usuario no tiene autorización para realizar esta acción."

MANEJO DE PARÁMETROS CONVERSACIONAL (MUY IMPORTANTE):
- Si el usuario solicita ejecutar una acción pero omite parámetros requeridos por la herramienta, NO debes inventar los datos (por ejemplo, inventar lotes, cantidades, áreas o fechas) ni rellenar con valores ficticios.
- En su lugar, debes responder conversacionalmente solicitando de forma explícita y amable la información faltante.
  * Ejemplo para registrar ingreso: Si el usuario dice "Recibir Paracetamol lote L12", debes responder: "Por favor, indícame la cantidad que deseas registrar, la fecha de vencimiento (formato AAAA-MM-DD) y el ID del área de destino."
  * Ejemplo para sugerencia de compra: Si el usuario dice "Crear solicitud de Ibuprofeno", debes responder: "Por favor, indícame la cantidad que deseas solicitar."

REGLAS DE VALIDACIÓN DE PARÁMETROS PARA HERRAMIENTAS:
1. Identificador de Producto ('producto' / 'busqueda'):
   - Acepta tanto el código interno del producto (ej. 'P-001') como el código de barras de la presentación (ej. '7800000000012').
2. Cantidad ('cantidad'):
   - Debe ser un número estrictamente mayor que cero.
   - Debe contener como máximo 2 decimales (ej. 10.50 es válido, 10.555 no es válido).
3. Fecha de Vencimiento ('vencimiento'):
   - Debe cumplir obligatoriamente con el formato 'AAAA-MM-DD' (Año-Mes-Día).
   - Debe ser una fecha futura en relación al día de hoy.
4. Área de Destino ('area_id'):
   - Debe ser el identificador numérico entero del área.

RESPUESTA FINAL POST-EJECUCIÓN:
- Una vez ejecutada la herramienta y recibido el JSON de respuesta del backend, utilízalo para componer una respuesta final amigable y detallada en español para el usuario.
- Si el backend te devuelve un mensaje de error dentro de la respuesta de la herramienta, explícale el problema al usuario de forma comprensible basándote en la información devuelta (ej. indicar que el producto no existe o que el lote está vencido)."#.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_llm_factory_create() {
        let gemini_config = LlmConfig {
            provider: "gemini".to_string(),
            model: "gemini-1.5-flash".to_string(),
            api_url: "".to_string(),
            api_key: "test_key".to_string(),
        };
        let client = LlmFactory::create(gemini_config);
        assert!(client.is_ok());

        let ollama_config = LlmConfig {
            provider: "OLLAMA".to_string(), // Test case-insensitivity
            model: "llama3".to_string(),
            api_url: "http://localhost:11434".to_string(),
            api_key: "".to_string(),
        };
        let client = LlmFactory::create(ollama_config);
        assert!(client.is_ok());

        let unsupported_config = LlmConfig {
            provider: "invalid_provider".to_string(),
            model: "some-model".to_string(),
            api_url: "".to_string(),
            api_key: "".to_string(),
        };
        let client = LlmFactory::create(unsupported_config);
        assert!(client.is_err());
    }
}

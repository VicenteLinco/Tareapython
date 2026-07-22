# Technical Design: Multiple Transactions & Global Stock Consumption in WhatsApp Agent

Implement the parallel tool execution loop in the LLM service, introduce the global interactive stock consumption tool (`registrar_consumo`) utilizing FEFO, and expand search/consumption access for the `tecnologo` role.

## Quick path

1. **Update LLM Tool Loops**: Modify `chat_with_tools` in `llm.rs` to loop over and execute all parallel tool calls from Gemini and Ollama/OpenAI.
2. **Implement `registrar_consumo`**: Add the handler `execute_registrar_consumo` in `whatsapp.rs` with pessimistic row locking and interactive lote selection.
3. **Extend RBAC**: Allow `tecnologo` role to search and consume stock globally.
4. **Verification**: Run unit and integration tests covering parallel loop, interactive flow, and RBAC access.

## Details

| Component | Target File | Description |
|-----------|-------------|-------------|
| **LLM Service** | `backend/src/services/llm.rs` | <ul><li>Define `registrar_consumo` schema in `get_gemini_tools()` and `get_openai_tools()`.</li><li>Rewrite loop handling in `GeminiClient::chat_with_tools` to run all function calls in a single turn and respond with a unified `GeminiContent` role "function" response.</li><li>Rewrite loop handling in `OllamaClient::chat_with_tools` to execute all `tool_calls` and append role "tool" responses in history.</li><li>Append interaction rules to `get_system_prompt()`.</li></ul> |
| **WhatsApp Handler** | `backend/src/handlers/whatsapp.rs` | <ul><li>Update `execute_buscar_stock` to bypass area constraint for `tecnologo` (using `$2 = 'admin' OR $2 = 'tecnologo'`).</li><li>Add `RegistrarConsumoArgs` and result structs.</li><li>Register tool in `execute_tool`.</li><li>Implement `execute_registrar_consumo` with interactive FEFO logic and transaction locking.</li></ul> |

---

## 1. LLM Tool Execution Loop Updates

### Gemini parallel execution logic in `llm.rs`
The `chat_with_tools` method loops over candidates and checks for function calls. We will replace the loop that handles a single part and breaks, collecting all function calls:

```rust
// In GeminiClient::chat_with_tools loop
let candidate = &candidates[0];
let model_content = &candidate.content;

contents.push(model_content.clone());

let mut function_call_found = false;
let mut function_responses = Vec::new();
let mut command_types = Vec::new();

for part in &model_content.parts {
    if let Some(ref call) = part.function_call {
        function_call_found = true;

        let cmd_type = match call.name.as_str() {
            "buscar_stock" => "STOCK",
            "registrar_ingreso" => "RECIBIR",
            "registrar_consumo" => "CONSUMO",
            "crear_solicitud_compra" => "CREAR",
            _ => "INVALIDO",
        };
        if cmd_type != "INVALIDO" && !command_types.contains(&cmd_type) {
            command_types.push(cmd_type);
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

        function_responses.push(GeminiContentPart {
            text: None,
            function_call: None,
            function_response: Some(GeminiFunctionResponse {
                name: call.name.clone(),
                response: tool_result,
                id: call.id.clone(),
            }),
            thought_signature: None,
        });
    }
}

if function_call_found {
    if !command_types.is_empty() {
        command_type = Some(command_types.join(","));
    }
    contents.push(GeminiContent {
        role: "function".to_string(),
        parts: function_responses,
    });
    continue;
}
```

### Ollama/OpenAI parallel execution logic in `llm.rs`
Similarly, we replace the `tool_calls[0]` array-slicing logic with a complete vector iteration:

```rust
// In OllamaClient::chat_with_tools loop
if let Some(ref tool_calls) = model_message.tool_calls {
    if !tool_calls.is_empty() {
        let mut command_types = Vec::new();

        for tool_call in tool_calls {
            let cmd_type = match tool_call.function.name.as_str() {
                "buscar_stock" => "STOCK",
                "registrar_ingreso" => "RECIBIR",
                "registrar_consumo" => "CONSUMO",
                "crear_solicitud_compra" => "CREAR",
                _ => "INVALIDO",
            };
            if cmd_type != "INVALIDO" && !command_types.contains(&cmd_type) {
                command_types.push(cmd_type);
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
        }

        if !command_types.is_empty() {
            command_type = Some(command_types.join(","));
        }
        continue;
    }
}
```

---

## 2. Interactive Consumption Implementation (`registrar_consumo`)

### Struct definitions in `whatsapp.rs`
```rust
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistrarConsumoArgs {
    pub producto: String,
    pub cantidad: rust_decimal::Decimal,
    pub lote: Option<String>,
    pub area_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegistrarConsumoResult {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoteSelectionDetail {
    pub lote_id: uuid::Uuid,
    pub numero_lote: String,
    pub codigo_interno: String,
    pub fecha_vencimiento: chrono::NaiveDate,
    pub area_nombre: String,
    pub area_id: i32,
    pub cantidad_disponible: rust_decimal::Decimal,
}
```

### Detailed DB logical steps for `execute_registrar_consumo`
1. **Authorize**: Check if `user.rol` is `"admin"` or `"tecnologo"`. Return error status if false.
2. **Validate**:
   - `cantidad` > `0`.
   - `cantidad` has at most 2 decimal places.
3. **Resolve Product**: Invoke `resolve_product(pool, &args.producto).await?`.
   - If multiple candidates or no product, return error status with the product selection message.
   - Extract `producto_id` and conversion factor. Compute `cantidad_base = args.cantidad * factor_conversion`.
4. **Determine Lote & Path**:
   - **Scenario 1: `lote` is None**:
     Query stock globally using the following database query:
     ```sql
     SELECT 
         s.id as stock_id,
         s.lote_id,
         s.cantidad,
         s.area_id,
         l.numero_lote,
         l.codigo_interno,
         l.fecha_vencimiento,
         a.nombre as area_nombre
     FROM stock s
     JOIN lotes l ON l.id = s.lote_id
     JOIN areas a ON a.id = s.area_id
     WHERE l.producto_id = $1 AND s.cantidad > 0
     ORDER BY l.fecha_vencimiento ASC
     ```
     - If `rows.is_empty()`, return: `{"status": "error", "message": "Error: No hay stock disponible para este producto."}`.
     - If `rows.len() == 1`:
       - Retrieve the single row.
       - Begin transaction: `let mut tx = pool.begin().await?`.
       - Pessimistically lock stock row:
         ```sql
         SELECT cantidad FROM stock WHERE id = $1 FOR UPDATE
         ```
         using the `stock_id` of the row.
       - Validate that locked `cantidad` >= `cantidad_base`.
       - Call `stock_ops::aplicar_salida_fefo(&mut tx, &[LoteFefo { stock_id: row.stock_id, lote_id: row.lote_id, cantidad: row.cantidad, area_id: row.area_id }], cantidad_base, user.id, "CONSUMO", Uuid::new_v4(), Some("Consumo vía WhatsApp Agent"), None).await?`.
       - Commit transaction.
       - Return success response.
     - If `rows.len() > 1`:
       - Assign `fefo_lote` to the first item (oldest vencimiento).
       - Map all other elements to `alternativas`.
       - Return payload with `status: "needs_lote_selection"`.

   - **Scenario 2: `lote` is Some(lote_ident)**:
     Query the specific lote:
     ```sql
     SELECT 
         s.id as stock_id,
         s.lote_id,
         s.cantidad,
         s.area_id,
         l.numero_lote,
         l.codigo_interno,
         l.fecha_vencimiento,
         a.nombre as area_nombre
     FROM stock s
     JOIN lotes l ON l.id = s.lote_id
     JOIN areas a ON a.id = s.area_id
     WHERE l.producto_id = $1
       AND (l.numero_lote = $2 OR l.codigo_interno = $2 OR l.id::text = $2)
       AND s.cantidad > 0
     ```
     - If `args.area_id` is specified:
       Filter: `AND s.area_id = $3`.
     - Else:
       If `rows.len() > 1` (lote exists in multiple areas), return error:
       `{"status": "error", "message": "Error: El lote especificado está presente en múltiples áreas. Por favor indica el ID de área."}`.
     - If `rows.is_empty()`, return: `{"status": "error", "message": "Error: El lote especificado no existe o no tiene stock disponible."}`.
     - Obtain `row` (unique area/lote match).
     - Begin transaction: `let mut tx = pool.begin().await?`.
     - Lock stock:
       ```sql
       SELECT cantidad FROM stock WHERE lote_id = $1 AND area_id = $2 FOR UPDATE
       ```
     - Validate quantity.
     - Execute `stock_ops::aplicar_salida_fefo` using the `LoteFefo` details.
     - Commit transaction.
     - Return success payload.

---

## 3. Global Access for Technologists (`buscar_stock`)

In `execute_buscar_stock`, adjust the SQL where clause checks:

```diff
              AND (
-                  $2 = 'admin' OR 
+                  $2 = 'admin' OR $2 = 'tecnologo' OR 
                  EXISTS (
                      SELECT 1 FROM usuario_area ua 
                      WHERE ua.usuario_id = $3 AND ua.area_id = v.area_id
                  )
              )
```

---

## 4. LLM System Prompt Updates

Append these guidelines to `get_system_prompt()` in `llm.rs`:

```markdown
REGLAS PARA EL CONSUMO DE INVENTARIO ('registrar_consumo'):
1. Solo los roles 'admin' y 'tecnologo' tienen autorización para registrar consumos. Estos usuarios tienen acceso global (pueden buscar y consumir stock en cualquier área).
2. Si el backend responde con estado "success", confirma inmediatamente la transacción al usuario indicando el lote y área utilizados.
3. Si el backend responde con estado "needs_lote_selection", debes formularle al usuario la siguiente pregunta de selección de lote en español neutro estricto, utilizando los datos recibidos en el JSON:
   "Voy a registrar el consumo de [CANTIDAD] unidades del Lote [LOTE_SUGERIDO] (vence pronto: [FECHA_VENCIMIENTO]) en el área [AREA_SUGERIDA]. ¿Confirmas? (Si usaste otro lote, dime el código o número: [LOTE_ALT1], [LOTE_ALT2], etc.)"
4. Si el usuario responde confirmando (ej. "Sí", "Confirmar"), llama a 'registrar_consumo' pasando el lote y el area_id sugerido.
5. Si el usuario indica que utilizó uno de los lotes alternativos (ej. "Usé el lote L14"), llama a 'registrar_consumo' pasando el lote y el area_id correspondiente a esa alternativa.
```

---

## Checklist

- [ ] Parallel executions processed by both clients without early iteration exits.
- [ ] Database locks use `FOR UPDATE` on `stock` rows.
- [ ] Technologist searches are global.
- [ ] Single-lote consumption completes directly; multi-lote prompts Spanish selection.
- [ ] Commits follow the work-unit convention.
- [ ] Verification tests validate transactions isolation, concurrency locking, and batch logic.

## Next step

Create `openspec/tasks.md` outlining the atomic commit-by-commit task structure.

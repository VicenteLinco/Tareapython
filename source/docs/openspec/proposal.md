# Multiple Transactions & Global Stock Consumption in WhatsApp Agent

Enable processing of multiple actions (receipts, consumptions, suggestions) in a single WhatsApp message by fixing the LLM tool execution loop, introducing a global interactive stock consumption tool that removes area restrictions for technologists, and ensuring atomic transaction isolation with failure reporting.

## Quick path

1. **Fix the LLM Tool Loop**: Update the Gemini and Ollama implementations of `chat_with_tools` in `backend/src/services/llm.rs` to execute all parallel tool calls instead of breaking after the first one.
2. **Expose `registrar_consumo`**: Implement a new LLM tool for stock consumption linked to `stock_ops::aplicar_salida_fefo` with interactive lote selection.
3. **Bypass Area Restrictions for Technologists**: Update authorization logic in `buscar_stock` and the new `registrar_consumo` to allow `tecnologo` users to search and consume stock globally.
4. **Verify Implementation**: Run backend tests and execute manual validation via mock WhatsApp webhooks.

---

## Details

### 1. Tool Loop Fix
Both LLM client implementations (`GeminiClient` and `OllamaClient` in `backend/src/services/llm.rs`) currently stop processing as soon as they encounter the first tool call in the LLM's response.

- **Gemini Fix**:
  Iterate over all parts in `model_content.parts` to collect and execute all `function_call` parts. Respond with a single `GeminiContent` containing a list of matching `function_response` parts.
- **Ollama/OpenAI Fix**:
  Iterate over the entire `tool_calls` vector in `model_message.tool_calls`, executing each tool. Push a separate message to the conversation history for each tool execution with `role: "tool"` and the corresponding `tool_call_id`.

### 2. New Consumption Tool (`registrar_consumo`)
Introduce a new LLM-exposed tool to handle consumption.

**Tool Schema**:
- `producto` (string, required): The internal code of the product or barcode.
- `cantidad` (number, required): The quantity to consume (must be a positive number with at most 2 decimal places).
- `lote` (string, optional): The manufacturer lot number, internal lot code, or UUID of the lote to consume.
- `area_id` (integer, optional): The ID of the area.

### 3. Interactive Consumption Flow
Instead of automatically selecting lotes via FEFO, the tool implements an interactive selection flow:

1. **Lote Not Provided**: If the LLM invokes `registrar_consumo` without a `lote` argument:
   - Query all available stock globally for the resolved product.
   - Return status `"needs_lote_selection"` along with a list of lotes including `lote_id`, `numero_lote`, `codigo_interno`, `area_id`, `area_nombre`, `cantidad`, and `fecha_vencimiento`.
   - The LLM formats this list for the user on WhatsApp, asking them to reply with their choice.
2. **Lote Provided**: When the user replies with their selection, the LLM invokes `registrar_consumo` providing the `lote` identifier and corresponding `area_id`.
   - The tool locks the specific `stock` row matching `(lote_id, area_id)` using `FOR UPDATE`.
   - If stock is sufficient, it invokes `stock_ops::aplicar_salida_fefo` with that single lote.
   - The area of origin is inferred from the chosen lote's `area_id`.

### 4. RBAC Permissions Update
Currently, technologists are restricted to actions in their assigned areas. This restriction will be removed for global search and stock consumption:
- In `buscar_stock` (`execute_buscar_stock`), allow users with role `admin` or `tecnologo` to search stock across all areas globally (bypassing the `usuario_area` check).
- In `registrar_consumo`, allow users with role `admin` or `tecnologo` to consume stock globally.

### 5. Transaction Isolation & Failure Reporting
Since each tool execution runs in its own database transaction (`pool.begin()`), failure of one tool call does not roll back other successful ones.
The LLM receives individual JSON responses for each tool call:
- Success: `{"status": "success", "message": "..."}`
- Error: `{"status": "error", "message": "..."}`

The LLM consolidates these responses and formats a final message to the user, reporting exactly which transactions succeeded and which failed with their specific reasons.

---

## Technical & Architectural Impact

| Component | Impact Description |
|-----------|--------------------|
| **Database** | No schema changes. Stock and lotes queries will utilize `FOR UPDATE` locks on the `stock` table during individual transaction execution. |
| **Backend Handlers (`whatsapp.rs`)** | Implement `execute_registrar_consumo` and register it in `execute_tool`. Update `execute_buscar_stock` to bypass `usuario_area` checks if the user is a `tecnologo`. |
| **LLM Service (`llm.rs`)** | Update `chat_with_tools` loops for both Gemini and Ollama. Define `registrar_consumo` tool declaration in both `get_gemini_tools` and `get_openai_tools`. |
| **Tests** | Add test cases in `backend/src/handlers/whatsapp.rs` to verify: <ul><li>Multiple parallel tool executions in a single message turn.</li><li>Global search permission for technologists.</li><li>Global consumption and interactive selection.</li><li>Failure isolation (one failing tool does not roll back another).</li></ul> |

---

## Checklist

- [ ] `GeminiClient` and `OllamaClient` process all parallel tool calls without loop termination.
- [ ] `registrar_consumo` tool is registered and exposed to the LLM.
- [ ] Technologist users can successfully query and consume stock globally (across all areas).
- [ ] Consumption flow prompts the user with available lotes globally if no specific lote is provided.
- [ ] Failed tool calls in a batch return descriptive error messages while successful ones are committed.
- [ ] All new and existing tests pass.

## Next step

Initialize the design and task breakdown phases of the SDD process.

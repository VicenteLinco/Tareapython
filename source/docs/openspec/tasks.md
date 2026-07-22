# Task Breakdown: Multiple Transactions & Global Stock Consumption in WhatsApp Agent

Atomic checklist of tasks grouped by work-unit commits to implement the parallel tool loop, `registrar_consumo` tool, and technologist global access.

## Review Workload Forecast
- **Estimated lines of code**: ~200-250 lines of logic, ~150 lines of tests.
- **Risk Category**: Low to Medium. Work is segmented into 7 discrete, compiling commits to keep review focus high.
- **Delivery Strategy**: `stacked-to-main` or single PR with well-structured commits.

---

## Commit 1: Schema declarations for `registrar_consumo`
Define the input parameter schemas for the new consumption tool.

- [x] **Define Gemini schema**: Add the declaration of `registrar_consumo` to `get_gemini_tools()` in `backend/src/services/llm.rs`.
- [x] **Define OpenAI schema**: Add the declaration of `registrar_consumo` to `get_openai_tools()` in `backend/src/services/llm.rs`.
- [x] **Verify**: Compile the backend.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 2: Parallel execution in Gemini client loop
Refactor the Gemini tool loop to execute all function calls in a single message turn.

- [x] **Loop refactor**: Modify the response candidate parsing logic in `GeminiClient::chat_with_tools` to iterate over all parts, collect function calls, execute them, and respond with a unified role "function" message.
- [x] **Verify**: Compile the project and verify no syntax or type errors.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 3: Parallel execution in Ollama client loop
Refactor the Ollama/OpenAI tool loop to run all tool calls.

- [x] **Loop refactor**: Modify the tool handling in `OllamaClient::chat_with_tools` to iterate over the entire `tool_calls` vector, executing each tool in its own block, and append all resulting tool messages to history.
- [x] **Verify**: Compile the project.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 4: Implement `execute_registrar_consumo` handler
Create the consumption endpoint logic including DB queries, pessimistic locking, and the FEFO selection path.

- [x] **Add Structs**: Add `RegistrarConsumoArgs`, `RegistrarConsumoResult`, and `LoteSelectionDetail` in `backend/src/handlers/whatsapp.rs`.
- [x] **Register Tool**: Wire `registrar_consumo` into `execute_tool`.
- [x] **Implement Core Logic**: Write the complete logic for `execute_registrar_consumo` implementing:
  - RBAC verification.
  - Product resolution.
  - Lote selection:
    - If `lote` is None: query stock globally. If 1 lote, lock `FOR UPDATE` and consume. If >1 lotes, return `needs_lote_selection` with alternatives.
    - If `lote` is Some: query matching lote. Lock row `FOR UPDATE` and consume.
- [x] **Verify**: Run tests and check compilation.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 5: Enable global stock search for technologists
Bypass area constraints for the `tecnologo` role in searches.

- [x] **Modify Query**: Update the `EXISTS` check in `execute_buscar_stock` in `backend/src/handlers/whatsapp.rs` to allow `tecnologo` users to search globally (bypassing the `usuario_area` table filter).
- [x] **Verify**: Compile.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 6: Add prompt rules to system instruction
Guide the LLM on handling the interactive selection response.

- [x] **System Prompt**: Append prompt rules to `get_system_prompt()` in `backend/src/services/llm.rs` specifying how to format the selection question to the user in neutral Spanish.
- [x] **Verify**: Compile.
  ```bash
  cargo check --manifest-path backend/Cargo.toml
  ```

---

## Commit 7: Integration and unit tests
Write backend tests validating parallel execution, RBAC bypass, and interactive selection.

- [x] **Parallel Execution Test**: Add tests in `backend/src/handlers/whatsapp.rs` simulating a message containing multiple parallel tool calls and validating they all execute.
- [x] **Failure Isolation Test**: Add test simulating a batch of two tools, where the first succeeds and the second fails. Assert that the first commits and the second rolls back.
- [x] **RBAC & Global Search Test**: Verify `tecnologo` can successfully search across all areas.
- [x] **Interactive Consumption Test**: Verify a multi-lote search prompts the user with `needs_lote_selection` status and returns the correct list of options.
- [x] **Verify**: Run tests.
  ```bash
  cargo test --manifest-path backend/Cargo.toml
  ```

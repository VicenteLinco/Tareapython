# Pendientes 2 — Auditoría de patrones, unidades y decimales

Segunda tanda de pendientes, derivada de una auditoría del frontend, los PDF y el bot
de WhatsApp. El foco principal son los **patrones de diseño**; se incluyen además los
hallazgos de **plural/singular** y **manejo de decimales** en reportes y bot.

Cada ítem describe el **problema**, el **resultado esperado** y deja la **evidencia**
(archivo:línea) que motivó el hallazgo. La prioridad es una sugerencia de orden, no un
compromiso.

> Los ítems completados se borran de este archivo (su registro queda en engram + git history).
> La numeración original se mantiene para no romper referencias cruzadas.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 7 | Normalización ortográfica y español neutro (solo la pasada ortográfica) | Texto / i18n | 🟢 Baja |

---

## 7. Normalización ortográfica y español neutro
**Prioridad:** 🟢 Baja · **Área:** Texto / i18n

**Problema**
- Los textos visibles, los mensajes/prompts del bot y los reportes deben usar español
  neutro y ortografía correcta (acentos, diéresis).

**Resultado esperado**
- Una pasada de normalización: ortografía correcta y español neutro en textos de UI,
  prompts/mensajes del bot y reportes.

**Evidencia**
- Prompts del bot: `backend/src/services/llm.rs` (texto extenso del system prompt).
- Textos de UI y PDF (lista concreta a levantar al ejecutar).

**Criterios de aceptación**
- [x] Prompts/mensajes del bot (`llm.rs`): revisado, ortografía y acentos correctos (sin cambios).
- [x] Acentos en textos de UI: corregidos 9 errores objetivos (Área, Días, Áreas, Último consumo,
      Teléfono, análisis) en reportes, conteo, movimientos y solicitudes-compra.
- [ ] **Decisión pendiente del usuario:** neutralizar voseo (ej. "Seleccioná" → "Selecciona"/"Seleccione").
      Es tono de producto, no error ortográfico; requiere decisión antes de un barrido de voseo.

> La parte de **locale** ya está cerrada y centralizada (`APP_LOCALE` en `lib/utils.ts`,
> se mantiene `es-CL`). Solo queda la pasada **ortográfica / español neutro**, que se ejecuta
> en otro turno con la lista concreta.

---

# Arquitectura — Patrones de diseño (GoF)

Auditoría de patrones de diseño clásicos mapeados de forma idiomática a Rust/React.
El objetivo es coherencia: que un mismo problema se resuelva siempre del mismo modo.

**Patrones ya bien resueltos (NO tocar):**
- **Adapter** — `GeminiClient`/`OllamaClient` adaptan APIs externas a `trait LlmClient` (`backend/src/services/llm.rs:227`, `:642`). Es el ejemplo canónico del código.
- **Factory Method** — selección de cliente IA por proveedor (`llm.rs:886`), devuelve `Box<dyn LlmClient>`.
- **Strategy** — `LlmClient.chat_with_tools` (Gemini/Ollama intercambiables); algoritmos de `forecast.rs`.
- **Singleton idiomático** — `AppState` compartido vía `Arc` + `.with_state` (`backend/src/db.rs:7`, `main.rs:224`).
- **Decorator** — middleware `require_auth` envuelve handlers sin modificarlos (`main.rs:211`, `routes.rs`).
- **Observer** — trigger de PostgreSQL (migration 032) `movimientos → stock`; React Query/Zustand en el frontend.

El pendiente de abajo es una **inconsistencia**, no un acierto.

---

## Nota sobre el patrón State (no es un pendiente, es contexto)

`backend/src/domain/estados.rs` define los estados como **enums tipados**
(`EstadoRecepcion::Borrador`, `EstadoSolicitud`, etc.), lo cual es correcto y preferible a
estados "stringly-typed". No se implementa un patrón State completo (objetos-estado que
encapsulan sus transiciones); las transiciones borrador→confirmado viven en los handlers.
**Para este dominio, enums + validación en el service es suficiente** — no se recomienda
introducir el State pattern completo salvo que las transiciones se vuelvan complejas.

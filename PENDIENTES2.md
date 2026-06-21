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
| 9 | Facade inconsistente: SQL crudo en handlers vs. capa `services` | Arquitectura | 🟡 Media |

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
- [ ] Revisar acentos y español neutro en: textos de UI, prompts/mensajes del bot, PDF.

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

## 9. Facade inconsistente — SQL crudo en handlers vs. capa `services`
**Prioridad:** 🟡 Media · **Área:** Arquitectura

**Problema**
- La capa `services/` funciona como fachada sobre el subsistema SQL para algunos módulos
  (`stock_ops`, `recepcion_service`, `consumo_service`…), pero otros handlers tiran SQL
  directo sin pasar por un service. No hay una regla pareja de dónde vive la lógica de datos.
- Esto dificulta testear, reutilizar y razonar: el mismo tipo de operación está resuelto de
  dos formas distintas según el módulo.

**Resultado esperado**
- Una convención única y documentada: qué va en el handler (HTTP, validación de entrada,
  orquestación) y qué va en el service (acceso a datos + reglas de negocio).

**Evidencia (handlers con más SQL directo)**
- `backend/src/handlers/solicitudes_compra.rs` — 66 queries directas.
- `backend/src/handlers/configuracion.rs` — 64.
- `backend/src/handlers/productos.rs` — 32.
- `backend/src/handlers/stock.rs` — 22.

**Criterios de aceptación**
- [x] Documentar la convención handler/service en `CLAUDE.md`. → hecho (sección "Convención handler / service").
- [~] Identificar los handlers que concentran lógica de datos y mover las queries a su service.
      → **En progreso.** Dos handlers grandes ya migrados 100% (sin SQL crudo):
        - `productos.rs` → `producto_service` (molde de referencia del patrón). Tests:
          `productos_test` 9/9 + `productos_codigos_test` 9/9 + `productos_imagen_test` 5/5.
        - `solicitudes_compra.rs` → `solicitud_service` (1274→196 líneas, 0 `sqlx::`).
          Migrado en 5 slices (lecturas, borrador, cierre, envíos, forecast) con tests de
          caracterización primero. `solicitudes_test` 12/12 (4 nuevos: actualizar, completar,
          flujo de envíos, enviar). **Próximo handler**: `configuracion` (~64 queries).
- [ ] Priorizar los más grandes (`configuracion` 64 queries, `stock` 22) por superficie de impacto.
- [x] Migrar **con tests** (el harness ya está desbloqueado vía `common::seed_base_data`), incremental, no big-bang.
      → patrón establecido: tests de caracterización primero, luego mover el SQL.

---

## Nota sobre el patrón State (no es un pendiente, es contexto)

`backend/src/domain/estados.rs` define los estados como **enums tipados**
(`EstadoRecepcion::Borrador`, `EstadoSolicitud`, etc.), lo cual es correcto y preferible a
estados "stringly-typed". No se implementa un patrón State completo (objetos-estado que
encapsulan sus transiciones); las transiciones borrador→confirmado viven en los handlers.
**Para este dominio, enums + validación en el service es suficiente** — no se recomienda
introducir el State pattern completo salvo que las transiciones se vuelvan complejas.

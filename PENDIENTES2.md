# Pendientes 2 — Auditoría de patrones, unidades y decimales

Segunda tanda de pendientes, derivada de una auditoría del frontend, los PDF y el bot
de WhatsApp. El foco principal son los **patrones de diseño**; se incluyen además los
hallazgos de **plural/singular** y **manejo de decimales** en reportes y bot.

Cada ítem describe el **problema**, el **resultado esperado** y deja la **evidencia**
(archivo:línea) que motivó el hallazgo. La prioridad es una sugerencia de orden, no un
compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | Tokens de shadcn en `creador-productos` (fondos/textos transparentes) | Diseño / UI | 🔴 Alta |
| 2 | `formatCantidad` saltado en PDF de stock (siempre singular) | Plural-singular / PDF | 🔴 Alta |
| 3 | Stock entero: el input del bot acepta decimales innecesarios | Decimales / Bot | 🟢 Baja |
| 4 | Select semitransparente en filtros de Stock | Diseño / UI | 🟡 Media |
| 5 | Auditoría de buscadores con dropdown navegable | Diseño / UI | 🟡 Media |
| 6 | Etiquetas de unidad hardcodeadas en reportes y tooltips | Plural-singular | 🟢 Baja |
| 7 | Normalización ortográfica y español neutro | Texto / i18n | 🟢 Baja |
| 8 | Repository fantasma: puertos Hexagonal definidos y nunca usados | Arquitectura | 🟡 Media |
| 9 | Facade inconsistente: SQL crudo en handlers vs. capa `services` | Arquitectura | 🟡 Media |
| 10 | Limpieza de abstracciones muertas del wizard de recepciones | Arquitectura | 🟢 Baja |

---

## 1. Tokens de shadcn en `creador-productos` — fondos y textos transparentes
**Prioridad:** 🔴 Alta · **Área:** Diseño / UI

**Problema**
- Tres tabs del creador de productos usan tokens de shadcn/ui que en este proyecto **no
  existen** (el proyecto es DaisyUI). El resultado son tarjetas con fondo transparente y
  textos casi invisibles.
- `CLAUDE.md` prohíbe explícitamente estos tokens y da las equivalencias de DaisyUI.

**Resultado esperado**
- Las tarjetas y textos de esos tabs usan tokens válidos de DaisyUI, con fondo sólido y
  contraste correcto, igual que el resto de la app.

**Evidencia**
- `frontend/src/pages/creador-productos/categorias-tab.tsx:199` → `bg-card`; `:205` → `text-muted-foreground hover:text-foreground`
- `frontend/src/pages/creador-productos/areas-tab.tsx:284` → `bg-card`; `:290` → `text-muted-foreground hover:text-foreground`
- `frontend/src/pages/creador-productos/proveedores-tab.tsx:417` → `bg-card`; `:423` → `text-muted-foreground hover:text-foreground`

**Criterios de aceptación**
- [ ] Reemplazar `bg-card` → `bg-base-100`, `text-muted-foreground` → `text-base-content/50`,
      `text-foreground` → `text-base-content`, `border` (sin color) → `border-base-300`.
- [ ] Verificar que no queden otros tokens shadcn (`bg-muted`, `bg-background`,
      `border-border`, `text-card-foreground`) en esos tres archivos.
- [ ] Revisión visual: las tarjetas se ven con fondo sólido y el contraste es legible.

---

## 2. `formatCantidad` saltado en el PDF de stock — siempre singular
**Prioridad:** 🔴 Alta · **Área:** Plural-singular / PDF

**Problema**
- El PDF de stock arma la etiqueta de cantidad a mano: `${Math.round(stock)} ${i.unidad}`.
  Esto muestra **siempre el singular** sin importar la cantidad (ej. "5 reactivo" en vez
  de "5 reactivos").
- `CLAUDE.md` marca esto como regla obligatoria: toda cantidad junto a una unidad debe
  pasar por `formatCantidad`.
- Nota: el `Math.round` en sí es correcto — el stock siempre trabaja en unidades básicas
  **enteras** (regla de negocio). El problema es exclusivamente el plural/singular.

**Resultado esperado**
- El PDF de stock usa `formatCantidad(cantidad, unidad, unidad_plural)` y respeta
  singular/plural igual que la app.

**Evidencia**
- `frontend/src/lib/stock-pdf.ts:444` → `${Math.round(i.stock_total ?? 0)} ${i.unidad}…` (etiqueta manual, siempre singular).
- `:487-488` ya usa `formatCantidad` correctamente (referencia del patrón a aplicar).

**Criterios de aceptación**
- [ ] Reemplazar la construcción manual de `:444` por `formatCantidad(i.stock_total, i.unidad, i.unidad_plural)`.
- [ ] Confirmar que `unidad_plural` llega al PDF desde el backend; si falta, agregarlo al DTO.
- [ ] Verificar en el PDF que una cantidad distinta de 1 muestra el plural correcto.

---

## 3. Stock entero — el input del bot acepta decimales innecesarios
**Prioridad:** 🟢 Baja · **Área:** Decimales / Bot

**Problema**
- Regla de negocio: el stock siempre trabaja en unidades básicas **enteras**. Coherente
  con eso, el bot y los PDF muestran cantidades como enteros (correcto, no es un bug).
- La incoherencia menor es la inversa: la validación del bot **acepta hasta 2 decimales**
  al registrar ingreso/consumo, cuando la regla es entero. Un usuario podría intentar
  cargar `10.5` y recién después se redondea/normaliza.
- El esquema de DB es `numeric(12,2)` sin constraint de entero, así que la regla de
  "enteros" hoy se sostiene por convención, no por el tipo de dato.

**Resultado esperado**
- La política de "unidades básicas enteras" se aplica de forma consistente en la entrada:
  el bot rechaza (o redondea con aviso) cantidades no enteras, alineado con el resto del sistema.

**Evidencia**
- Validación que permite 2 decimales: `backend/src/services/whatsapp_service.rs:422` y `:746`
  (`if args.cantidad.scale() > 2`).
- Normalización a entero al devolver stock: `backend/src/services/whatsapp_service.rs:391`
  (`r.stock_total.round().normalize()`) — comportamiento deseado.
- Instrucción del prompt: `backend/src/services/llm.rs:901` (mostrar enteros) — correcta.
- Esquema sin constraint de entero: `backend/migrations/*` (`cantidad numeric(12,2)`).

**Criterios de aceptación**
- [ ] Decidir si la entrada del bot rechaza cantidades no enteras o las redondea avisando.
- [ ] Aplicar la misma regla en ingreso y consumo (`:422` y `:746`).
- [ ] (Opcional) Evaluar un `CHECK` de entero en DB si se quiere blindar la regla a nivel datos.

---

## 4. Select semitransparente en los filtros de Stock
**Prioridad:** 🟡 Media · **Área:** Diseño / UI

**Problema**
- El select de filtro de Stock usa `bg-base-200/50 border-none`, exactamente el caso
  "❌ Incorrecto" de la regla de selects de `CLAUDE.md`: fondo semitransparente y sin
  borde, lo que lo hace ver lavado sobre fondos claros.

**Resultado esperado**
- El select tiene fondo sólido y borde visible, consistente con la regla del proyecto.

**Evidencia**
- `frontend/src/pages/stock/index.tsx:160` → `select select-sm … bg-base-200/50 border-none …`.

**Criterios de aceptación**
- [ ] Cambiar a fondo sólido + borde: `bg-base-100 border border-base-300 rounded-xl`.
- [ ] Si el select está en un panel de filtros, envolverlo en `div.flex.flex-col.gap-1`
      con su `<label>` de `text-[10px] font-bold uppercase tracking-widest text-base-content/40`.

---

## 5. Auditoría de buscadores con dropdown navegable
**Prioridad:** 🟡 Media · **Área:** Diseño / UI

**Problema**
- Hay ~10 páginas con input de búsqueda. Algunas cumplen el patrón de autocomplete con
  dropdown navegable por teclado (ej. Stock usa `search-dropdown`); otras hay que
  verificarlas una por una contra la regla de buscadores (`↓` abre y enfoca, `↑↓`
  circular, `Enter` selecciona, `Esc` cierra/limpia, click-fuera cierra, scroll al activo).

**Resultado esperado**
- Inventario de cuáles buscadores cumplen y cuáles no, y los que no, alineados al skill
  `autocomplete-buscador`.

**Evidencia (páginas a revisar)**
- `etiquetas/EtiquetasPage.tsx`, `usuarios/index.tsx`, `stock/index.tsx`,
  `reportes/index.tsx`, `descartes/nuevo-descarte-tab.tsx`,
  `creador-productos/proveedores-tab.tsx`, `creador-productos/productos-tab.tsx`,
  `solicitudes-compra/components/historial-view.tsx`, `consumos/index.tsx`,
  `ordenes-compra/index.tsx`.

**Criterios de aceptación**
- [ ] Marcar, por página, si el buscador cumple el patrón completo de teclado.
- [ ] Para los que no cumplen: alinearlos al skill `autocomplete-buscador`.
- [ ] Filtros de área/otros se respetan dentro del dropdown.

---

## 6. Etiquetas de unidad hardcodeadas en reportes y tooltips
**Prioridad:** 🟢 Baja · **Área:** Plural-singular

**Problema**
- Algunos totales y tooltips usan etiquetas de unidad fijas en vez de la unidad real del
  ítem. En totales que suman unidades mezcladas un genérico es defendible, pero conviene
  revisarlo para no mostrar una unidad incorrecta.

**Resultado esperado**
- Las etiquetas de unidad reflejan la unidad real cuando es única; cuando el total mezcla
  unidades, usar un genérico explícito y consistente.

**Evidencia**
- `frontend/src/lib/conteo-pdf.ts:162`, `:334`, `:335` → `formatCantidad(…, 'unidad', 'unidades')` hardcodeado.
- `frontend/src/pages/stock/stock-detail.tsx:448` → tooltip de gráfico `${val} ${unidad}` manual.

**Criterios de aceptación**
- [ ] Decidir, para los totales de conteo, si la unidad debe ser la real o un genérico.
- [ ] Tooltip de `stock-detail`: usar `formatCantidad` con la unidad y su plural.

---

## 7. Normalización ortográfica y español neutro
**Prioridad:** 🟢 Baja · **Área:** Texto / i18n

**Problema**
- Los textos visibles, los mensajes/prompts del bot y los reportes deben usar español
  neutro y ortografía correcta (acentos, diéresis). Hoy el formato de fecha/número usa
  locale `es-CL` en ~16 archivos, lo que aplica convenciones chilenas (no necesariamente
  un problema, pero conviene decidir una política única).

**Resultado esperado**
- Una pasada de normalización: ortografía correcta y español neutro en textos de UI,
  prompts/mensajes del bot y reportes, con una política única de locale para fecha/número.

**Evidencia**
- Locale `es-CL` en 16 archivos (frontend `lib/*` y varias `pages/*`).
- Prompts del bot: `backend/src/services/llm.rs` (texto extenso del system prompt).

**Criterios de aceptación**
- [x] Definir si se mantiene `es-CL` o se centraliza un formateador único de fecha/número. → **Decisión: se mantiene `es-CL` (lab chileno, moneda CLP) y se centraliza.**
- [ ] Revisar acentos y español neutro en: textos de UI, prompts/mensajes del bot, PDF. → **Pendiente (otro turno, con lista concreta).**
- [x] Centralizar el formateo de fecha/número en un único helper si se decide cambiar el locale. → **`APP_LOCALE` en `lib/utils.ts` como única fuente de verdad; 14 archivos migrados de literal `'es-CL'` a la constante.**

> Estado: la **parte locale está cerrada y centralizada** (`APP_LOCALE`). Solo queda la pasada **ortográfica / español neutro**, que se ejecuta en otro turno con la lista concreta.

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

Los pendientes de abajo son las **inconsistencias**, no los aciertos.

---

## 8. Repository fantasma — puertos Hexagonal definidos y nunca usados
**Prioridad:** 🟡 Media · **Área:** Arquitectura

**Problema**
- Existe media arquitectura Hexagonal (Ports & Adapters): `domain/repository.rs` define los
  puertos `CategoriaRepository` y `AreaRepository`, y `persistence/sqlx_*_repository.rs`
  los implementa. Pero **ningún handler los inyecta ni los usa**: los handlers de categoría
  y área siguen haciendo SQL directo.
- Es una abstracción muerta: confunde a quien lee el código pensando que ese es el patrón
  vigente del proyecto, cuando no lo es.

**Resultado esperado**
- Decisión binaria y consistente: o el patrón Repository se adopta de verdad, o se elimina.

**Evidencia**
- Puertos: `backend/src/domain/repository.rs` (`CategoriaRepository`, `AreaRepository`).
- Adaptadores: `backend/src/persistence/sqlx_area_repository.rs`, `sqlx_categoria_repository.rs`.
- Sin uso: no hay referencias a esos traits fuera de `domain/` y `persistence/` (handlers no los inyectan).

**Criterios de aceptación**
- [ ] Decidir: adoptar Repository en todos los módulos, o eliminar `domain/repository.rs` + `persistence/sqlx_*`.
- [ ] Si se elimina: quitar también `mod domain;`/`mod persistence;` no usados en `main.rs`.
- [ ] Si se adopta: definir el alcance (qué entidades) y migrar al menos categoría y área como referencia.

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
- [ ] Documentar la convención handler/service en `CLAUDE.md`.
- [ ] Identificar los handlers que concentran lógica de datos y mover las queries a su service.
- [ ] Priorizar los más grandes (`solicitudes_compra`, `configuracion`) por superficie de impacto.

---

## 10. Limpieza de abstracciones muertas del wizard de recepciones
**Prioridad:** 🟢 Baja · **Área:** Arquitectura

**Problema**
- El commit `34c21aa` reemplazó (correctamente) el **wizard multi-paso** de recepciones por
  un **layout de documento único** — mejor ajuste al dominio (tarea de alta frecuencia, el
  operador piensa en "documento de recepción", no en pasos lineales).
- Pero quedaron restos transicionales del wizard: código muerto o vaciado que ya no aporta y
  ensucia la lectura del módulo.

**Resultado esperado**
- El módulo de recepciones refleja solo el patrón vigente (documento), sin restos del wizard.

**Evidencia**
- `frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts` — vaciado (~6 líneas residuales).
- `frontend/src/pages/recepciones/steps/ItemsStep.tsx` y `steps/ProveedorStep.tsx` — remanentes del wizard.

**Criterios de aceptación**
- [ ] Verificar si `useRecepcionWizard.ts` y la carpeta `steps/` siguen referenciados.
- [ ] Eliminar lo que esté muerto; integrar al layout de documento lo que aún se use.
- [ ] Confirmar que `nueva.tsx` no importa nada de `steps/` tras la limpieza.

---

## Nota sobre el patrón State (no es un pendiente, es contexto)

`backend/src/domain/estados.rs` define los estados como **enums tipados**
(`EstadoRecepcion::Borrador`, `EstadoSolicitud`, etc.), lo cual es correcto y preferible a
estados "stringly-typed". No se implementa un patrón State completo (objetos-estado que
encapsulan sus transiciones); las transiciones borrador→confirmado viven en los handlers.
**Para este dominio, enums + validación en el service es suficiente** — no se recomienda
introducir el State pattern completo salvo que las transiciones se vuelvan complejas.

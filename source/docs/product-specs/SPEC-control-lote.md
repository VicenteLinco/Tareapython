# Especificación — Política de control de lote por producto

Rediseño del manejo de lotes. Decisiones tomadas una a una, con benchmark contra
la competencia (LIMS clínicos vs. inventarios genéricos). Este documento es la
**especificación**, no la implementación: describe problema, decisión + benchmark,
spec técnica (DB / backend / frontend), criterios de aceptación y no-goals.

**Estado de decisiones:** todas confirmadas por el usuario el 2026-06-22.

**Relación con `SPEC-stock-vencimientos.md`:** este spec está **aguas arriba** de
aquél. El otro asume que el lote siempre existe y siempre vence (alertas, PDF,
notificaciones, modelo de dos ejes). Éste introduce la idea de que **no todos los
productos juegan con las mismas reglas de lote**. Hay que aplicar éste primero o en
coordinación: el `fecha_vencimiento` nullable y el estado `no_aplica` impactan el
modelo de dos ejes que el otro spec consume.

| # | Sección | Capa | Prioridad |
|---|---------|------|-----------|
| 0 | Concepto central — `control_lote` | Diseño | 🔴 Cimiento |
| 1 | Modelo de datos (enum, nullable, identidad, lote implícito, migración) | DB | 🔴 Alta |
| 2 | Flujos backend (recepción, consumo trazable, stock/dos ejes) | Backend | 🔴 Alta |
| 3 | Frontend (creador, recepción condicional, consumo QR con aviso) | Frontend | 🟡 Media |

---

## Sección 0 — Concepto central: `control_lote`

### Problema
Hoy el lote es **talla única**: `fecha_vencimiento NOT NULL`, FEFO automático para
todos, lote siempre obligatorio. Pero un laboratorio clínico tiene dos mundos:

- **Reactivos críticos** → trazabilidad de lote obligatoria (ISO 15189 / CLIA: hay
  que poder decir qué lote tocó qué resultado de paciente). Vencimiento obligatorio.
  Al consumir, se descuenta el **lote exacto** que el técnico tiene en la mano.
- **Consumibles** (gasas, puntas, vidrio) → el lote y el vencimiento son irrelevantes.
  Obligarlos genera fricción inútil y datos basura.

El modelo no los distingue. De ahí nacen los cuatro dolores reportados: vencimiento
obligatorio para todo, lotes duplicados por la clave UNIQUE, datos redundantes, y la
ausencia de un flujo que garantice el consumo del lote exacto por QR.

### Decisión + benchmark
**Una política de lote por producto, modelada como un enum `control_lote`** (no flags
granulares, no perfil+override — se eligió el enum por ser el más liviano y de una
sola decisión al crear el producto).

- *Benchmark:* los LIMS clínicos serios (LabWare, STARLIMS, QBench) tratan cada
  material como **"lot-controlled" o no** — es una clasificación de primera clase
  porque para reactivos IVD es requisito regulatorio. Los inventarios genéricos
  (Sortly, Quartzy) no distinguen (lote opcional y nada más). Este proyecto vive en
  el mundo clínico pero sin la pesadez de un LIMS completo: adopta la clasificación,
  acotada a tres perfiles.

### Los tres perfiles

| | `trazable` (reactivo crítico) | `con_vto` (actual) | `simple` (consumible) |
|---|---|---|---|
| Lote | **obligatorio** | opcional | sin lote (implícito) |
| Vencimiento | **obligatorio** | obligatorio | sin vencimiento |
| Consumo | **lote exacto escaneado (QR)** | FEFO automático | descuento directo |
| FEFO | sugerido, no impuesto | sí | no aplica |
| Cambio vs hoy | nuevo | comportamiento actual | nuevo |

---

## Sección 1 — Modelo de datos

### 1.1 Enum `control_lote`
- Nuevo enum de dominio en `src/domain/estados.rs`, siguiendo el patrón existente
  (`#[sqlx(type_name = "text", rename_all = "snake_case")]`, `specta::Type`):
  ```rust
  pub enum ControlLote { Trazable, ConVto, Simple }
  ```
- Columna `productos.control_lote TEXT NOT NULL DEFAULT 'con_vto'`.
- Exportar a TS (`export_types`) → el frontend recibe el enum.

### 1.2 `fecha_vencimiento` → nullable
- `ALTER TABLE lotes ALTER COLUMN fecha_vencimiento DROP NOT NULL`.
- Modelo `Lote.fecha_vencimiento`: `NaiveDate` → `Option<NaiveDate>`.
- **Integración con el modelo de dos ejes (migration 002):** `fn_estado_stock` /
  `estado_vencimiento` debe interpretar `NULL` como un nuevo estado `no_aplica`
  (ni alerta, ni FEFO por fecha, ni KPI de vencimiento). Esto afecta los consumidores
  del otro spec (PDF, alertas) → coordinar.

### 1.3 Identidad del lote (resuelve los duplicados)
- **Clave nueva:** `UNIQUE (producto_id, numero_lote)` para lotes con `numero_lote`.
  El `proveedor_id` **sale de la identidad**: el `numero_lote` lo pone el fabricante,
  y el mismo lote físico puede llegar por distintos distribuidores. El proveedor pasa
  a ser un **atributo de la recepción** (`recepcion_detalle`, ya existente), no del lote.
- *Implicación:* recibir el mismo `producto + numero_lote` por dos distribuidores
  reconoce **el mismo lote** y suma stock, en vez de duplicarlo. La traza de quién
  vendió cada vez vive en movimientos/recepciones.
- Reemplaza la clave actual `lotes_producto_proveedor_lote_key (producto_id,
  proveedor_id, numero_lote) NULLS NOT DISTINCT`.

### 1.4 Lote implícito para `simple`
- Productos `simple` no tienen `numero_lote` ni vencimiento, pero el stock sigue
  colgando de un `lote_id` (no se toca `stock` / `movimientos` / trigger 032 / FEFO).
- **Un lote implícito por recepción** (no uno global por producto): preserva el
  `costo_unitario` de cada compra y un orden FIFO por `created_at`.
- `numero_lote` autogenerado o sentinela (p. ej. `IMPL-{recepcion}`), `fecha_vencimiento
  NULL`. No compite por la unicidad de 1.3 (se excluye por índice parcial si hace falta).

### 1.5 Migración (`004_control_lote.sql`) — riesgo controlado
- Agregar columna `control_lote` (default `con_vto` → preserva el comportamiento de
  todos los productos existentes).
- `fecha_vencimiento` nullable.
- **Antes de aplicar la clave nueva**, detectar y **fusionar lotes duplicados**
  existentes que sólo difieren en `proveedor_id`: elegir un superviviente, repuntar
  `stock` / `movimientos` / `recepcion_detalle` / `conteo_items` al `lote_id`
  superviviente, sumar stock, borrar los duplicados. Si hay conflictos no fusionables
  (mismo `producto + numero_lote` con **distinto `fecha_vencimiento`**), **reportarlos**
  (no fusionar a ciegas) y abortar con lista para revisión manual.
- Recién entonces crear `UNIQUE (producto_id, numero_lote)`.

### Criterios de aceptación — DB
- [ ] Producto nuevo nace con `control_lote = 'con_vto'` salvo elección explícita.
- [ ] Un lote `simple` se crea sin vencimiento y sin romper el trigger de stock.
- [ ] Recibir `producto + numero_lote` ya existente (otro distribuidor) suma stock al
      lote existente, no crea uno nuevo.
- [ ] La migración fusiona duplicados por-proveedor sin perder stock ni movimientos.
- [ ] La migración aborta con reporte legible si hay duplicados con vencimiento distinto.

---

## Sección 2 — Flujos backend

Cada flujo lee `producto.control_lote` y se adapta. La regla de capas se mantiene
(handler delgado → service con SQL).

### 2.1 Recepción (`recepcion_service.rs`)
- `trazable` → exigir `numero_lote` y `fecha_vencimiento` (validación). Buscar lote
  existente por `(producto_id, numero_lote)`; si existe, reusar; si no, crear.
- `con_vto` → comportamiento actual (lote opcional, vencimiento obligatorio).
- `simple` → ignorar `numero_lote`/`fecha_vencimiento`; crear el lote implícito por
  recepción (1.4). El usuario no carga nada de lote.

### 2.2 Consumo trazable por QR (`handlers/consumos.rs` + `stock_ops.rs`)
- Patrón de "consumo por lote explícito" ya existe en descartes (`lote_id` directo);
  reutilizar ese camino para `trazable`.
- `trazable` → el consumo **requiere** un `lote_id` (el del QR escaneado). **No** se
  cae al FEFO automático. Se descuenta exactamente ese lote.
  - **Aviso FEFO no bloqueante:** antes de confirmar, el backend chequea si existe otro
    lote del mismo producto/área con `fecha_vencimiento` anterior y stock > 0. Si lo
    hay, devuelve un flag `{ aviso_fefo: true, lote_sugerido: {...} }`. **No** bloquea.
  - El movimiento registra el lote consumido (ya lo hace) + que se consumió con aviso
    (campo/observación para traza).
- `con_vto` → FEFO automático (sin cambios).
- `simple` → descuento directo del stock del producto en el área (vía su/sus lotes
  implícitos, FIFO por `created_at`); sin elección de lote por el usuario.

### 2.3 Stock y modelo de dos ejes (`stock_service.rs`)
- `estado_vencimiento` debe contemplar `fecha_vencimiento IS NULL` → `no_aplica`.
- Los productos `simple` no aparecen en KPIs ni alertas de vencimiento.

### Criterios de aceptación — backend
- [ ] Recibir un `trazable` sin `numero_lote` o sin vencimiento → error de validación.
- [ ] Consumir un `trazable` por `lote_id` descuenta ese lote exacto, no otro.
- [ ] Si el lote escaneado no es el más próximo a vencer, la respuesta trae
      `aviso_fefo` con el lote sugerido, pero el consumo se concreta igual.
- [ ] Consumir un `simple` descuenta stock sin pedir lote.
- [ ] Un lote con `fecha_vencimiento NULL` reporta `estado_vencimiento = 'no_aplica'`.

---

## Sección 3 — Frontend

### 3.1 Creador de productos (`pages/creador-productos/`)
- Dropdown **`Control de lote`** con los tres perfiles, etiquetas claras y una línea
  de ayuda por opción (qué implica). Respetar reglas de selects del CLAUDE.md (DaisyUI,
  fondo sólido, label en mayúsculas).
- Default visible: `con_vto`.

### 3.2 Recepción (campos condicionales)
- Según `control_lote` del producto en la línea:
  - `trazable` → `numero_lote` y `fecha_vencimiento` **obligatorios** (UI los marca).
  - `con_vto` → como hoy.
  - `simple` → **ocultar** los campos de lote/vencimiento por completo.

### 3.3 Consumo trazable por QR (`modo-qr/`, `kiosk/`, consumo individual)
- Al escanear el QR/código de un `trazable`, resolver el `lote_id` exacto y consumir
  **ese** (no abrir el selector FEFO).
- Si la respuesta trae `aviso_fefo`: mostrar un bloque sobrio no bloqueante —
  `⚠ El lote {X} vence antes ({fecha}). ¿Seguro usás éste?` con acciones
  `[ Consumir igual ]` `[ Cambiar a {sugerido} ]`. No frena el flujo.

### Criterios de aceptación — frontend
- [ ] El creador permite elegir `control_lote`; el valor persiste y se relee al editar.
- [ ] En recepción, un `simple` no muestra campos de lote ni vencimiento.
- [ ] En recepción, un `trazable` no deja confirmar sin lote + vencimiento.
- [ ] Escanear un `trazable` consume su lote exacto; el aviso FEFO aparece sólo cuando
      corresponde y no bloquea.

---

## No-goals (primer alcance)
- No se modela multi-proveedor por producto (sigue `productos.proveedor_id` singular).
- No se rehace `stock` / `movimientos` / trigger 032 / FEFO (el lote implícito evita
  tocar el ledger).
- No se migra automáticamente la clasificación de productos existentes a `trazable` /
  `simple` — todos quedan en `con_vto`; reclasificar es trabajo manual del usuario.
- No se cubre el cambio masivo de perfil con lotes activos más allá de "avisa, no rompe"
  (los lotes viejos siguen válidos; la edición puntual queda para un slice posterior).

## Diferenciadores vs. competencia (resumen)
- **Clasificación de lote de primera clase** (lot-controlled) sin el peso de un LIMS.
- **Consumo trazable fiel a la realidad física** (el QR manda) con aviso de gestión,
  en vez de imponer FEFO o dejar pasar el vencimiento en silencio.
- **Identidad de lote por fabricante**, no por distribuidor → elimina duplicados que
  los inventarios genéricos arrastran.

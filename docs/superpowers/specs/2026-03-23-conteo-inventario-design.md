# Diseño: Conteo de Inventario Físico

**Fecha:** 2026-03-23
**Ruta:** `/conteo`
**Fase:** 1 (base para Fase 2: modo ciego, dual-unit, freeze stock)

---

## Contexto

El laboratorio realiza conteos físicos semanales (sábados) contra lista impresa, proceso lento y sin trazabilidad digital. Este módulo reemplaza ese flujo con sesiones de conteo guiadas desde celular, con cálculo automático de diferencias y generación de ajustes de stock.

---

## Decisiones de diseño

| Pregunta | Decisión |
|---|---|
| ¿Qué ítems se cargan? | Todos los lotes activos del área seleccionada (snapshot al crear sesión) |
| ¿Se cuenta por producto o por lote? | Por lote (cada lote es una fila independiente) |
| ¿Qué pasa con ítems no tocados? | No contados — no generan ajuste. Se puede marcar explícitamente "no contado" |
| ¿Quién crea/confirma? | Cualquier tecnólogo puede crear y contar; solo admin puede confirmar |
| ¿Se requiere nota? | Una nota global opcional por sesión |
| ¿Dónde vive en la UI? | Página propia `/conteo` con ítem en menú lateral |
| ¿Dispositivo principal? | Celular/tablet — diseño mobile-first |

---

## Modelo de datos

### Tabla `sesiones_conteo`

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| area_id | INT FK → areas | |
| estado | VARCHAR(20) | `borrador` / `en_progreso` / `confirmado` / `cancelado` |
| usuario_creador_id | UUID FK → usuarios | |
| usuario_confirmador_id | UUID FK → usuarios | nullable |
| nota | TEXT | Nota global opcional |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |
| confirmed_at | TIMESTAMPTZ | nullable |

### Tabla `conteo_items`

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID PK | |
| sesion_id | UUID FK → sesiones_conteo | |
| lote_id | INT FK → lotes | |
| stock_sistema | DECIMAL(12,2) | Snapshot inmutable al momento de crear la sesión |
| cantidad_contada | DECIMAL(12,2) | NULL = pendiente; 0 = contado con cero unidades |
| estado_item | VARCHAR(15) | `pendiente` / `contado` / `no_contado` |
| version | INT NOT NULL DEFAULT 1 | Optimistic locking para ediciones concurrentes |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

**Constraints:**
- `UNIQUE(sesion_id, lote_id)` — un lote no puede aparecer dos veces en la misma sesión

**Distinción pendiente vs no_contado vs contado:**
- `pendiente`: el contador nunca tocó este ítem (`cantidad_contada = NULL`)
- `no_contado`: el contador marcó explícitamente "No contado" (`cantidad_contada = NULL`, estado = `no_contado`)
- `contado`: el contador ingresó un valor, incluyendo 0 (`cantidad_contada >= 0`, estado = `contado`)

---

## Nota sobre snapshot de stock

`stock_sistema` captura el stock del lote al momento de **crear la sesión**, no al confirmarla. Movimientos registrados durante el conteo (consumos, recepciones) no alteran este valor.

**Implicación:** si entre la creación y la confirmación se registra un consumo de 10 unidades del lote X, el sistema generará un AJUSTE_NEGATIVO de 10 unidades que no refleja una discrepancia real.

**Mitigación en Fase 1:** la UI de confirmación muestra el tiempo transcurrido desde la creación de la sesión. Si supera 2 horas, se muestra una advertencia: _"Han pasado N horas desde que se inició esta sesión. Los movimientos registrados durante el conteo pueden afectar las diferencias calculadas."_

**Fase 2:** freeze de stock durante sesión activa (tabla `conteo_locks`).

---

## Transición de estados

```
[borrador] → [en_progreso] → [confirmado]
                ↓
           [cancelado]
```

- `borrador → en_progreso`: automático cuando se actualiza el primer `conteo_item`
- `en_progreso → confirmado`: al ejecutar `POST /confirmar` (solo admin)
- `borrador | en_progreso → cancelado`: al ejecutar `DELETE /:id`

---

## API — 6 endpoints

```
POST   /api/v1/conteo
  Body: { area_id }
  Acción: crea sesión en estado 'borrador' + genera conteo_items con snapshot de lotes activos del área
  Auth: tecnólogo, admin

GET    /api/v1/conteo
  Query: page, per_page, area_id?, estado?
  Respuesta: lista paginada de sesiones con progreso (contados/total)
  Auth: todos los roles

GET    /api/v1/conteo/:id
  Respuesta: sesión + array de conteo_items agrupados por producto
  Auth: todos los roles

PATCH  /api/v1/conteo/:id/items
  Body: [{ item_id, cantidad_contada, estado_item, version }]
  Acción: actualiza cantidades batch; valida version (optimistic lock); transiciona sesión a en_progreso si estaba en borrador
  Auth: tecnólogo, admin

POST   /api/v1/conteo/:id/confirmar
  Body: { nota?, idempotency_key }
  Acción: genera AJUSTE_POSITIVO/AJUSTE_NEGATIVO para items contados con diferencia ≠ 0; todo en una transacción
  Auth: solo admin

DELETE /api/v1/conteo/:id
  Acción: cancela sesión (solo si estado = borrador o en_progreso); no genera movimientos
  Auth: admin o usuario_creador
```

### Lógica de `confirmar`

Para cada `conteo_item` con `estado_item = 'contado'`:
- `diferencia = cantidad_contada - stock_sistema`
- Si `diferencia > 0` → insertar movimiento `AJUSTE_POSITIVO`, `origen = 'conteo'`
- Si `diferencia < 0` → insertar movimiento `AJUSTE_NEGATIVO`, `origen = 'conteo'`
- Si `diferencia = 0` → sin movimiento

Items con `estado_item = 'pendiente'` o `'no_contado'` no generan movimiento.

Guard de idempotencia: si la sesión ya está en `confirmado`, retorna 200 sin re-ejecutar.
Todo ejecutado en una sola transacción PostgreSQL.

**Nota:** `AJUSTE_POSITIVO` y `AJUSTE_NEGATIVO` ya existen en el CHECK constraint de `movimientos.tipo` (migration 001).

---

## Frontend

### `/conteo` — Lista de sesiones

- Layout de tarjetas verticales (no tabla)
- FAB "+" esquina inferior derecha para crear nueva sesión
- Badge de estado con color: amarillo=en_progreso, verde=confirmado, gris=cancelado
- Cada tarjeta: área, creador, fecha, barra de progreso (X/Y ítems contados)

### Modal de creación

- Selector de área (lista grande, fácil de tocar)
- Botón "Iniciar conteo" → crea sesión y navega al detalle

### Pantalla de conteo (mobile-first)

**Header sticky:**
- Nombre del área + fecha
- Barra de progreso: `X / Y ítems contados`

**Lista de ítems:**
- Agrupados por producto (sección colapsable)
- Cada lote = tarjeta con:
  - Nombre del producto (prominente, 16px+)
  - Número de lote + fecha de vencimiento
  - Stock sistema (secundario, pequeño)
  - Input numérico grande (`inputMode="decimal"`, teclado nativo)
  - Diferencia en tiempo real (verde=0, rojo=negativa, azul=positiva)
  - Botón "No contado" como toggle debajo del input

**Principios UX móvil:**
- Mínimo 48px de altura en todos los elementos tocables
- Teclado numérico nativo — sin spinners +/-
- Sin modales bloqueantes — todo en página o bottom sheet
- Diferencias visibles en color sin scroll adicional

### Bottom sheet de confirmación (solo admin)

```
Resumen de ajustes
──────────────────────────────────
✅ Sin diferencia:     28 ítems
🔴 Ajuste negativo:     4 ítems
🔵 Ajuste positivo:     2 ítems
⬜ No contados:          0 ítems
──────────────────────────────────
⚠️ [Si > 2h]: advertencia de movimientos concurrentes
──────────────────────────────────
Nota (opcional): [campo de texto]

[Cancelar]      [Confirmar ajustes]
```

---

## Puerta a Fase 2

El modelo actual soporta sin cambios de esquema:
- **Modo ciego:** ocultar `stock_sistema` en el frontend
- **Dual-unit:** agregar `cantidad_presentacion` + `presentacion_id` en `conteo_items`
- **Freeze stock:** agregar tabla `conteo_locks(lote_id, sesion_id)` activa durante sesión

---

## Archivos a crear

### Backend
- `backend/migrations/014_sesiones_conteo.sql`
- `backend/src/models/conteo.rs`
- `backend/src/dto/conteo.rs`
- `backend/src/handlers/conteo.rs`
- Registro de rutas en `backend/src/main.rs`

### Frontend
- `frontend/src/pages/conteo/index.tsx` — lista de sesiones
- `frontend/src/pages/conteo/detalle.tsx` — pantalla de conteo
- Tipos en `frontend/src/types/index.ts`
- Entrada en menú lateral (`App.tsx` o sidebar)

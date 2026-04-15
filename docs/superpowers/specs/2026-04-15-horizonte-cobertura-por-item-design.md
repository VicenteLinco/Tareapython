# Horizonte de Cobertura por Ítem — Spec de Diseño

**Fecha:** 2026-04-15  
**Rama objetivo:** `feat/solicitudes-compra-redesign`  
**Estado:** Aprobado, listo para implementar

---

## Resumen

Permite definir cuántos días de stock cubrir por cada ítem de una solicitud de compra, en lugar de usar un período fijo global. El sistema sugiere un horizonte inteligente por ítem basado en historial real, y el usuario puede ajustarlo con chips rápidos (7d / 15d / 30d / 90d / 180d / 365d). La decisión y su razón quedan persistidas para auditoría.

---

## Contexto y motivación

El sistema actual usa un `periodo_revision_dias` global (30 días) para calcular `cantidad_sugerida` en todas las recomendaciones. En la práctica, un pedido puede cubrir distintos horizontes:

- Pedido de emergencia: 7–15 días
- Pedido mensual habitual: 30 días  
- Pedido trimestral/anual: 90–365 días
- Distintos productos dentro del mismo pedido pueden necesitar horizontes distintos

El diseño anterior (selector global por pedido) no soporta mezclar horizontes en un mismo pedido. Este spec implementa el control por ítem.

---

## Factores considerados (y descartados)

**Incluidos:**
1. Ciclo histórico de pedidos al mismo proveedor
2. Variabilidad del consumo (coeficiente de variación semanal)
3. Lead time del proveedor como piso mínimo

**Descartados:**
- Vida útil / vencimiento: el proveedor entrega vencimientos variables en cada lote, no es una restricción confiable
- Precio unitario: la gestión financiera es responsabilidad de otra persona

---

## Algoritmo de horizonte sugerido

Se ejecuta al agregar cada ítem al carrito. Implementado en Rust (no en SQL) para facilitar testing y cambios futuros.

```
PASO 1 — Ciclo histórico
  Últimas 5 solicitudes guardadas/aprobadas que contengan este producto
  → promedio de días entre ellas = ciclo_dias
  → requiere al menos 2 solicitudes para activarse

PASO 2 — Ajuste por variabilidad de consumo
  CV = stddev(consumo_semanal_90d) / mean(consumo_semanal_90d)
  → CV < 0.3  → multiplicador 1.0  (consumo estable)
  → CV 0.3–0.7 → multiplicador 1.3  (variabilidad media)
  → CV > 0.7  → multiplicador 1.5  (consumo irregular)
  horizonte_ajustado = ciclo_dias × multiplicador

PASO 3 — Lead time como piso mínimo
  horizonte_final = MAX(horizonte_ajustado, lead_time × 1.5)

PASO 4 — Fallback (sin historial de solicitudes)
  horizonte_final = MAX(lead_time × 3, 30)
```

**Razón textual generada (para el badge en UI y persistida en DB):**

| Caso | Texto |
|------|-------|
| Con historial, consumo estable | `"ciclo histórico ~Xd con este proveedor"` |
| Con historial, variabilidad media | `"ciclo histórico ~Xd + buffer por consumo variable"` |
| Con historial, variabilidad alta | `"ciclo histórico ~Xd + buffer por consumo irregular"` |
| Sin historial | `"sin historial — estimación conservadora"` |

**Chip activado:** el chip con valor más cercano al `horizonte_final` calculado.  
Chips disponibles: 7 / 15 / 30 / 90 / 180 / 365 días.

---

## Modelo de datos

### Migración `042_horizonte_dias_solicitud.sql`

```sql
ALTER TABLE solicitud_compra_detalle
  ADD COLUMN horizonte_dias       INTEGER,
  ADD COLUMN horizonte_sugerido   INTEGER,
  ADD COLUMN horizonte_razon      TEXT;
```

- `horizonte_dias`: el horizonte activo. `NULL` indica que el usuario editó la cantidad manualmente (ningún chip activo).
- `horizonte_sugerido`: lo que calculó el sistema al agregar el ítem. Inmutable después de creado.
- `horizonte_razon`: texto del badge verde. Inmutable después de creado.

### Tipo frontend — `SolicitudItem` (types/index.ts)

Campos nuevos — horizonte:
```ts
horizonte_dias:     number | null   // null = cantidad editada manualmente
horizonte_sugerido: number | null   // calculado al agregar, no cambia
horizonte_razon:    string | null   // texto badge, no cambia
```

Campos nuevos — datos de fórmula (necesarios para recalcular cantidad al cambiar chip):
```ts
consumo_diario:  number   // de /horizonte o de ItemRecomendado
stock_actual:    number   // de /horizonte o de ItemRecomendado
stock_minimo:    number   // de /horizonte o de ItemRecomendado (stock_seguridad)
```

Estos tres campos ya están disponibles en `ItemRecomendado`. Para ítems del buscador, los devuelve el endpoint `/horizonte`.

### DTOs backend

`CreateSolicitudItem`:
```rust
horizonte_dias:     Option<i32>,
horizonte_sugerido: Option<i32>,
horizonte_razon:    Option<String>,
```

`SolicitudDetalleItem` (lectura):
```rust
horizonte_dias:     Option<i32>,
horizonte_sugerido: Option<i32>,
horizonte_razon:    Option<String>,
```

---

## API

### Endpoint nuevo: `GET /solicitudes-compra/horizonte`

**Query params:** `producto_id: UUID`, `proveedor_id: INT`

**Response 200:**
```json
{
  "horizonte_sugerido": 90,
  "razon": "ciclo histórico ~89d con este proveedor",
  "consumo_diario": 4.2,
  "stock_actual": 0,
  "stock_minimo": 100,
  "factores": {
    "ciclo_historico_dias": 89,
    "n_pedidos_historico": 4,
    "coeficiente_variacion": 0.21,
    "multiplicador_variabilidad": 1.0,
    "lead_time": 7
  }
}
```

`consumo_diario`, `stock_actual` y `stock_minimo` se incluyen para que el frontend pueda recalcular la cantidad al cambiar el chip sin necesitar otro endpoint.

`factores` es informativo — no se usa en UI pero disponible para debugging y analítica futura.

**Ruta registrada en `routes.rs`:** `.route("/horizonte", get(horizonte_sugerido))`

### Endpoints existentes actualizados

- `POST /solicitudes-compra` — acepta `horizonte_dias`, `horizonte_sugerido`, `horizonte_razon` en cada ítem
- `PUT /solicitudes-compra/:id` — ídem
- `GET /solicitudes-compra/:id` — devuelve los tres campos en cada `SolicitudDetalleItem`

---

## Frontend

### Nuevo componente: `HorizonteChips`

**Ubicación:** `frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx`

**Props:**
```ts
interface HorizonteChipsProps {
  horizonteDias: number | null        // activo actual (null = manual)
  horizonteSugerido: number | null    // sugerido por el sistema
  horizonteRazon: string | null       // texto del badge
  consumoDiario: number               // para calcular "cubre ~X días"
  cantidad: number                    // para calcular "cubre ~X días"
  onChipSelect: (dias: number) => void  // callback → el padre recalcula cantidad
}
```

**Chips disponibles:** `[7, 15, 30, 90, 180, 365]`

**Selección del chip más cercano:** `chips.reduce((prev, curr) => Math.abs(curr - horizonte_final) < Math.abs(prev - horizonte_final) ? curr : prev)`. En caso de empate exacto, se elige el valor mayor (más conservador).

**Comportamiento:**
- Chip activo: `horizonte_dias === valor_chip` → resaltado en primary
- Chip sugerido: `horizonte_sugerido === valor_chip` → indicador ★ verde
- Chip con ambos (activo y sugerido): muestra ambos indicadores
- Ningún chip activo (`horizonte_dias === null`): todos sin resaltar → modo manual
- "cubre ~X días": `consumoDiario > 0 ? Math.round(cantidad / consumoDiario) : null` — visible si hay consumo diario conocido

### Flujo al agregar un ítem

```
handleAddFromSearch(producto) o handleAddFromRec(rec):
  1. Llama GET /solicitudes-compra/horizonte?producto_id=X&proveedor_id=Y
  2. Calcula cantidad_inicial:
       cantidad = MAX(1, CEIL(
         stock_minimo + consumo_diario × (lead_time + horizonte_sugerido) - stock_actual
       ))
  3. Crea SolicitudItem con:
       horizonte_dias     = horizonte_sugerido (chip activo = el sugerido)
       horizonte_sugerido = horizonte_sugerido
       horizonte_razon    = razon
       cantidad           = cantidad_inicial
```

### Flujo al cambiar chip

```
onChipSelect(dias):
  1. Recalcula cantidad:
       cantidad = MAX(1, CEIL(
         stock_minimo + consumo_diario × (lead_time + dias) - stock_actual
       ))
  2. Actualiza item: horizonte_dias = dias, cantidad = nueva_cantidad
  (horizonte_sugerido y horizonte_razon NO cambian)
```

### Flujo al editar cantidad manualmente

```
handleUpdateQty(pid, val):
  Actualiza item: cantidad = val, horizonte_dias = null
  (chips se desactivan, "cubre ~X días" se actualiza)
```

### PDF

En la celda "Cantidad" de la tabla de ítems, si el ítem tiene `horizonte_dias` activo:

```
500 Cajas
= 50.000 Guantes
· cubre 90 días
```

Si `horizonte_dias` es null (manual):
```
500 Cajas
= 50.000 Guantes
```

---

## Flujo de persistencia

```
Usuario agrega ítem
  → Frontend: llama /horizonte, obtiene sugerencia
  → Frontend: calcula cantidad, guarda en estado local

Usuario ajusta chips o cantidades
  → Solo estado local (no persiste hasta guardar borrador)

Guardar borrador / Guardar solicitud
  → body incluye horizonte_dias, horizonte_sugerido, horizonte_razon por ítem
  → Backend persiste en solicitud_compra_detalle

Leer historial / detalle de solicitud
  → Backend devuelve los tres campos
  → Frontend muestra horizonte en modal de detalle (informativo, no editable)
```

---

## Archivos a crear o modificar

| Archivo | Acción |
|---------|--------|
| `backend/migrations/042_horizonte_dias_solicitud.sql` | Crear |
| `backend/src/handlers/solicitudes_compra.rs` | Modificar — nuevo handler `horizonte_sugerido`, actualizar DTOs y queries |
| `backend/src/dto/solicitudes_compra.rs` | Modificar — 3 campos en `CreateSolicitudItem` y `SolicitudDetalleItem` |
| `backend/src/routes.rs` | Modificar — registrar ruta `/horizonte` |
| `frontend/src/types/generated.ts` | Regenerar con `cargo run --bin export_types` |
| `frontend/src/types/index.ts` | Modificar — 3 campos en `SolicitudItem` |
| `frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx` | Crear |
| `frontend/src/pages/solicitudes-compra/index.tsx` | Modificar — integrar `HorizonteChips`, actualizar handlers, query `/horizonte` |
| `frontend/src/lib/solicitud-pdf.ts` | Modificar — mostrar horizonte en celda Cantidad |

---

## Lo que NO cambia

- La tabla `solicitudes_compra` no se modifica
- `periodo_revision_dias` de configuración sigue existiendo como fallback para el endpoint `/recomendaciones` (lista de quiebres), que no usa horizontes por ítem
- El flujo de borrador, guardado y aprobación no cambia
- Los ítems cargados desde borradores existentes (sin `horizonte_dias`) funcionan normalmente — los campos son `NULL` y los chips aparecen todos inactivos

# Spec: Rediseño de Solicitudes de Compra (Paso 2)

**Fecha:** 2026-04-15
**Branch:** `feat/solicitudes-compra-redesign`
**Archivo principal:** `frontend/src/pages/solicitudes-compra/index.tsx`

---

## Problema

En el paso 2 (proveedor seleccionado), la página tiene dos problemas de usabilidad:

1. **Scroll prematuro:** cada fila del pedido incluye inline los `HorizonteChips` (6 chips de 7/15/30/90/180/365d), lo que hace cada fila muy alta. Con solo 2 productos ya se necesita scroll.
2. **Quiebres de stock poco prominentes:** el panel de quiebres queda relegado debajo del `SolicitudBuscador` en un panel izquierdo angosto, sin suficiente presencia visual.

---

## Diseño acordado

### 1. Layout 20 / 80

El panel dual del paso 2 cambia de `w-[320px] / flex-1` a proporciones `20% / 80%`:

```
┌─────────────┬──────────────────────────────────────────┐
│  20%        │  80%                                     │
│  Tabs       │  Pedido (protagonista)                   │
│  Quiebres   │                                          │
│  Buscar     │                                          │
└─────────────┴──────────────────────────────────────────┘
```

CSS: `grid-template-columns: 20% 1fr`

### 2. Panel izquierdo — tabs Quiebres / Buscar

El panel izquierdo tiene dos pestañas:

- **Tab "⚠ Quiebres (N)"** — activa por defecto. Muestra la lista completa de quiebres ocupando todo el alto del panel. Badge rojo con el count.
- **Tab "🔍 Buscar"** — muestra el componente `SolicitudBuscador`.

Al cambiar de tab, el contenido se intercambia. No hay dos secciones apiladas.

### 3. Panel derecho — Pedido protagonista

#### 3a. Header del pedido — selector de horizonte global

Dentro del header del panel derecho, debajo del título "Pedido a {proveedor}", aparece el selector global:

```
Cubrir por:  [7d]  [15d]  [●30d]  [90d]  [180d]  [365d]
```

- Un chip seleccionado a la vez (estilo activo: `bg-primary text-primary-content`).
- Al seleccionar un chip, **todos los items sin personalizar** recalculan su cantidad con `calcularCantidad(horizonte, consumoDiario, leadTime, stockMinimo, stockActual)` y actualizan su pill de cobertura.
- El horizonte global tiene un valor por defecto de **30d**.
- Items con horizonte personalizado (`horizonte_personalizado: true`) **no se ven afectados** al cambiar el global.

#### 3b. Filas de items — compactas

Cada fila muestra, de izquierda a derecha:

1. Imagen del producto (si existe, `ProductoImage size="sm"`)
2. Nombre del producto (truncado)
3. Precio unitario + **pill de cobertura** (ver sección 4)
4. Control de cantidad `− [N] +`
5. Total del item (precio × cantidad)
6. Botón eliminar ✕ (visible en hover)

Los `HorizonteChips` **no aparecen inline** en la fila. Se eliminan de la vista principal.

### 4. Pill de cobertura por item

Cada item muestra una pill junto al precio que indica cuántos días cubre este pedido para ese producto.

#### Cálculo

```
// Si el item tiene presentación con factor_conversion:
días_cobertura = (cantidad * factor_conversion) / consumo_diario

// Si no (unidad base directa):
días_cobertura = cantidad / consumo_diario
```

`consumo_diario` está en unidades base. `cantidad` es la cantidad de presentaciones o unidades base según corresponda. Si `consumo_diario === 0`, mostrar `📅 Sin historial`.

El cálculo se ejecuta en tiempo real cada vez que `cantidad` cambia (botones −/+ o input manual).

#### Colores según estado y días de cobertura

Los items se dividen en dos estados: **siguiendo el global** (pill coloreada por días) y **personalizado** (siempre lila, independiente de cuántos días cubra).

**Items siguiendo el global** — color según `días_cobertura`:

| Días        | Color    | Clases Tailwind                               |
|-------------|----------|-----------------------------------------------|
| < 15        | Rojo     | `bg-error/10 text-error border-error/30`      |
| 15 – 29     | Amarillo | `bg-warning/10 text-warning border-warning/30`|
| 30 – 89     | Verde    | `bg-success/10 text-success border-success/30`|
| ≥ 90        | Azul     | `bg-info/10 text-info border-info/30`         |

**Items personalizados** — siempre lila, sin importar cuántos días cubran:

| Estado        | Color | Clases Tailwind                                         |
|---------------|-------|---------------------------------------------------------|
| Personalizado | Lila  | `bg-purple-500/10 text-purple-300 border-purple-500/30` |

#### Texto de la pill

- Item siguiendo el global: `📅 ~{días} días`
- Item personalizado: `📅 ~{días} días ✏`

Los días se recalculan en tiempo real al cambiar la cantidad con `−/+`.

### 5. Popover de ajuste por item (al hacer click en la pill)

Al hacer click en la pill de un item, se abre un pequeño popover con:

- Título: "Ajustar horizonte para este item"
- Los mismos 6 chips (7d / 15d / 30d / 90d / 180d / 365d)
- El chip activo actual resaltado
- El chip correspondiente al global marcado con `← global`
- Si el item está personalizado, una opción extra: `↩ Usar global ({N}d)`

Al seleccionar un chip distinto al global, el item queda marcado como `horizonte_personalizado: true` y su pill cambia a lila con ✏.

Al elegir `↩ Usar global`, se resetea `horizonte_personalizado: false` y la pill vuelve a verde/amarillo/rojo/azul según el global.

---

## Estado del item en memoria

Cada `SolicitudItem` necesita un campo adicional en memoria local (no se persiste en el borrador):

```typescript
horizonte_personalizado?: boolean   // true = override del global; false o undefined = sigue el global
```

El campo `horizonte_dias` existente almacena el valor efectivo (global o personalizado).

---

## Componentes a modificar

| Archivo | Cambio |
|---------|--------|
| `index.tsx` | Layout 20/80, tabs izquierda, header con selector global, lógica de horizonte global |
| `index.tsx` — filas de items | Quitar `HorizonteChips` inline, añadir pill de cobertura + popover |
| `components/horizonte-chips.tsx` | Reutilizar la lógica de chips dentro del nuevo popover por item |

---

## Comportamiento del horizonte global al agregar items

Cuando se agrega un item nuevo (desde quiebres o buscador), su cantidad inicial se calcula usando el **horizonte global activo en ese momento**. El item nace sin `horizonte_personalizado`.

---

## Reglas de interacción — tabla de decisión

| Acción del usuario | Efecto en `cantidad` | Efecto en `horizonte_dias` | Pill resultante |
|--------------------|----------------------|----------------------------|-----------------|
| Selecciona chip global (ej: 30d) | Recalcula todos los items sin `horizonte_personalizado` | Se actualiza en todos sin personalizar | Verde/amarillo/rojo/azul según días |
| Cambia qty con −/+ en un item | No cambia | No cambia | Recalcula días desde qty actual; color según resultado; **sin ✏** |
| Selecciona chip en popover de item (distinto al global) | Recalcula qty para cubrir esos días | Se actualiza solo ese item | Lila ✏ |
| Elige "↩ Usar global" en popover de item | Recalcula qty para cubrir el global | Vuelve al valor global | Verde/amarillo/rojo/azul |
| Agrega item desde quiebres | Cantidad calculada con horizonte global | Igual al global | Verde/amarillo/rojo/azul |
| Agrega item desde buscador | Cantidad calculada con horizonte global | Igual al global | Verde/amarillo/rojo/azul |

La pill siempre muestra los días reales calculados desde `cantidad` actual, no el valor fijo de `horizonte_dias`. Así, si el usuario sube manualmente la qty de 10 a 25 cajas, la pill refleja la cobertura real aunque `horizonte_dias` siga en 30.

---

## Panel izquierdo — tab Quiebres

Cada quiebre en la lista muestra:

1. Barra de color izquierda según urgencia: rojo (crítica), amarillo (alta), azul (media)
2. Nombre del producto
3. Nivel de urgencia + stock actual / stock de seguridad
4. Cantidad sugerida calculada con el horizonte global activo
5. Botón **"+ Agregar"**

Al hacer click en "Agregar":
- El item se añade al pedido con cantidad calculada para el horizonte global
- El quiebre queda **opaco con ✓** en la lista para indicar que ya está en el pedido
- El botón se deshabilita (no permite doble agregado)

Si el horizonte global cambia después de haber agregado el item, el item en el pedido se recalcula igual que cualquier otro item sin `horizonte_personalizado`.

---

## Lo que NO cambia

- El paso 1 (selección de proveedor) no se modifica.
- La vista de historial no se modifica.
- El footer del pedido (costo estimado + botones Guardar / Borrador) no cambia.
- La lógica de persistencia del borrador (`/solicitudes-compra/borrador`) no cambia.
- El banner del proveedor no cambia.

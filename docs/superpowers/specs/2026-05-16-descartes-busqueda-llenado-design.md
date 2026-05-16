# Diseño: Mejora de búsqueda y llenado de lista en Descartes

**Fecha:** 2026-05-16  
**Página:** `/descartes` → tab "Nuevo descarte"  
**Archivo principal:** `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

---

## Problema

El flujo actual tiene pasos redundantes: el usuario busca un producto, elige del dropdown, la tabla se "pinca" al ítem seleccionado, y recién entonces hace click en la fila para agregarlo al carrito. Son dos selecciones para el mismo ítem.

---

## Solución adoptada: **Opción A — Dropdown agrega al carrito directamente** ✅ *Recomendada*

El dropdown pasa de ser un filtro de tabla a ser una **acción de agregar**. Al seleccionar un producto del dropdown, todos sus lotes disponibles en el stock filtrado se agregan al carrito de inmediato.

---

## Diseño detallado

### 1. Dropdown: entradas por producto (no por lote)

Las sugerencias del dropdown se agrupan por producto en lugar de mostrar lotes individuales.

```
┌─────────────────────────────────────────────┐
│ + Glucosa 5%        2 lotes · 3 áreas       │
│ + Glucosa 10%       1 lote · Urgencias      │
│ + Gluconato Ca      1 lote · UCI            │
└─────────────────────────────────────────────┘
```

**Comportamiento al seleccionar un producto:**
- Todos los lotes de ese producto presentes en `filteredStock` se agregan al carrito (`items`)
- Los lotes que ya estaban en el carrito no se duplican
- El input de búsqueda se limpia
- La tabla vuelve a mostrar todos los ítems sin pin
- El motivo se auto-asigna: `vencido` si `daysUntil < 0`, `dañado` si no

**Los filtros activos se respetan:** si el usuario filtró por Área UCI, solo se agregan los lotes de ese producto en UCI.

**Eliminación del `selectedSearchStockKey`:** ya no se necesita "pincar" la tabla a un solo ítem. Este estado se elimina.

---

### 2. Sugerencias sin escribir (recomendaciones automáticas) ✅ *Recomendada*

Al hacer foco en el input **sin haber escrito nada**, el dropdown muestra los ítems más urgentes de descartar:

```
┌─────────────────────────────────────────────┐
│  Sugeridos para descartar                   │
│  ─────────────────────────────────────────  │
│  🔴 Amoxicilina 500mg   vencido hace 12d    │
│  🔴 Glucosa 5%          vencido hace 8d     │
│  🔴 Heparina 5000u      vencido hace 3d     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─     │
│  Busca por nombre o lote para agregar más   │
└─────────────────────────────────────────────┘
```

**Criterios de selección de recomendados:**
- Solo ítems con `daysUntil < 0` (ya vencidos)
- Ordenados por `daysUntil` ascendente (más vencidos primero)
- Máximo 6 entradas, agrupadas por producto (igual que búsqueda)
- Respetan los filtros activos de área/proveedor

**Al escribir**, las recomendaciones se reemplazan por los resultados de búsqueda normales.

**Al hacer click en una recomendación**, el comportamiento es idéntico al de cualquier sugerencia de búsqueda: agrega todos los lotes del producto al carrito.

---

### 3. Tabla y carrito: sin cambios estructurales

- **La tabla** sigue mostrando todos los ítems vencidos/filtrados. Ya no actúa como resultado de búsqueda pinado.
- Los ítems agregados vía dropdown aparecen con el checkbox marcado en la tabla.
- Hacer click en una fila sigue agregando/quitando ítems manualmente (sin cambios).
- **El carrito** muestra cada lote como ítem separado con sus controles de cantidad y motivo. Sin cambios de estructura.

---

## Flujo completo resultante

```
1. Usuario abre el input de búsqueda
   → dropdown muestra hasta 6 productos más urgentes (ya vencidos)

2a. Usuario hace click en una recomendación
    → todos los lotes de ese producto se agregan al carrito
    → input se limpia, listo para la próxima búsqueda

2b. Usuario escribe "amox"
    → dropdown muestra "Amoxicilina 500mg · 2 lotes · Farmacia, UCI"
    → click → ambos lotes se agregan al carrito

3. Usuario ajusta cantidades o desmarca lotes desde la tabla si hace falta

4. Confirmar descarte
```

---

## Cambios en el código

| Archivo | Cambio |
|---------|--------|
| `nuevo-descarte-tab.tsx` | Eliminar `selectedSearchStockKey` y `selectedSearchQuery`. Eliminar el parámetro `q` del call a `useDescartesStock` (la búsqueda pasa a ser 100% client-side). Reescribir `searchSuggestions` para agrupar por producto. Agregar `recommendedSuggestions` (ítems vencidos del stock sin filtro de texto). Reescribir `selectSearchItem` para agregar todos los lotes del producto al carrito. |
| `use-descartes-stock.ts` | Sin cambios |

### Decisión: búsqueda client-side vs server-side

Con el nuevo diseño, la búsqueda pasa a ser **100% client-side** sobre el `filteredStock` ya cargado:

- **Antes:** `useDescartesStock` recibía `q` y enviaba el término al servidor (`/stock/lotes-vencidos?q=...`).
- **Después:** `useDescartesStock` solo recibe `areaId`, `proveedorId` y `diasAlerta`. El cliente filtra localmente para el dropdown.

**Justificación:** Los ítems vencidos son pocos (~decenas, no miles). Cargar todos y filtrar en el cliente es suficiente, y es necesario para que las recomendaciones (que no tienen texto de búsqueda) y las sugerencias usen el mismo dataset. Eliminar `q` simplifica el código y evita hacer un request por tecla.

### Agrupación por producto en el dropdown

El tipo `DescarteVencidoItem` no expone `producto_id`. La agrupación se hace por `producto_nombre` (string). Si dos presentaciones distintas tuvieran el mismo nombre, quedarían agrupadas — caso que no ocurre en la práctica con los datos del sistema.

---

## Casos borde

- **Producto con todos los lotes ya en el carrito:** el click no hace nada (todos ya existen, no se duplican). Opcionalmente mostrar feedback visual.
- **Filtros activos limitan a 0 lotes del producto:** no debería ocurrir porque el dropdown solo muestra productos que tienen lotes en `filteredStock`.
- **Input vacío y sin vencidos:** el dropdown no se abre (no hay recomendaciones que mostrar).

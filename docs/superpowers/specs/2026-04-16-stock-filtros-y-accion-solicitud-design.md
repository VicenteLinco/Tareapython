# Stock — Simplificación de Filtros, Acción Solicitud y Detalle Móvil — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Alta
**Estado:** Propuesto

---

## Problema

En `frontend/src/pages/stock/index.tsx`:

1. **Filtros opacos.** Coexisten tres controles que modifican el mismo resultado: checkbox "Con Alertas", checkbox "Stock Bajo" y query param `?filter=critico|bajo` (usado por navegación desde Dashboard). Sus combinaciones no están documentadas y la UI no refleja cuál "gana".
2. **Detalle lateral sin retorno en móvil.** El panel `StockDetail` ocupa `lg:col-span-7`; en viewports pequeños probablemente oculta la lista sin un "atrás" claro.
3. **Acción "Crear solicitud" ausente.** Desde Dashboard se puede navegar a Stock con items críticos, pero una vez ahí no hay un CTA para generar solicitud de compra. El usuario debe cambiar de sección y buscar los productos otra vez.

## Objetivo

- Un único criterio de filtro por estado de stock, consistente entre URL y UI.
- En móvil, la vista de detalle es navegable (entrar / volver).
- Desde la lista de stock bajo se puede iniciar una solicitud de compra pre-cargada.

## Alcance

**Incluido:**
- Reemplazar los dos checkboxes por un único selector (`Todos | Normal | Stock bajo | Crítico | Sin stock`).
- Sincronizar el selector con el query param `?filter=`.
- Botón flotante/acción "Crear solicitud con N items" cuando el filtro muestra stock bajo/crítico.
- Transición móvil: al seleccionar un item, la lista se reemplaza por el detalle; botón "← Volver" en el header del detalle.

**Fuera de alcance:**
- Cambiar el cálculo de stock bajo/crítico (ya existe).
- Cambiar el flujo completo de solicitudes-compra (ver spec dedicado).

## Diseño propuesto

### UI

**Selector único de estado:**
- Combobox/tabs con 5 valores: `todos`, `normal`, `bajo`, `critico`, `sin_stock`.
- Default: `todos`.
- Query param: `?estado=critico` (renombrar de `filter=` a `estado=` para dejar el param libre a futuros usos; mantener compatibilidad leyendo ambos por 1 release).

**Acción "Crear solicitud":**
- Cuando el filtro activo es `bajo` o `critico` (o ambos):
  - Barra inferior sticky: `"N items con stock bajo. [Crear solicitud]"`.
  - Click: navega a `/solicitudes-compra/nueva?prefill=<ids>` con los IDs visibles tras filtro.
- En Solicitudes-Compra, leer `prefill` y agregar cada producto al carrito con su cantidad sugerida.

**Detalle móvil:**
- Breakpoint `<lg`: al clickear un item, la lista se oculta (`hidden lg:block`) y el detalle ocupa el viewport completo.
- Header del detalle: botón `← Volver` que setea `selectedId = null`.
- Si `selectedId !== null` en móvil: render solo detalle; en desktop: render ambos.

### Lógica

```ts
// Lectura del filtro — compatibilidad temporal
const estadoParam = searchParams.get('estado') ?? searchParams.get('filter') ?? 'todos'
const estadoValido = ['todos','normal','bajo','critico','sin_stock'].includes(estadoParam)
  ? estadoParam
  : 'todos'
```

Query al backend: pasar `estado=<valor>` directamente como filtro único (el backend ya soporta `solo_alertas` y `solo_criticos`; consolidar a un solo parámetro `estado`).

## Archivos afectados

**Frontend:**
- `frontend/src/pages/stock/index.tsx` (selector, acción, lectura de query)
- `frontend/src/pages/stock/components/stock-detail.tsx` (header con back en móvil)
- `frontend/src/pages/dashboard/index.tsx` (navegar con `?estado=` en lugar de `?filter=`)
- `frontend/src/pages/solicitudes-compra/index.tsx` (leer `prefill` y precargar)

**Backend:**
- `backend/src/handlers/stock.rs` (aceptar `estado` como filtro único, deprecar `solo_alertas`/`solo_criticos` manteniendo compatibilidad por un release)

## Criterios de aceptación

- [ ] Llegar a `/stock` desde Dashboard con `?filter=critico` muestra el selector en "Crítico" (compatibilidad).
- [ ] Cambiar el selector actualiza el query param y la lista.
- [ ] Con filtro `bajo` o `critico` aparece barra inferior con CTA "Crear solicitud".
- [ ] Click en CTA navega a Solicitudes con items precargados (cantidad sugerida = alerta mínima).
- [ ] En móvil, clickear un item muestra solo el detalle; "Volver" regresa a la lista.
- [ ] Los dos checkboxes antiguos ya no existen.

## Preguntas abiertas

- Cantidad precargada para "prefill": ¿`cantidad_minima - stock_actual` o la sugerencia del algoritmo de horizonte (si está disponible)? → Propongo el algoritmo de horizonte si el proveedor está identificado, sino la diferencia simple.
- El `prefill` puede traer productos sin proveedor preferente. ¿Obligar al usuario a seleccionar proveedor primero antes del prefill, o agrupar por proveedor preferente en la query? → Propongo obligar al usuario a elegir proveedor; los IDs prefill se aplican tras esa selección.

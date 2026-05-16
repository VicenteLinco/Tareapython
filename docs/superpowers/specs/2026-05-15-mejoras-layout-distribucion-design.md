# Spec: Mejoras de Layout y Distribución — Sistema Inventario 2026

**Fecha:** 2026-05-15  
**Alcance:** Frontend completo (8 páginas principales + layout global)  
**Objetivo:** Hacer que la densidad de información del sistema sea navegable y consistente; aprovechar el espacio real en pantallas grandes; mantener la experiencia móvil/tablet donde ya existe.

---

## Principios de diseño

1. **Keyboard-first, mouse-friendly.** El sistema ya es keyboard-heavy en consumos y stock. Extender ese patrón, no contradecirlo.
2. **Densidad navegable.** No simplificar la información — hacerla accesible con jerarquía visual clara.
3. **Consistencia sobre novedad.** Mismo componente para el mismo problema en todas las páginas.
4. **Progressive disclosure.** Lo más importante siempre visible; lo avanzado, a un click.
5. **Pantalla grande primero, mobile donde importa.** Desktop `lg+` es el contexto principal. Recepciones y Consumos necesitan buen soporte `md` / mobile también.

---

## 1. Sistema global de filtros unificado

### Problema
Cada página implementa su propio filtro a mano. Stock usa barra inline con 6 controles en una fila. Movimientos suma date pickers, selects y toggles en desorden. Recepciones usa un `fieldset`. No hay componente compartido.

### Diseño

Crear un componente `FilterBar` reutilizable con dos zonas:

**Zona primaria** (siempre visible, una fila):
- Input de búsqueda (siempre el primero)
- El filtro contextual más relevante de la página (Área en Stock/Consumos, Estado en Recepciones)
- Botón "Más filtros ▾" — contador de filtros activos como badge
- Acciones de vista (toggle lista/grilla, export CSV) en el extremo derecho

**Zona secundaria** (se expande debajo al clicar "Más filtros"):
- Grid de 2-3 columnas con los filtros adicionales (selects, date pickers)
- Botón "Limpiar filtros" al final
- Se cierra con Escape o clic fuera

**Quick-filter chips** (debajo de la zona primaria cuando existen):
- Chips de estado rápido: Crítico, Sin stock, Por vencer, etc.
- Son filtros de un click, no reemplazan los selects
- Se muestran como pills seleccionables (toggle)

### Páginas afectadas
Stock, Recepciones, Movimientos, Conteo, Audit Log.

### Breakpoints
- `lg+`: zona primaria en una fila, zona secundaria en grid 3 columnas
- `md`: zona primaria en una fila (sin algunos controles), zona secundaria en grid 2 columnas
- `sm`: zona primaria apilada, zona secundaria en columna única

---

## 2. Consumos — panel lateral en desktop

### Problema
El drawer colapsable al fondo funciona bien en móvil pero en desktop (pantalla grande) obliga al usuario a alternar entre catálogo y carrito cuando podría ver ambos simultáneamente.

### Diseño

**`lg+` — layout de dos columnas fijas:**

```
┌─────────────────────────────┬──────────────────────────┐
│  Búsqueda + autocomplete   │  CARRITO                 │
│  ─────────────────────────  │  ─────────────────────── │
│  Recientes / Resultados     │  Item 1    x2   [-][+]   │
│  (grilla de productos)      │  Item 2    x1   [-][+]   │
│                             │  ─────────────────────── │
│                             │  Área: [select]          │
│                             │  Notas: [textarea]       │
│                             │  ─────────────────────── │
│                             │  [Confirmar consumo]     │
└─────────────────────────────┴──────────────────────────┘
```

- Columna izquierda: 60% del ancho disponible
- Columna derecha: 40%, sticky en scroll
- El panel derecho muestra estado vacío con CTA cuando el carrito está vacío
- Contador de items en el header del panel ("Carrito (3)")

**`md` y `sm` — drawer colapsable existente sin cambios.** El layout de dos columnas se activa solo en `lg+` mediante un `hidden lg:grid`.

### Detalles de interacción
- Agregar un producto desde la columna izquierda hace scroll automático al item en el panel derecho
- El selector de lote y las notas se muestran inline en cada item del carrito, no en modal
- El botón "Confirmar" tiene estado deshabilitado con tooltip cuando el carrito está vacío

---

## 3. Stock — filtros secundarios colapsables + chips reorganizados

### Problema
La barra de filtros tiene búsqueda + 3 selects + estado dropdown + toggle lista/grilla en una sola fila. Los chips de estado rápido están mezclados en la misma zona.

### Diseño

Aplicar el componente `FilterBar` del punto 1:

**Zona primaria:** búsqueda + select Área + "Más filtros ▾" (con badge si Categoría/Proveedor/Estado están activos) + toggle lista/grilla

**Zona secundaria (expandible):** Categoría + Proveedor + Estado — en grid 3 columnas

**Quick-filter chips** debajo de la zona primaria: Crítico | Stock bajo | Sin stock | Por vencer | Normal — siempre visibles como pills

El panel de detalle lateral se mantiene exactamente igual (es buen patrón, no cambiar).

---

## 4. Recepciones — maestro-detalle como Stock

### Problema
Al hacer click en una recepción navega a otra página. En desktop con espacio disponible, esto rompe el flujo innecesariamente.

### Diseño

**`lg+` — layout maestro-detalle:**

```
┌────────────────────────────────┬─────────────────────────┐
│  [Borradores][Confirmadas][Todas]│  DETALLE RECEPCIÓN     │
│  FilterBar                     │  ─────────────────────  │
│  ─────────────────────────────  │  Proveedor, fecha       │
│  Tabla de recepciones           │  Estado badge + acciones│
│  (fila seleccionada resaltada)  │  ─────────────────────  │
│                                │  Items recibidos (lista) │
│                                │  ─────────────────────  │
│                                │  [Confirmar] [Eliminar]  │
└────────────────────────────────┴─────────────────────────┘
```

- Panel derecho: 38% del ancho, sticky, aparece al seleccionar una fila
- Sin selección: estado vacío "Seleccioná una recepción para ver el detalle"
- Las acciones (confirmar borrador, eliminar borrador) viven en el panel, no en la fila de la tabla
- La tabla pierde la columna de acciones (ya están en el panel)

**`md` y `sm`:** click en fila navega a página de detalle (comportamiento actual).

### Ruta /recepciones/:id
Sigue existiendo y siendo accesible directamente (deep link, mobile). El panel maestro-detalle es una mejora desktop, no reemplaza la ruta.

---

## 5. Creador de Productos — lista + form inline por tab

### Problema
Cada uno de los 6 tabs abre modales para crear/editar. Los modales interrumpen el contexto y en desktop hay espacio de sobra para mostrar todo en pantalla.

### Diseño

**`lg+` — layout de dos columnas por tab:**

```
┌─────────────────────────────┬──────────────────────────┐
│  [Buscar...]  [+ Nuevo]     │  EDITAR / CREAR           │
│  ─────────────────────────  │  ─────────────────────── │
│  Item 1            →        │  Nombre: [input]         │
│  Item 2            →        │  Categoría: [select]     │
│  Item 3   (selected) ●      │  ...                     │
│                             │  [Guardar]  [Cancelar]   │
└─────────────────────────────┴──────────────────────────┘
```

- Columna izquierda: 45%, lista con búsqueda inline y botón "Nuevo"
- Columna derecha: 55%, formulario de edición/creación
- Clicar "Nuevo" limpia el form y muestra formulario vacío
- Clicar un ítem puebla el form con sus datos
- "Guardar" / "Cancelar" en el form de la derecha
- Confirmación de eliminar: inline en el panel (no modal separado)

**`md` y `sm`:** lista completa, modales para crear/editar (comportamiento actual).

### Tabs afectados
Todos: Productos, Categorías, Unidades, Áreas, Proveedores, Presentaciones. El patrón es idéntico en todos.

---

## 6. Dashboard — tres zonas con jerarquía clara

### Problema
Alertas y métricas tienen el mismo peso visual. Los botones de acción están sueltos. El banner de alertas debería dominar visualmente cuando hay urgencias.

### Diseño

**Zona 1 — Alertas (condicional, full width):**
- Visible solo si hay alertas activas
- Fondo color según urgencia (destructive si hay sin stock/vencidos, warning si hay stock bajo)
- Lista compacta de alertas con botón de acción directo por cada una
- Colapsable: se puede ocultar con una X (preferencia guardada en localStorage por sesión)

**Zona 2 — Métricas (grid fijo 4 columnas en `lg+`, 2 en `md`, 1 en `sm`):**
- Mismas 4 cards actuales
- Sin la animación ping (se mueve a Zona 1)
- Cards clickeables: llevan a Stock con el filtro correspondiente preapicado

**Zona 3 — Acceso rápido (fila de acciones, siempre visible):**
- 4 botones grandes con icono + label: Registrar consumo | Nueva recepción | Nuevo descarte | Nueva solicitud
- En mobile se convierten en grid 2x2
- Son los 4 flujos operativos más frecuentes del laboratorio

### Jerarquía visual resultante
1. ¿Hay urgencias? → Zona 1 domina
2. ¿Cómo está el inventario hoy? → Zona 2 responde
3. ¿Qué quiero hacer? → Zona 3 facilita

---

## 7. Movimientos — panel de filtros lateral colapsable

### Problema
6-7 controles de filtro en línea (fecha inicio, fecha fin, área, tipo, granularidad, agrupar por) hacen la página muy densa y dejan poco espacio para el contenido.

### Diseño

**Panel lateral izquierdo colapsable:**

```
┌──────────────────┬──────────────────────────────────────┐
│  FILTROS    [×]  │  Historial / Tendencias tabs          │
│  ────────────    │  ─────────────────────────────────── │
│  Desde: [date]   │  Tabla de movimientos                 │
│  Hasta:  [date]  │  o                                   │
│  Área: [select]  │  Gráfico Recharts                    │
│  Tipo: [select]  │                                      │
│  Granularidad    │                                      │
│  Agrupar por     │                                      │
│  ────────────    │                                      │
│  [Limpiar]       │                                      │
│  [Aplicar]       │                                      │
└──────────────────┴──────────────────────────────────────┘
```

- Botón "Filtros" con badge de filtros activos en la toolbar principal
- Panel: 280px fijo, colapsable con transición suave
- Por defecto: abierto en `>=1400px`, cerrado en `<1400px`
- "Aplicar" aplica todos los filtros de una vez (evita re-fetch en cada cambio)
- Botón de descarga CSV permanece en la toolbar principal

**`md` y `sm`:** filtros en un sheet/drawer desde el fondo (patrón mobile-friendly).

---

## 8. Sidebar — tooltips en modo colapsado

### Problema
Cuando el sidebar está colapsado (60px), los íconos solos son ambiguos para usuarios que no conocen bien el sistema.

### Diseño
- `Tooltip` de shadcn/ui en cada ítem de navegación cuando el sidebar está colapsado
- `delayDuration={0}` — sin delay, aparece inmediato en hover
- Side: `"right"` — tooltip aparece a la derecha del ícono
- Contenido: solo el nombre del módulo (ej. "Stock", "Consumos")
- Cuando el sidebar está expandido: tooltips desactivados (el label ya es visible)

Implementación: envolver cada `<NavItem>` en un `<TooltipProvider><Tooltip>` condicional basado en `isSidebarCollapsed`.

---

## 9. Solicitudes de compra — mejoras de flujo

### Estado actual
El módulo ya tiene buen diseño (tabs Sugeridos / Por proveedor, panel de revisión). Las mejoras son menores.

### Diseño

**Tab "Sugeridos":**
- Aplicar `FilterBar` del punto 1 (búsqueda + "Más filtros" con categoría/proveedor)
- Los controles de horizonte/configuración van a la zona secundaria expandible

**Tab "Por proveedor":**
- Mantener estructura actual (acordeón por proveedor)
- El banner de proveedor (`proveedor-banner`) se beneficia del mismo sistema de chips de estado

**Panel de revisión:**
- Sin cambios estructurales (ya es correcto)

---

## Componentes nuevos o modificados

| Componente | Estado | Descripción |
|---|---|---|
| `FilterBar` | Nuevo | Zona primaria + secundaria expandible + quick-filter chips |
| `MasterDetailLayout` | Nuevo | Wrapper responsive para patrón maestro-detalle (Stock ya lo tiene, abstraer) |
| `TwoColumnFormLayout` | Nuevo | Wrapper para lista + form inline (Creador de Productos) |
| `SideFilterPanel` | Nuevo | Panel lateral colapsable para Movimientos |
| `ConsumosDesktopLayout` | Nuevo (o modificar `index.tsx`) | Wrapper responsive que activa panel lateral en `lg+` |
| `DashboardAlertBanner` | Nuevo | Banner full-width de alertas urgentes |
| `NavItem` (sidebar) | Modificar | Agregar Tooltip condicional cuando sidebar colapsado |

---

## Páginas sin cambios

- **Descartes:** ya tiene buen layout de dos tabs simples
- **Conteo:** layout de cards + modal es adecuado
- **Usuarios:** tabla + modal es correcto para administración puntual
- **Configuración:** formulario vertical simple es lo correcto
- **Kiosk / QR / Scan:** pantallas especializadas, no tocar

---

## Orden de implementación recomendado

1. **`FilterBar` unificado** — base para todo lo demás; desbloquea Stock, Recepciones, Movimientos
2. **Sidebar tooltips** — cambio menor, impacto inmediato
3. **Dashboard tres zonas** — alta visibilidad, relativamente simple
4. **Consumos panel desktop** — impacto en la operación más frecuente
5. **Recepciones maestro-detalle** — requiere `MasterDetailLayout`
6. **Movimientos panel lateral** — requiere `SideFilterPanel`
7. **Creador de Productos inline form** — más amplio pero el patrón es consistente

---

## Criterios de éxito

- Stock y Consumos operables sin scroll horizontal en 1920x1080
- Ninguna página tiene más de 3 controles de filtro visibles simultáneamente sin acción del usuario
- El mismo patrón visual de filtros en todas las páginas (FilterBar)
- Consumos en desktop: carrito y catálogo visibles al mismo tiempo
- Dashboard: alertas críticas imposibles de ignorar
- Sidebar colapsado: cualquier ícono identificable sin expandir

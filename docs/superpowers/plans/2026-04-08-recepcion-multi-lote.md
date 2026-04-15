# Recepción Multi-Lote — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el item-card de recepciones para agrupar múltiples lotes del mismo producto en una sola tarjeta colapsable, eliminando la necesidad de buscar el mismo producto dos veces.

**Architecture:** Solo frontend. `item-card.tsx` se reescribe con interfaz `LoteLineUI` (una fila por lote) y `DetalleLineUI` (card con arreglo de lotes + estado `collapsed`). `nueva.tsx` incorpora tres handlers nuevos y actualiza `handleConfirmar` con `flatMap`. `labels-section.tsx` aplana lotes internamente. El backend no cambia: sigue recibiendo el mismo array plano de lotes.

**Tech Stack:** React 19 + TypeScript + Tailwind + DaisyUI. No hay cambios en Rust ni SQL.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `frontend/src/pages/recepciones/components/item-card.tsx` | Reescritura | Interfaces `LoteLineUI`/`DetalleLineUI`, helpers `isLoteComplete`/`isCardComplete`, sub-componente `LoteRow`, lógica de colapso automático, precio formateado |
| `frontend/src/pages/recepciones/nueva.tsx` | Modificar | Nuevos handlers `handleChangeLote`/`handleAddLote`/`handleRemoveLote`, `addProducto` con lote inicial, `handleConfirmar` con `flatMap` |
| `frontend/src/pages/recepciones/components/labels-section.tsx` | Modificar | Recibe `detalles: DetalleLineUI[]`, aplana lotes internamente, callbacks actualizados `onToggleEtiqueta`/`onCantidadEtiqueta` con `loteId` |
| `frontend/src/pages/recepciones/components/producto-autocomplete.tsx` | Modificar | Añadir `proveedorId?` para filtrar, hacer `onScannerOpen` opcional, scroll automático al ítem activo |
| `frontend/src/pages/recepciones/components/lote-bottom-sheet.tsx` | Crear | Bottom sheet móvil para ingresar datos de lote (bonus no en spec original) |
| `frontend/src/pages/recepciones/components/scanner-panel.tsx` | Crear | Panel de cámara QR reutilizable en nueva recepción (bonus no en spec original) |

---

## Tarea 1: Reescritura de `item-card.tsx`

**Archivos:**
- Reescribir: `frontend/src/pages/recepciones/components/item-card.tsx`

- [x] **Definir interfaces `LoteLineUI` y `DetalleLineUI` exportadas**

```ts
export interface LoteLineUI {
  id: string
  codigo_lote: string
  fecha_vencimiento: string
  cantidad_presentacion: number
  incluir_etiqueta: boolean
  cantidad_etiquetas: number
}

export interface DetalleLineUI {
  id: string
  producto_id: string
  producto_nombre: string
  codigo_interno: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
  precio_unitario: string     // string de dígitos, ej: "4850"
  imagen_url?: string | null
  cantidad_solicitada?: number | null
  lotes: LoteLineUI[]
  collapsed: boolean
}
```

- [x] **Exportar helpers de completitud**

```ts
export function isLoteComplete(l: LoteLineUI): boolean {
  return !!(l.codigo_lote && l.fecha_vencimiento)
}

export function isCardComplete(d: DetalleLineUI): boolean {
  return !!(d.area_destino_id && d.lotes.length > 0 && d.lotes.every(isLoteComplete))
}
```

- [x] **Implementar `formatPrecioDisplay` (precio con separador de miles)**

```ts
function formatPrecioDisplay(raw: string, simbolo: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return `${simbolo}${Number(digits).toLocaleString('es-CL')}`
}
```

- [x] **Implementar sub-componente `LoteRow`**

Columnas: número índice (readonly) | input código lote | input fecha vencimiento | input cantidad + unidad | botón eliminar (visible solo si `canDelete`).

- [x] **Implementar `ReceptionItemCard` con lógica de colapso**

- Header siempre visible: imagen, nombre, código, área (o select si no asignada), badge ✓/⚠, botón expand/collapse, botón eliminar card.
- Resumen en header cuando `collapsed`: "N lotes · X cajas · $4.850"
- Body expandido: selector de presentación (si hay >1), hint de cantidad solicitada, cabecera de columnas, filas `LoteRow`, botón "Agregar lote distinto", campo precio unitario.
- `complete = isCardComplete(d)` → borde verde si completo, amarillo si no.

- [x] **Precio: focus muestra dígitos, blur muestra formateado**

```tsx
value={precioFocus
  ? rawPrecio
  : rawPrecio ? formatPrecioDisplay(rawPrecio, monedaSimbolo) : ''
}
onFocus={() => setPrecioFocus(true)}
onBlur={() => setPrecioFocus(false)}
onChange={e => onChange(d.id, { precio_unitario: e.target.value.replace(/\D/g, '') })}
```

- [x] **Verificar TypeScript**

```bash
cd "C:\Users\Desarrollo\Documents\14 marzo inventario\frontend"
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errores en `item-card.tsx`.

---

## Tarea 2: Actualizar `nueva.tsx`

**Archivos:**
- Modificar: `frontend/src/pages/recepciones/nueva.tsx`

- [x] **Actualizar `addProducto` para crear card con lote inicial vacío**

```ts
const line: DetalleLineUI = {
  // ... campos existentes
  lotes: [{
    id: uuidv4(),
    codigo_lote: '',
    fecha_vencimiento: '',
    cantidad_presentacion: overrideQuantity ?? 1,
    incluir_etiqueta: false,
    cantidad_etiquetas: overrideQuantity ?? 1,
  }],
  collapsed: false,
}
```

- [x] **Añadir `handleChangeLote`**

```ts
const handleChangeLote = useCallback((detalleId: string, loteId: string, patch: Partial<LoteLineUI>) => {
  setDetalles(prev => prev.map(d => {
    if (d.id !== detalleId) return d
    const lotes = d.lotes.map(l => l.id === loteId ? { ...l, ...patch } : l)
    const nowComplete = !!d.area_destino_id && lotes.length > 0 && lotes.every(isLoteComplete)
    const wasComplete = isCardComplete(d)
    const collapsed = !wasComplete && nowComplete ? true : d.collapsed
    return { ...d, lotes, collapsed }
  }))
}, [])
```

- [x] **Añadir `handleAddLote`**

```ts
const handleAddLote = useCallback((detalleId: string) => {
  setDetalles(prev => prev.map(d =>
    d.id !== detalleId ? d : {
      ...d,
      collapsed: false,
      lotes: [...d.lotes, {
        id: uuidv4(),
        codigo_lote: '',
        fecha_vencimiento: '',
        cantidad_presentacion: 1,
        incluir_etiqueta: false,
        cantidad_etiquetas: 1,
      }]
    }
  ))
}, [])
```

- [x] **Añadir `handleRemoveLote`**

```ts
const handleRemoveLote = useCallback((detalleId: string, loteId: string) => {
  setDetalles(prev => prev.map(d => {
    if (d.id !== detalleId) return d
    if (d.lotes.length <= 1) return d  // nunca eliminar el último lote
    const lotes = d.lotes.filter(l => l.id !== loteId)
    const wasComplete = isCardComplete(d)
    const nowComplete = !!d.area_destino_id && lotes.every(isLoteComplete)
    const collapsed = !wasComplete && nowComplete ? true : d.collapsed
    return { ...d, lotes, collapsed }
  }))
}, [])
```

- [x] **Actualizar `handleConfirmar` para aplanar lotes con `flatMap`**

```ts
const validos = detalles.filter(d =>
  d.area_destino_id && d.lotes.some(l => l.codigo_lote && l.fecha_vencimiento)
)
if (validos.length === 0) {
  toast.error('Completa al menos un ítem con lote, vencimiento y área')
  return
}
// ...
detalle: validos.flatMap(d =>
  d.lotes
    .filter(l => l.codigo_lote && l.fecha_vencimiento)
    .map(l => ({
      producto_id: d.producto_id,
      numero_lote: l.codigo_lote,
      fecha_vencimiento: l.fecha_vencimiento,
      presentacion_id: d.presentacion_id,
      cantidad_presentaciones: l.cantidad_presentacion,
      area_destino_id: d.area_destino_id!,
      precio_unitario: d.precio_unitario
        ? parseFloat(d.precio_unitario.replace(/\./g, ''))
        : undefined,
    }))
)
```

- [x] **Actualizar el scan de QR: si el producto ya tiene card, añadir lote a esa card**

Cuando se escanea un código y el producto ya existe en `detalles`, en vez de crear una card nueva, llamar `handleAddLote(existente.id)` y rellenar el código de lote en el nuevo lote.

- [x] **Pasar los nuevos props a `ReceptionItemCard` en el render**

```tsx
<ReceptionItemCard
  detalle={d}
  areas={areas ?? []}
  onChange={handleChange}
  onChangeLote={handleChangeLote}
  onAddLote={handleAddLote}
  onRemoveLote={handleRemoveLote}
  onRemove={handleRemove}
  monedaSimbolo={monedaSimbolo}
/>
```

- [x] **Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "nueva.tsx"
```

Expected: sin errores.

---

## Tarea 3: Actualizar `labels-section.tsx`

**Archivos:**
- Modificar: `frontend/src/pages/recepciones/components/labels-section.tsx`

- [x] **Importar `DetalleLineUI` e `isLoteComplete` desde `item-card`**

```ts
import { isLoteComplete, type DetalleLineUI } from './item-card'
```

- [x] **Actualizar Props para recibir `detalles` y callbacks con `loteId`**

```ts
interface Props {
  // Fase 1: durante el llenado del formulario
  detalles?: DetalleLineUI[]
  onToggleEtiqueta?: (detalleId: string, loteId: string, incluir: boolean) => void
  onCantidadEtiqueta?: (detalleId: string, loteId: string, cant: number) => void
  // Fase 2: tras confirmar — imprime con los lotes reales del servidor
  lotesConfirmados?: LoteParaEtiqueta[]
}
```

- [x] **Aplanar lotes internamente para el render de la fase 1**

```ts
const lotesCompletos = (detalles ?? []).flatMap(d =>
  d.lotes
    .filter(l => isLoteComplete(l) && d.area_destino_id)
    .map(l => ({ ...l, producto_nombre: d.producto_nombre, detalleId: d.id }))
)
```

- [x] **Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "labels-section"
```

Expected: sin errores.

---

## Tarea 4: Mejoras a `producto-autocomplete.tsx`

**Archivos:**
- Modificar: `frontend/src/pages/recepciones/components/producto-autocomplete.tsx`

> Estas mejoras son adicionales al spec original. Se realizaron para integrar mejor el componente con el flujo de nueva recepción.

- [x] **Añadir prop `proveedorId?: number | null`** — filtra sugerencias al proveedor seleccionado (incluye productos sin proveedor asignado)

```ts
.filter(p => proveedorId == null || p.proveedor_id == null || p.proveedor_id === proveedorId)
```

- [x] **Hacer `onScannerOpen` opcional** — no todos los contextos tienen scanner

- [x] **Scroll automático al ítem activo con teclado**

```ts
useEffect(() => {
  if (activeIndex >= 0) {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }
}, [activeIndex])
```

- [x] **Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep "producto-autocomplete"
```

Expected: sin errores.

---

## Tarea 5: Verificación integral en el browser

**No hay tests automatizados en este proyecto. La verificación es manual.**

- [ ] **Levantar el entorno**

```bash
# En la raíz del proyecto (Windows)
./iniciar.ps1
```

O separado:
```bash
docker compose up -d
cd frontend && npm run dev
```

- [ ] **Caso 1 — Producto con un lote**

1. Ir a Recepciones → Nueva recepción
2. Buscar un producto y agregarlo
3. Verificar: card aparece expandida con una fila de lote vacía (código + fecha + cantidad)
4. Ingresar código de lote y fecha de vencimiento
5. Verificar: badge cambia a "✓ Listo" y card se auto-colapsa cuando también hay área asignada
6. Hacer click en toggle → se expande de nuevo

- [ ] **Caso 2 — Producto con múltiples lotes**

1. Con la card expandida, hacer click en "Agregar lote distinto"
2. Verificar: aparece una segunda fila de lote
3. Completar ambas filas
4. Verificar: card se auto-colapsa con "2 lotes" en el resumen
5. Hacer click en el ícono de eliminar de la segunda fila → vuelve a una fila

- [ ] **Caso 3 — Precio formateado**

1. Hacer click en el campo precio → muestra dígitos sin formato (`4850`)
2. Escribir `15000` → al hacer blur muestra `$15.000`

- [ ] **Caso 4 — Confirmar con múltiples lotes**

1. Agregar 1 producto con 2 lotes distintos
2. Completar área, lotes y vencimientos
3. Hacer click en "Confirmar recepción"
4. Verificar: la recepción se crea correctamente en el backend
5. En el historial, verificar que aparecen 2 movimientos separados para ese producto

- [ ] **Caso 5 — Labels section**

1. Ingresar 2 lotes para un producto
2. Verificar que la sección de etiquetas muestra ambos lotes
3. Confirmar la recepción
4. Verificar que la sección post-confirmación muestra los lotes reales

---

## Tarea 6: Commit de todos los cambios

- [ ] **Verificar TypeScript completo**

```bash
cd "C:\Users\Desarrollo\Documents\14 marzo inventario\frontend"
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errores de tipo.

- [ ] **Commit del spec (nunca commiteado)**

```bash
cd "C:\Users\Desarrollo\Documents\14 marzo inventario"
git add docs/superpowers/specs/2026-04-08-recepcion-multi-lote-design.md
git add docs/superpowers/plans/2026-04-08-recepcion-multi-lote.md
git commit -m "docs: spec y plan de recepción multi-lote"
```

- [ ] **Commit de los cambios frontend**

```bash
git add frontend/src/pages/recepciones/components/item-card.tsx
git add frontend/src/pages/recepciones/components/labels-section.tsx
git add frontend/src/pages/recepciones/components/producto-autocomplete.tsx
git add frontend/src/pages/recepciones/components/lote-bottom-sheet.tsx
git add frontend/src/pages/recepciones/components/scanner-panel.tsx
git add frontend/src/pages/recepciones/nueva.tsx
git commit -m "feat(recepciones): soporte multi-lote por producto en nueva recepción"
```

---

## Lo que NO cambia

- **Backend**: recibe el mismo array plano de lotes en `POST /recepciones`. No se modifica.
- **`ProductoAutocomplete`**: `excluidos` sigue siendo por `producto_id` — correcto porque ahora un producto solo puede tener una card.
- **Historial de recepciones**: no afectado.
- **Modo kiosk / QR**: no afectado (eliminados según spec anterior).

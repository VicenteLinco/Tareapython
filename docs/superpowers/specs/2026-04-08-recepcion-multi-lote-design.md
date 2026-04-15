# Recepción Multi-Lote — Diseño

**Fecha:** 2026-04-08  
**Branch:** feat/solicitudes-compra-redesign  
**Alcance:** Rediseño del item-card de recepciones para soportar múltiples lotes por producto en una sola card colapsable.

---

## Problema

Actualmente una card = un lote. Si llegan 2 lotes distintos del mismo producto, el usuario tiene que buscarlo dos veces. Es redundante y ocupa mucho espacio en pantalla.

## Solución

Una card por producto, expandible, con N filas de lote dentro. El precio y el área son compartidos. Los lotes se colapsan cuando todos están completos.

---

## Modelo de Datos

### `LoteLineUI` (nuevo)

```ts
interface LoteLineUI {
  id: string                // uuid único por fila de lote
  codigo_lote: string
  fecha_vencimiento: string
  cantidad_presentacion: number
  incluir_etiqueta: boolean
  cantidad_etiquetas: number
}
```

### `DetalleLineUI` (modificado)

Campos **eliminados**: `codigo_lote`, `fecha_vencimiento`, `cantidad_presentacion`, `incluir_etiqueta`, `cantidad_etiquetas`

Campos **agregados**:

```ts
lotes: LoteLineUI[]   // mínimo 1 al crear
collapsed: boolean    // false al agregar; true cuando todos los lotes están completos
```

Campos que **permanecen** (nivel card): `id`, `producto_id`, `producto_nombre`, `codigo_interno`, `presentacion_id`, `presentacion_nombre`, `presentacion_nombre_plural`, `factor_conversion`, `unidad_base_nombre`, `unidad_base_nombre_plural`, `area_destino_id`, `area_destino_nombre`, `presentaciones`, `precio_unitario`, `imagen_url`, `cantidad_solicitada`.

---

## UX de la Card

### Estado expandido (default al agregar)

```
[img] Glucosa 5%                              [▲] [🗑]
      COD-001 · Hematología

  Lote          Vencimiento     Cantidad
  [ABC-001  ]   [2025-06-30]   [5  ] cajas   [🗑]
  [+ Agregar lote]

  Precio unit.:  [4.850     ]
```

### Estado colapsado (auto al completar todos los lotes)

```
[img] Glucosa 5%                              [▼] [🗑]
      COD-001 · Hematología
      2 lotes · 8 cajas · $4.850              ✓ Completo
```

### Reglas de completitud

- Un **lote** está completo si tiene `codigo_lote` y `fecha_vencimiento`.
- Una **card** está completa si tiene `area_destino_id` y **todos** sus lotes están completos.
- La card se **auto-colapsa** cuando pasa de incompleta a completa (efecto en `onChange`).
- La card puede re-expandirse manualmente con el toggle.

---

## Precio con separador de miles

- Se almacena como string de dígitos: `"4850"`.
- Se muestra formateado con puntos al hacer blur: `$4.850`.
- Al hacer focus se muestra sin formato para editar.
- Función: `Intl.NumberFormat('es-CL').format(n)` o `.toLocaleString('es-CL')`.

---

## Callbacks del componente

```ts
interface Props {
  detalle: DetalleLineUI
  areas: Area[]
  onChange: (id: string, patch: Partial<Omit<DetalleLineUI, 'lotes'>>) => void
  onChangeLote: (detalleId: string, loteId: string, patch: Partial<LoteLineUI>) => void
  onAddLote: (detalleId: string) => void
  onRemoveLote: (detalleId: string, loteId: string) => void
  onRemove: (id: string) => void
  monedaSimbolo?: string
}
```

---

## Cambios en `nueva.tsx`

### `addProducto`

Crea la card con un lote vacío inicial:

```ts
lotes: [{
  id: uuidv4(),
  codigo_lote: '',
  fecha_vencimiento: '',
  cantidad_presentacion: overrideQuantity ?? 1,
  incluir_etiqueta: false,
  cantidad_etiquetas: overrideQuantity ?? 1,
}],
collapsed: false,
```

### `handleConfirmar` — aplanado de lotes

```ts
const validos = detalles.filter(d =>
  d.area_destino_id &&
  d.lotes.some(l => l.codigo_lote && l.fecha_vencimiento)
)

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
      precio_unitario: d.precio_unitario ? parseFloat(d.precio_unitario.replace(/\./g, '')) : undefined,
    }))
)
```

### Nuevos handlers en `nueva.tsx`

```ts
const handleChangeLote = useCallback((detalleId, loteId, patch) => {
  setDetalles(prev => prev.map(d => {
    if (d.id !== detalleId) return d
    const lotes = d.lotes.map(l => l.id === loteId ? { ...l, ...patch } : l)
    const todosCompletos = lotes.every(l => l.codigo_lote && l.fecha_vencimiento)
    const ahoraCompleta = todosCompletos && !!d.area_destino_id
    return { ...d, lotes, collapsed: ahoraCompleta ? true : d.collapsed }
  }))
}, [])

const handleAddLote = useCallback((detalleId) => {
  setDetalles(prev => prev.map(d =>
    d.id !== detalleId ? d : {
      ...d,
      collapsed: false,
      lotes: [...d.lotes, { id: uuidv4(), codigo_lote: '', fecha_vencimiento: '', cantidad_presentacion: 1, incluir_etiqueta: false, cantidad_etiquetas: 1 }]
    }
  ))
}, [])

const handleRemoveLote = useCallback((detalleId, loteId) => {
  setDetalles(prev => prev.map(d =>
    d.id !== detalleId ? d : { ...d, lotes: d.lotes.filter(l => l.id !== loteId) }
  ))
}, [])
```

### `handleSearch` (QR scan)

Al escanear un lote existente, si el producto ya tiene card, agregar el lote a esa card en vez de crear una nueva.

---

## Cambios en `labels-section.tsx`

La sección recibe `detalles: DetalleLineUI[]` y aplana los lotes internamente:

```ts
const lotesCompletos = detalles.flatMap(d =>
  d.lotes
    .filter(l => l.codigo_lote && l.fecha_vencimiento && d.area_destino_id)
    .map(l => ({ ...l, producto_nombre: d.producto_nombre, detalleId: d.id }))
)
```

Callbacks actualizados:
```ts
onToggleEtiqueta?: (detalleId: string, loteId: string, incluir: boolean) => void
onCantidadEtiqueta?: (detalleId: string, loteId: string, cant: number) => void
```

En `nueva.tsx` se pasan al `ReceptionItemCard` como `onChangeLote`.

---

## Archivos Afectados

| Archivo | Cambio |
|---------|--------|
| `item-card.tsx` | Reescritura. Nuevas interfaces, fila de lote, colapso, precio formateado |
| `nueva.tsx` | Nuevos callbacks, `addProducto` con lote inicial, `handleConfirmar` aplanado, scan mejorado |
| `labels-section.tsx` | Aplana lotes internamente, nuevas firmas de callbacks |

---

## Fuera de alcance

- Backend: no cambia (recibe el mismo array plano de lotes).
- `ProductoAutocomplete`: no cambia (`excluidos` sigue siendo por `producto_id`; ahora tiene más sentido porque un producto solo puede tener una card).
- Modo QR / kiosk: no afectado.

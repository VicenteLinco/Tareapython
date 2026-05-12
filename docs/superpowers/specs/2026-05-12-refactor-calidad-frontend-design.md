# Refactor de calidad de código — Frontend

**Fecha:** 2026-05-12
**Alcance:** Frontend React/TypeScript
**Prioridad:** Alta

## Contexto

El frontend tiene varios archivos de páginas con más de 700–1200 líneas que mezclan lógica de estado, lógica de negocio y presentación. Hay además código duplicado entre páginas y un sistema de colores inconsistente. No hay tests, por lo que el refactor debe hacerse de forma incremental y verificable manualmente.

## Objetivos

1. Crear utilidades y hooks compartidos reutilizables (base del refactor)
2. Refactorizar `solicitudes-compra/index.tsx` (701 líneas) dividiendo responsabilidades
3. Refactorizar `recepciones/nueva.tsx` (1203 líneas) dividiendo en pasos del wizard

## Alcance explícito — qué NO toca este refactor

- No cambia la lógica de negocio ni el comportamiento visible para el usuario
- No cambia queries ni endpoints de API
- No agrega features nuevas
- No toca `consumos/index.tsx` ni `stock-detail.tsx` en esta pasada

---

## Sección 1: Utilidades y hooks compartidos

### `src/hooks/useLocalStorage.ts`

Hook que encapsula el patrón repetido en 3 páginas:
```ts
// Patrón actual (repetido en recepciones, solicitudes, consumos):
const [modoExperto, setModoExperto] = useState(
  () => localStorage.getItem('rec-modo-experto') !== 'false'
)
useEffect(() => {
  localStorage.setItem('rec-modo-experto', String(modoExperto))
}, [modoExperto])

// Nuevo hook:
function useLocalStorageBoolean(key: string, defaultValue: boolean): [boolean, Dispatch<SetStateAction<boolean>>]
```

### `src/hooks/useDialogState.ts`

Hook para gestionar el estado abierto/cerrado de modales y drawers:
```ts
function useDialogState(initial?: boolean): {
  open: boolean
  onOpen: () => void
  onClose: () => void
  toggle: () => void
}
```

Reemplaza los `useState(false)` + handlers manuales dispersos en múltiples archivos.

### `src/lib/theme.ts`

Constantes de colores de estado que hoy están mezclados entre clases DaisyUI y Tailwind directo:
```ts
export const STATUS_COLORS = {
  vencido:    'bg-error/10 text-error',
  critico:    'bg-error/5 text-error/80',
  proximo:    'bg-warning/10 text-warning',
  disponible: 'bg-success/10 text-success/80',
} as const

export const DAYS_CHIP_COLOR = (days: number): string => {
  if (days <= 0)  return STATUS_COLORS.vencido
  if (days <= 7)  return STATUS_COLORS.critico
  if (days <= 30) return STATUS_COLORS.proximo
  if (days <= 90) return 'bg-yellow-50 text-yellow-700'  // intermedio
  return STATUS_COLORS.disponible
}
```

Afecta: `consumos/index.tsx`, `stock-detail.tsx`, `proveedor-select.tsx`.

---

## Sección 2: Refactor `solicitudes-compra/index.tsx`

### Problema actual

- 701 líneas en un solo archivo
- `PedidoPanel` recibe 12+ props directamente desde `index.tsx`
- Lógica de estado mezclada con lógica de presentación

### Estructura propuesta

```
pages/solicitudes-compra/
├── index.tsx                    # Orquestador ~100 líneas
├── hooks/
│   └── useSolicitudState.ts     # Todo el estado, mutations, handlers
├── components/
│   ├── SolicitudListaView.tsx   # Vista de lista/tabla de solicitudes
│   ├── SolicitudDetalleView.tsx # Vista de detalle de una solicitud
│   ├── pedido-panel.tsx         # Ya existe — recibe props limpias del hook
│   └── detalle-modal.tsx        # Ya existe — sin cambios
```

### `useSolicitudState.ts`

Encapsula:
- Queries de React Query (proveedores, solicitudes, productos)
- Mutations (crear, guardar borrador, aprobar, rechazar)
- Estado local (proveedor seleccionado, items, modo revisión, popovers)
- Handlers derivados (handleUpdateQty, handleRemove, etc.)

Expone una interfaz limpia al `index.tsx` orquestador.

### `index.tsx` resultado

```tsx
export default function SolicitudesCompra() {
  const state = useSolicitudState()
  
  if (state.view === 'lista') return <SolicitudListaView {...state} />
  if (state.view === 'detalle') return <SolicitudDetalleView {...state} />
  return <PedidoPanel {...state.pedidoProps} />
}
```

---

## Sección 3: Refactor `recepciones/nueva.tsx`

### Problema actual

- 1203 líneas con wizard multi-paso, lógica de scan, múltiples modales y confirmación
- Anidamiento JSX de 6+ niveles
- Modales definidos inline con IIFE condicionales

### Estructura propuesta

```
pages/recepciones/
├── nueva.tsx                    # Orquestador ~150 líneas
├── hooks/
│   ├── useRecepcionWizard.ts    # Estado del wizard, paso actual, navegación
│   └── useRecepcionItems.ts     # Agregar/quitar/editar ítems, lógica de scan
├── steps/
│   ├── ProveedorStep.tsx        # Paso 1: selección de proveedor
│   ├── ItemsStep.tsx            # Paso 2: lista de ítems y cantidades
│   └── ConfirmStep.tsx          # Paso 3: confirmación y envío
└── components/
    ├── ReconciliacionModal.tsx  # Modal de reconciliación de ítems
    └── VincularSolicitudModal.tsx # Modal de vinculación a solicitud de compra
```

### `useRecepcionWizard.ts`

```ts
function useRecepcionWizard(): {
  paso: 'proveedor' | 'items' | 'confirmar'
  setPaso: (p: Paso) => void
  puedeAvanzar: boolean
  handleSiguiente: () => void
  handleAtras: () => void
  modoExperto: boolean
  toggleModoExperto: () => void
}
```

### `useRecepcionItems.ts`

```ts
function useRecepcionItems(): {
  items: ItemRecepcion[]
  handleScan: (codigo: string) => void
  handleAddProducto: (producto: Producto) => void
  handleUpdateItem: (id: string, cambios: Partial<ItemRecepcion>) => void
  handleRemoveItem: (id: string) => void
  handleConfirmar: () => Promise<void>
}
```

### `nueva.tsx` resultado

```tsx
export default function NuevaRecepcion() {
  const wizard = useRecepcionWizard()
  const items = useRecepcionItems()

  return (
    <div>
      {wizard.paso === 'proveedor' && <ProveedorStep wizard={wizard} />}
      {wizard.paso === 'items' && <ItemsStep wizard={wizard} items={items} />}
      {wizard.paso === 'confirmar' && <ConfirmStep wizard={wizard} items={items} />}
    </div>
  )
}
```

---

## Orden de implementación

1. **`src/lib/theme.ts`** — sin dependencias, riesgo cero
2. **`src/hooks/useLocalStorage.ts`** — sin dependencias
3. **`src/hooks/useDialogState.ts`** — sin dependencias
4. Aplicar `theme.ts` a `consumos/index.tsx`, `stock-detail.tsx`, `proveedor-select.tsx`
5. **`useSolicitudState.ts`** + split de vistas de solicitudes
6. **`useRecepcionWizard.ts`** + **`useRecepcionItems.ts`** + split de steps de recepciones
7. Extraer modales de recepciones a sus propios archivos

## Criterios de éxito

- Ningún archivo de página supera las 200 líneas
- `PedidoPanel` recibe ≤ 5 props directas
- El patrón `localStorage.getItem(...)` no existe fuera de `useLocalStorage.ts`
- Los colores de estado `bg-yellow-*`, `bg-amber-*` inline son reemplazados por `theme.ts`
- La app funciona idénticamente antes y después del refactor

# Spec: Buscador inteligente con sugerencias en Nueva Recepción

**Fecha:** 2026-04-07  
**Branch:** feat/solicitudes-compra-redesign  
**Página:** `frontend/src/pages/recepciones/nueva.tsx`

---

## Contexto

El input de búsqueda en `nueva.tsx` actualmente solo reacciona al presionar Enter. Los productos (hasta 500) ya están en memoria via React Query (`['productos-all']`). El objetivo es mostrar sugerencias mientras el usuario escribe, con imagen, nombre y código.

---

## Componente nuevo: `ProductoAutocomplete`

**Ubicación:** `frontend/src/pages/recepciones/components/producto-autocomplete.tsx`

### Props

```ts
interface Props {
  productos: Producto[]
  excluidos: string[]              // producto_id ya presentes en detalles
  onSelect: (p: Producto) => void
  onScan: (valor: string) => void  // Enter sin sugerencia seleccionada → flujo QR/código
  onScannerOpen: () => void        // click en ícono ScanLine → abre modal QrScanner en padre
  monedaSimbolo?: string
}
```

### Comportamiento

- **Filtrado:** al escribir ≥ 2 caracteres, filtra `productos` por `nombre` o `codigo_interno` (case-insensitive). Excluye los `producto_id` listados en `excluidos`. Muestra máximo 8 resultados.
- **Dropdown:** aparece inmediatamente al haber resultados. Se cierra al seleccionar, al presionar Escape, o al hacer click fuera (listener en `document`).
- **Sin resultados:** si hay texto pero ningún match, muestra una fila `"Sin resultados"` en `opacity-50` (no seleccionable).
- **Selección:**
  - Click en fila → `onSelect(prod)`, limpia input, cierra dropdown.
  - Enter con fila activa → igual que click.
  - Enter sin fila activa (ej: código de barras pegado) → `onScan(valor)`, limpia input.
- **Navegación por teclado:** ↑↓ mueven el índice activo. El índice se wrappea (último → primero y viceversa). Escape cierra sin seleccionar.

### Visual del dropdown

```
┌─────────────────────────────────────────────────────┐
│ 🔍  Escanear QR · Código interno · Nombre…    [📷] │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ [img]  Glucosa Hexokinasa           COD-001         │
│ [img]  Glucosa Oxidasa Reactivo     COD-042   ←activo│
│ [img]  Glucosa Control Nivel 1      COD-087         │
└─────────────────────────────────────────────────────┘
```

- Contenedor: `bg-base-100 border border-base-300 rounded-box shadow-lg z-50`, posición absoluta bajo el input, ancho completo.
- Fila: `flex items-center gap-3 px-3 py-2 cursor-pointer`.
- Fila activa: `bg-base-200`.
- Miniatura: componente `ProductoImage` existente, 32×32 px.
- Nombre: `text-sm flex-1`.
- Código: `text-xs opacity-50 font-mono` alineado a la derecha.

---

## Integración en `nueva.tsx`

Reemplazar el bloque `<div className="relative">` del input de búsqueda con:

```tsx
<ProductoAutocomplete
  productos={productos ?? []}
  excluidos={detalles.map(d => d.producto_id)}
  onSelect={prod => { addProducto(prod); }}
  onScan={handleSearch}
  onScannerOpen={() => setScannerOpen(true)}
  monedaSimbolo={monedaSimbolo}
/>
```

El ícono ScanLine se incluye dentro del componente pero delega `setScannerOpen(true)` al padre via `onScannerOpen`. El estado `searchValue` del componente padre se elimina (pasa a ser estado interno del autocomplete).

---

## Lo que NO cambia

- `handleSearch` — sigue manejando el flujo de QR, código de barras y escaneo por cámara.
- `addProducto` — lógica de carga de producto sin cambios.
- `QrScanner` modal — permanece igual, invocado desde dentro del autocomplete.

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `recepciones/components/producto-autocomplete.tsx` | **Nuevo** |
| `recepciones/nueva.tsx` | Reemplaza bloque input + elimina `searchValue` state |

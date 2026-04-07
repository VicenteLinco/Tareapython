# Producto Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el input de búsqueda en Nueva Recepción con un autocomplete que muestra sugerencias con imagen, nombre y código mientras el usuario escribe.

**Architecture:** Nuevo componente `ProductoAutocomplete` con estado interno (valor, sugerencias, índice activo, abierto/cerrado). Filtra el array `productos` ya cargado en memoria. `nueva.tsx` lo instancia pasando callbacks y la lista de IDs excluidos.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 / DaisyUI, lucide-react, componente `ProductoImage` existente.

---

## Files

| Acción | Archivo |
|--------|---------|
| Crear | `frontend/src/pages/recepciones/components/producto-autocomplete.tsx` |
| Modificar | `frontend/src/pages/recepciones/nueva.tsx` |

---

### Task 1: Crear componente `ProductoAutocomplete`

**Files:**
- Create: `frontend/src/pages/recepciones/components/producto-autocomplete.tsx`

- [ ] **Step 1: Crear el archivo con el componente completo**

```tsx
// frontend/src/pages/recepciones/components/producto-autocomplete.tsx
import { useState, useRef, useEffect } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import type { Producto } from '@/types'

interface Props {
  productos: Producto[]
  excluidos: string[]              // producto_id ya presentes en detalles
  onSelect: (p: Producto) => void
  onScan: (valor: string) => void  // Enter sin sugerencia activa → flujo QR/código
  onScannerOpen: () => void        // click en ícono ScanLine → abre modal QrScanner en padre
}

export function ProductoAutocomplete({ productos, excluidos, onSelect, onScan, onScannerOpen }: Props) {
  const [value, setValue] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const suggestions: Producto[] = q.length >= 2
    ? productos
        .filter(p => !excluidos.includes(String(p.id)))
        .filter(p =>
          p.nombre.toLowerCase().includes(q) ||
          p.codigo_interno.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : []

  // Resetear índice activo cada vez que cambia el texto
  useEffect(() => { setActiveIndex(-1) }, [value])

  // Cerrar al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (p: Producto) => {
    onSelect(p)
    setValue('')
    setOpen(false)
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (suggestions.length === 0) return
      setActiveIndex(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        select(suggestions[activeIndex])
      } else {
        onScan(value)
        setValue('')
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  const showDropdown = open && q.length >= 2

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none z-10" />
      <input
        className="input input-bordered w-full pl-10 pr-10"
        placeholder="Escanear QR · Código interno · Nombre del producto…"
        value={value}
        onChange={e => { setValue(e.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      <ScanLine
        className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 cursor-pointer"
        onClick={onScannerOpen}
      />

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-box shadow-lg z-50 overflow-hidden">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm opacity-50">Sin resultados</div>
          ) : (
            suggestions.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                  i === activeIndex ? 'bg-base-200' : 'hover:bg-base-200'
                }`}
                onMouseDown={() => select(p)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <ProductoImage
                  src={(p as Producto & { imagen_url?: string | null }).imagen_url}
                  size="sm"
                />
                <span className="text-sm flex-1 truncate">{p.nombre}</span>
                <span className="text-xs opacity-50 font-mono flex-shrink-0">{p.codigo_interno}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar que no hay errores de TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores en el nuevo archivo.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/recepciones/components/producto-autocomplete.tsx
git commit -m "feat(recepciones): componente ProductoAutocomplete con sugerencias y teclado"
```

---

### Task 2: Integrar en `nueva.tsx`

**Files:**
- Modify: `frontend/src/pages/recepciones/nueva.tsx`

- [ ] **Step 1: Añadir import del nuevo componente**

En `nueva.tsx`, reemplazar la línea de import de `ReceptionItemCard`:

```ts
// Antes
import { ReceptionItemCard, type DetalleLineUI } from './components/item-card'

// Después
import { ReceptionItemCard, type DetalleLineUI } from './components/item-card'
import { ProductoAutocomplete } from './components/producto-autocomplete'
```

- [ ] **Step 2: Eliminar el estado `searchValue`**

Eliminar esta línea (aprox. línea 58):

```ts
// Eliminar:
const [searchValue, setSearchValue] = useState('')
```

- [ ] **Step 3: Reemplazar el bloque del input de búsqueda**

Localizar el bloque (aprox. líneas 513–527):

```tsx
// Antes — bloque completo a reemplazar:
          {/* Búsqueda / scan */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
            <input
              className="input input-bordered w-full pl-10 pr-10"
              placeholder="Escanear QR · Código interno · Nombre del producto…"
              value={searchValue}
              onChange={e => setSearchValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { handleSearch(searchValue) } }}
            />
            <ScanLine
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 cursor-pointer"
              onClick={() => setScannerOpen(true)}
            />
          </div>
```

```tsx
// Después:
          {/* Búsqueda / scan */}
          <ProductoAutocomplete
            productos={productos ?? []}
            excluidos={detalles.map(d => d.producto_id)}
            onSelect={prod => { addProducto(prod) }}
            onScan={handleSearch}
            onScannerOpen={() => setScannerOpen(true)}
          />
```

- [ ] **Step 4: Eliminar imports no usados de `nueva.tsx`**

Con el nuevo componente, `Search` y `ScanLine` ya no se importan directamente en `nueva.tsx`. Actualizar la línea de imports de lucide-react:

```ts
// Antes
import { ArrowLeft, Search, ShoppingCart, ScanLine, X } from 'lucide-react'

// Después
import { ArrowLeft, ShoppingCart, X } from 'lucide-react'
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Esperado: sin errores.

- [ ] **Step 6: Probar manualmente en el navegador**

Ir a `http://localhost:5173/recepciones/nueva` y verificar:
- Escribir 2+ caracteres → aparece dropdown con sugerencias
- Sugerencias muestran imagen (o ícono fallback), nombre y código
- ↑↓ navega entre filas, Enter selecciona y añade el ítem
- Escape cierra el dropdown
- Click fuera cierra el dropdown
- Producto ya en la lista no aparece en sugerencias
- Escribir un código de barras y presionar Enter sin sugerencia activa → flujo de escaneo normal
- Ícono ScanLine abre el modal de cámara QR

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/recepciones/nueva.tsx
git commit -m "feat(recepciones): integrar ProductoAutocomplete en nueva recepción"
```

# Descartes: Mejora búsqueda y llenado de lista — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar el dropdown de búsqueda en descartes para que al seleccionar un producto agregue directamente sus lotes al carrito, y mostrar sugerencias automáticas de ítems vencidos cuando el input está vacío.

**Architecture:** Un solo archivo frontend se modifica (`nuevo-descarte-tab.tsx`). Se eliminan los estados `selectedSearchStockKey`/`selectedSearchQuery` y el parámetro `q` del servidor. La búsqueda pasa a ser 100% client-side. Las sugerencias del dropdown se agrupan por producto (`producto_nombre`). Al seleccionar, `selectProduct` agrega todos los lotes del producto al carrito de una sola vez.

**Tech Stack:** React 19, TypeScript, `@tanstack/react-query`, Tailwind CSS v4, shadcn/ui, `lucide-react`

**Spec:** `docs/superpowers/specs/2026-05-16-descartes-busqueda-llenado-design.md`

---

## Mapa de archivos

| Archivo | Acción |
|---------|--------|
| `frontend/src/pages/descartes/nuevo-descarte-tab.tsx` | Modificar — todos los cambios van aquí |
| `frontend/src/pages/descartes/use-descartes-stock.ts` | Sin cambios |

---

## Task 1: Simplificar estado y eliminar búsqueda server-side

**Files:**
- Modify: `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

- [ ] **Step 1.1: Eliminar los dos estados de "pin"**

En `nuevo-descarte-tab.tsx`, alrededor de la línea 51, eliminar estas dos líneas:

```ts
// ELIMINAR:
const [selectedSearchStockKey, setSelectedSearchStockKey] = useState<string | null>(null)
const [selectedSearchQuery, setSelectedSearchQuery] = useState<string | null>(null)
```

- [ ] **Step 1.2: Eliminar `querySearch` y el parámetro `q` del hook**

Alrededor de la línea 70, eliminar el bloque `querySearch`:

```ts
// ELIMINAR:
const querySearch = selectedSearchStockKey
  ? selectedSearchQuery ?? searchTerm
  : canSearch
    ? searchTerm
    : ''
```

Luego, alrededor de la línea 91, cambiar la llamada a `useDescartesStock`:

```ts
// ANTES:
const { data: stock = [], isLoading } = useDescartesStock({
  diasAlerta: filterIncluirProximos ? 30 : 0,
  areaId: filterAreaId,
  proveedorId: filterProveedorId,
  q: querySearch,
})

// DESPUÉS:
const { data: stock = [], isLoading } = useDescartesStock({
  diasAlerta: filterIncluirProximos ? 30 : 0,
  areaId: filterAreaId,
  proveedorId: filterProveedorId,
})
```

- [ ] **Step 1.3: Reescribir `filteredStock` como filtro client-side puro**

```ts
// ANTES:
const filteredStock = useMemo(() => {
  if (selectedSearchStockKey) return stock.filter((s) => stockKey(s) === selectedSearchStockKey)
  if (!searchTerm) return stock
  if (!canSearch) return []
  const q = normalizeSearch(searchTerm)
  return stock.filter(
    (s) =>
      normalizeSearch(s.producto_nombre).includes(q) ||
      normalizeSearch(s.codigo_lote).includes(q)
  )
}, [stock, searchTerm, canSearch, selectedSearchStockKey])

// DESPUÉS:
const filteredStock = useMemo(() => {
  if (!canSearch) return stock
  const q = normalizeSearch(searchTerm)
  return stock.filter(
    (s) =>
      normalizeSearch(s.producto_nombre).includes(q) ||
      normalizeSearch(s.codigo_lote).includes(q)
  )
}, [stock, searchTerm, canSearch])
```

- [ ] **Step 1.4: Actualizar el mensaje de empty state de la tabla**

Buscar el bloque del empty state de la tabla (alrededor de la línea 444):

```tsx
// ANTES:
{searchTerm && !canSearch
  ? `Escribe al menos ${MIN_SEARCH_CHARS} caracteres para buscar`
  : stock.length === 0 && !searchTerm
  ? 'No hay ítems vencidos en este momento'
  : 'No se encontraron ítems con ese filtro'}

// DESPUÉS:
{stock.length === 0
  ? 'No hay ítems vencidos en este momento'
  : 'No se encontraron ítems con ese filtro'}
```

- [ ] **Step 1.5: Verificar que el archivo compila sin errores**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Esperado: sin errores relacionados con `selectedSearchStockKey` o `querySearch`.

- [ ] **Step 1.6: Commit**

```bash
git add frontend/src/pages/descartes/nuevo-descarte-tab.tsx
git commit -m "refactor(descartes): eliminar búsqueda server-side y estados de pin"
```

---

## Task 2: Agregar lógica de sugerencias por producto

**Files:**
- Modify: `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

- [ ] **Step 2.1: Agregar el tipo `ProductSuggestion` y el helper `groupByProduct`**

Justo después de las líneas con `const MIN_SEARCH_CHARS = 2` y `const normalizeSearch` (alrededor de la línea 28), agregar:

```ts
interface ProductSuggestion {
  producto_nombre: string
  lotes: DescarteVencidoItem[]
  areas: string[]
}

const groupByProduct = (items: DescarteVencidoItem[]): ProductSuggestion[] => {
  const byProduct = new Map<string, DescarteVencidoItem[]>()
  items.forEach((item) => {
    const existing = byProduct.get(item.producto_nombre) ?? []
    byProduct.set(item.producto_nombre, [...existing, item])
  })
  return [...byProduct.entries()].map(([nombre, lotes]) => ({
    producto_nombre: nombre,
    lotes,
    areas: [...new Set(lotes.map((l) => l.area_nombre))],
  }))
}
```

- [ ] **Step 2.2: Reescribir `searchSuggestions` para agrupar por producto**

Reemplazar el bloque `searchSuggestions` existente (alrededor de la línea 236):

```ts
// ANTES: mostraba lotes individuales con agrupación alfabética
const searchSuggestions = useMemo(() => {
  if (!canSearch || selectedSearchStockKey) return []
  const q = normalizeSearch(searchTerm)
  return [...filteredStock]
    .sort(...)
    .slice(0, 12)
}, [canSearch, filteredStock, searchTerm, selectedSearchStockKey])

// DESPUÉS: agrupa por producto
const searchSuggestions = useMemo((): ProductSuggestion[] => {
  if (!canSearch) return []
  const q = normalizeSearch(searchTerm)
  const matching = stock.filter(
    (s) =>
      normalizeSearch(s.producto_nombre).includes(q) ||
      normalizeSearch(s.codigo_lote).includes(q)
  )
  return groupByProduct(matching)
    .sort((a, b) => {
      const rankA = Math.min(...a.lotes.map((l) => searchRank(l, q)))
      const rankB = Math.min(...b.lotes.map((l) => searchRank(l, q)))
      return rankA !== rankB
        ? rankA - rankB
        : a.producto_nombre.localeCompare(b.producto_nombre, 'es')
    })
    .slice(0, 12)
}, [canSearch, stock, searchTerm])
```

- [ ] **Step 2.3: Agregar `recommendedSuggestions` para el estado sin texto**

Inmediatamente después del nuevo `searchSuggestions`, agregar:

```ts
const recommendedSuggestions = useMemo((): ProductSuggestion[] => {
  if (canSearch) return []
  const expired = stock.filter((s) => {
    const days = daysUntil(s.fecha_vencimiento)
    return days !== null && days < 0
  })
  return groupByProduct(expired)
    .sort((a, b) => {
      const minDayA = Math.min(...a.lotes.map((l) => daysUntil(l.fecha_vencimiento) ?? 0))
      const minDayB = Math.min(...b.lotes.map((l) => daysUntil(l.fecha_vencimiento) ?? 0))
      return minDayA - minDayB
    })
    .slice(0, 6)
}, [canSearch, stock])
```

- [ ] **Step 2.4: Agregar `activeSuggestions`, `isRecommendMode` y actualizar `showSearchDropdown`**

Reemplazar la línea `const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0`:

```ts
// ANTES:
const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

// DESPUÉS:
const activeSuggestions = canSearch ? searchSuggestions : recommendedSuggestions
const isRecommendMode = !canSearch
const showSearchDropdown = searchDropdownOpen && activeSuggestions.length > 0
```

- [ ] **Step 2.5: Eliminar `groupedSearchItems` (ya no se necesita)**

Eliminar el bloque completo `const groupedSearchItems = (() => { ... })()` que construía los headers alfabéticos.

- [ ] **Step 2.6: Reescribir `selectSearchItem` → `selectProduct`**

```ts
// ELIMINAR:
const selectSearchItem = (item: typeof stock[number]) => {
  setSearch(`${item.producto_nombre} · ${item.codigo_lote}`)
  setSelectedSearchStockKey(stockKey(item))
  setSelectedSearchQuery(item.codigo_lote)
  setSearchDropdownOpen(false)
  setSearchActiveIndex(-1)
}

// AGREGAR:
const selectProduct = (suggestion: ProductSuggestion) => {
  setItems((prev) => {
    const next = { ...prev }
    suggestion.lotes.forEach((stockItem) => {
      const key = stockKey(stockItem)
      if (!next[key]) {
        const days = daysUntil(stockItem.fecha_vencimiento)
        const isExpired = days !== null && days < 0
        next[key] = {
          ...stockItem,
          cantidad_descartar: stockItem.cantidad,
          motivo: isExpired ? 'vencido' : 'dañado',
        }
      }
    })
    return next
  })
  setSearch('')
  setSearchDropdownOpen(false)
  setSearchActiveIndex(-1)
}
```

- [ ] **Step 2.7: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Esperado: sin errores de tipos.

- [ ] **Step 2.8: Commit**

```bash
git add frontend/src/pages/descartes/nuevo-descarte-tab.tsx
git commit -m "feat(descartes): sugerencias por producto + recomendaciones automáticas de vencidos"
```

---

## Task 3: Actualizar event handlers del input

**Files:**
- Modify: `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

- [ ] **Step 3.1: Actualizar `handleSearchKeyDown` para usar `activeSuggestions` y `selectProduct`**

```ts
// ANTES:
const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!searchDropdownOpen) setSearchDropdownOpen(true)
    if (searchSuggestions.length === 0) return
    setSearchActiveIndex((i) => (i < searchSuggestions.length - 1 ? i + 1 : 0))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (searchSuggestions.length === 0) return
    setSearchActiveIndex((i) => (i > 0 ? i - 1 : searchSuggestions.length - 1))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
      selectSearchItem(searchSuggestions[searchActiveIndex])
    }
  } else if (e.key === 'Escape') {
    setSearchDropdownOpen(false)
    setSearch('')
    setSelectedSearchStockKey(null)
    setSelectedSearchQuery(null)
    setSearchActiveIndex(-1)
  }
}

// DESPUÉS:
const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!searchDropdownOpen) setSearchDropdownOpen(true)
    if (activeSuggestions.length === 0) return
    setSearchActiveIndex((i) => (i < activeSuggestions.length - 1 ? i + 1 : 0))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (activeSuggestions.length === 0) return
    setSearchActiveIndex((i) => (i > 0 ? i - 1 : activeSuggestions.length - 1))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (searchActiveIndex >= 0 && activeSuggestions[searchActiveIndex]) {
      selectProduct(activeSuggestions[searchActiveIndex])
    }
  } else if (e.key === 'Escape') {
    setSearchDropdownOpen(false)
    setSearch('')
    setSearchActiveIndex(-1)
  }
}
```

- [ ] **Step 3.2: Actualizar el `onChange` del input para eliminar los `setSelectedSearch*`**

Dentro del JSX del `<Input>`, reemplazar el handler `onChange`:

```tsx
// ANTES:
onChange={(e) => {
  setSearch(e.target.value)
  setSelectedSearchStockKey(null)
  setSelectedSearchQuery(null)
  setSearchDropdownOpen(true)
}}

// DESPUÉS:
onChange={(e) => {
  setSearch(e.target.value)
  setSearchDropdownOpen(true)
}}
```

- [ ] **Step 3.3: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Esperado: 0 errores.

- [ ] **Step 3.4: Commit**

```bash
git add frontend/src/pages/descartes/nuevo-descarte-tab.tsx
git commit -m "refactor(descartes): event handlers usan activeSuggestions y selectProduct"
```

---

## Task 4: Reescribir UI del dropdown

**Files:**
- Modify: `frontend/src/pages/descartes/nuevo-descarte-tab.tsx`

- [ ] **Step 4.1: Reemplazar el contenido del dropdown**

Localizar el bloque `{showSearchDropdown && ( ... )}` que actualmente mapea `groupedSearchItems`. Reemplazarlo por:

```tsx
{showSearchDropdown && (
  <div
    className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-64"
    role="listbox"
  >
    {isRecommendMode && (
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-base-content/40 border-b border-base-200">
        Sugeridos para descartar
      </div>
    )}
    {activeSuggestions.map((suggestion, idx) => {
      const lotesLabel =
        suggestion.lotes.length === 1
          ? `1 lote · ${suggestion.areas[0]}`
          : `${suggestion.lotes.length} lotes · ${suggestion.areas.slice(0, 2).join(', ')}${suggestion.areas.length > 2 ? '…' : ''}`
      const minDays = isRecommendMode
        ? Math.min(...suggestion.lotes.map((l) => daysUntil(l.fecha_vencimiento) ?? 0))
        : null
      return (
        <div
          key={suggestion.producto_nombre}
          ref={(el) => { searchItemRefs.current[idx] = el }}
          role="option"
          aria-selected={idx === searchActiveIndex}
          className={cn(
            'flex items-center justify-between px-3 py-2.5 cursor-pointer text-sm gap-2',
            idx === searchActiveIndex
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-base-200/60'
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            selectProduct(suggestion)
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isRecommendMode && (
              <span className="text-error text-[8px] shrink-0">●</span>
            )}
            <span className="font-medium truncate">{suggestion.producto_nombre}</span>
          </div>
          <span className="text-[10px] opacity-40 shrink-0 text-right">
            {isRecommendMode && minDays !== null
              ? `hace ${Math.abs(minDays)}d`
              : lotesLabel}
          </span>
        </div>
      )
    })}
    {isRecommendMode && (
      <div className="px-3 py-2 text-[10px] text-base-content/30 border-t border-base-200 italic">
        Busca por nombre o lote para agregar más
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4.2: Verificar compilación final**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Esperado: 0 errores.

- [ ] **Step 4.3: Levantar el frontend y probar manualmente**

```bash
cd frontend && npm run dev
```

Abrir `http://localhost:5173/descartes` → tab "Nuevo descarte".

**Checklist de verificación manual:**

- [ ] Al hacer click en el buscador sin haber escrito nada → aparece sección "Sugeridos para descartar" con los productos más vencidos (si los hay)
- [ ] Cada entrada muestra nombre del producto y "hace Nd" con el punto rojo
- [ ] Al hacer click en una recomendación → sus lotes aparecen marcados en la tabla y en el carrito, el input queda limpio
- [ ] Al escribir 2+ caracteres → las recomendaciones se reemplazan por resultados de búsqueda agrupados por producto
- [ ] Cada sugerencia de búsqueda muestra nombre + "N lotes · Área"
- [ ] Al hacer click en una sugerencia de búsqueda → sus lotes se agregan al carrito, input se limpia
- [ ] Hacer click en un producto que ya está 100% en el carrito → no hay duplicados
- [ ] ↓/↑ navegan las sugerencias (tanto recomendadas como buscadas)
- [ ] Enter selecciona el ítem activo
- [ ] Escape limpia el input y cierra el dropdown
- [ ] Los filtros de área/proveedor se respetan en las sugerencias

- [ ] **Step 4.4: Commit final**

```bash
git add frontend/src/pages/descartes/nuevo-descarte-tab.tsx
git commit -m "feat(descartes): dropdown agrega al carrito directamente con recomendaciones automáticas"
```

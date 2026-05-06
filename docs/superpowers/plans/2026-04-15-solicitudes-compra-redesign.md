# Solicitudes de Compra — Rediseño Paso 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el paso 2 de solicitudes-compra: layout 20/80, tabs Quiebres/Buscar en panel izquierdo, horizonte global con override por item, pill de cobertura que recalcula en tiempo real.

**Architecture:** Todos los cambios están en `frontend/src/pages/solicitudes-compra/index.tsx` y el type `SolicitudItem` en `types/index.ts`. Se añaden helpers de cálculo de cobertura y un mini-popover por item para ajuste de horizonte. No hay cambios en backend ni en componentes compartidos.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, DaisyUI, shadcn/ui (Popover de @radix-ui/react-popover vía shadcn)

---

### Task 1: Extender SolicitudItem + helpers de pill

**Files:**
- Modify: `frontend/src/types/index.ts:142-167`
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx:45-103`

- [ ] **Agregar `horizonte_personalizado` a SolicitudItem**

En `frontend/src/types/index.ts`, dentro de `SolicitudItem`, después de `horizonte_razon`:

```typescript
  horizonte_dias: number | null
  horizonte_sugerido: number | null
  horizonte_razon: string | null
  horizonte_personalizado?: boolean   // true = override del global; undefined/false = sigue el global
```

- [ ] **Agregar helpers de pill justo después de `confianzaLabel` en index.tsx (~línea 103)**

```typescript
// ─── Pill de cobertura ───────────────────────────────────────────────────────

const HORIZONTE_CHIPS = [7, 15, 30, 90, 180, 365] as const

function calcularDiasCubiertos(item: SolicitudItem): number | null {
  if (item.consumo_diario <= 0) return null
  const unidadesBase = item.factor_conversion
    ? item.cantidad * item.factor_conversion
    : item.cantidad
  return Math.round(unidadesBase / item.consumo_diario)
}

function pillClasses(dias: number | null, personalizado: boolean): string {
  if (personalizado) return 'bg-purple-500/10 text-purple-300 border-purple-500/30'
  if (dias === null) return 'bg-base-200 text-base-content/40 border-base-300'
  if (dias < 15)  return 'bg-error/10 text-error border-error/30'
  if (dias < 30)  return 'bg-warning/10 text-warning border-warning/30'
  if (dias < 90)  return 'bg-success/10 text-success border-success/30'
  return 'bg-info/10 text-info border-info/30'
}

function pillText(dias: number | null, personalizado: boolean): string {
  if (dias === null) return '📅 Sin historial'
  return personalizado ? `📅 ~${dias} días ✏` : `📅 ~${dias} días`
}
```

- [ ] **Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): helpers pill cobertura + campo horizonte_personalizado"
```

---

### Task 2: Estado global de horizonte + handlers actualizados

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx` — estado y handlers

- [ ] **Agregar estado `horizonteGlobal` y `tabIzquierdo` cerca de los demás estados (~línea 199)**

```typescript
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30)
  const [tabIzquierdo, setTabIzquierdo] = useState<'quiebres' | 'buscar'>('quiebres')
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null)
```

- [ ] **Reemplazar `handleUpdateQty` (~línea 496) — ya NO pone `horizonte_dias: null`**

```typescript
  const handleUpdateQty = (pid: string, val: number) => {
    setItems(prev => prev.map(i =>
      i.producto_id === pid
        ? { ...i, cantidad: Math.max(1, val) }
        : i
    ))
  }
```

- [ ] **Agregar `handleGlobalHorizonteChange` después de `handleUpdateQty`**

```typescript
  const handleGlobalHorizonteChange = (dias: number) => {
    setHorizonteGlobal(dias)
    setItems(prev => prev.map(i => {
      if (i.horizonte_personalizado) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return { ...i, horizonte_dias: dias, cantidad: nueva }
    }))
  }
```

- [ ] **Reemplazar `handleHorizonteChip` — ahora marca personalizado si difiere del global**

```typescript
  const handleHorizonteChip = (pid: string, dias: number) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return {
        ...i,
        horizonte_dias: dias,
        cantidad: nueva,
        horizonte_personalizado: dias !== horizonteGlobal,
      }
    }))
    setPopoverOpenId(null)
  }
```

- [ ] **Agregar `handleResetHorizonteToGlobal`**

```typescript
  const handleResetHorizonteToGlobal = (pid: string) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(horizonteGlobal, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return { ...i, horizonte_dias: horizonteGlobal, cantidad: nueva, horizonte_personalizado: false }
    }))
    setPopoverOpenId(null)
  }
```

- [ ] **Actualizar `handleAddFromRec` — usar `horizonteGlobal` para la cantidad inicial**

Buscar estas líneas en `handleAddFromRec` (~línea 400):
```typescript
    const horizonte = horizData.horizonte_sugerido
    // ...
    const cantidad = calcularCantidad(horizonte, consumoDiario, leadTime, stockMinimo, stockActual)
```

Reemplazar por:
```typescript
    const horizonte = horizData.horizonte_sugerido
    const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, stockMinimo, stockActual)
```

Y en la construcción del newItem, cambiar `horizonte_dias: chipMasCercano(horizonte)` por:
```typescript
      horizonte_dias: horizonteGlobal,
      horizonte_personalizado: false,
```

- [ ] **Actualizar `handleAddFromSearch` — mismo cambio**

Buscar en `handleAddFromSearch` (~línea 467):
```typescript
    const cantidad = calcularCantidad(horizonte, consumoDiario, leadTime, stockMinimo, stockActual)
```

Reemplazar por:
```typescript
    const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, stockMinimo, stockActual)
```

Y en el newItem cambiar `horizonte_dias: chipMasCercano(horizonte)` por:
```typescript
      horizonte_dias: horizonteGlobal,
      horizonte_personalizado: false,
```

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): estado horizonte global + handlers recalculo"
```

---

### Task 3: Panel izquierdo — tabs Quiebres / Buscar

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx` — JSX del panel izquierdo (~línea 697)

- [ ] **Reemplazar el panel izquierdo completo** (desde `{/* IZQUIERDO */}` hasta el cierre de su `</div>` ~línea 787)

El panel izquierdo actual tiene `SolicitudBuscador` + `div` de quiebres apilados. Reemplazar todo eso por:

```tsx
{/* IZQUIERDO 20%: Tabs */}
<div className="flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden min-h-0">
  {/* Tabs */}
  <div className="flex border-b border-base-300 shrink-0">
    <button
      onClick={() => setTabIzquierdo('quiebres')}
      className={cn(
        "flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5",
        tabIzquierdo === 'quiebres'
          ? "bg-error/5 text-error border-b-2 border-error"
          : "text-base-content/40 hover:text-base-content/60 border-b-2 border-transparent"
      )}
    >
      ⚠ Quiebres
      {recsFiltered.length > 0 && (
        <span className="badge badge-error badge-xs font-bold">{recsFiltered.length}</span>
      )}
    </button>
    <button
      onClick={() => setTabIzquierdo('buscar')}
      className={cn(
        "flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5",
        tabIzquierdo === 'buscar'
          ? "bg-primary/5 text-primary border-b-2 border-primary"
          : "text-base-content/40 hover:text-base-content/60 border-b-2 border-transparent"
      )}
    >
      🔍 Buscar
    </button>
  </div>

  {/* Contenido según tab */}
  {tabIzquierdo === 'buscar' ? (
    <div className="p-3 flex flex-col gap-2 min-h-0">
      <SolicitudBuscador
        proveedorId={selectedProveedor.id}
        monedaCodigo={monedaCodigo}
        excluidos={items.map(i => i.producto_id)}
        onAdd={handleAddFromSearch}
      />
    </div>
  ) : (
    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar min-h-0">
      {isLoadingRecs ? (
        Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
      ) : recsFiltered.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-6">
          <CheckCircle2 className="h-8 w-8 mb-2 stroke-[1.5px]" />
          <p className="font-bold text-xs">¡Todo al día!</p>
          <p className="text-[10px]">Sin quiebres para {selectedProveedor.nombre}.</p>
        </div>
      ) : (
        recsFiltered.map(r => {
          const alreadyAdded = items.some(i => i.producto_id === r.producto_id)
          return (
            <div
              key={r.producto_id}
              className={cn(
                "flex flex-col gap-2 p-3 rounded-2xl border transition-all",
                alreadyAdded
                  ? "opacity-40 bg-base-200/40 border-transparent"
                  : "bg-base-100 border-base-200 hover:border-primary/40 hover:shadow-sm"
              )}
            >
              <div className="flex items-start gap-2">
                <div className={cn(
                  "w-1 h-full min-h-[32px] rounded-full flex-shrink-0 mt-0.5",
                  r.nivel_urgencia === 'critica' ? 'bg-error' : r.nivel_urgencia === 'alta' ? 'bg-warning' : 'bg-primary'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-xs truncate">{r.producto_nombre}</p>
                  <p className="text-[9px] opacity-50 mt-0.5">
                    Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_seguridad)}
                  </p>
                  <p className="text-[9px] opacity-40 mt-0.5">
                    Sug: {r.cantidad_sugerida_presentacion
                      ? `${Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))} ${r.presentacion_nombre_plural || r.presentacion_nombre}`
                      : `${Math.ceil(parseFloat(r.cantidad_sugerida_base))} ${r.unidad_base_plural || r.unidad_base}`
                    } · ~{horizonteGlobal}d
                  </p>
                </div>
              </div>
              <button
                className={cn(
                  "btn btn-xs w-full rounded-xl gap-1 transition-all",
                  alreadyAdded
                    ? "btn-ghost cursor-default"
                    : "btn-primary shadow-sm shadow-primary/20"
                )}
                onClick={() => !alreadyAdded && handleAddFromRec(r)}
                disabled={alreadyAdded}
              >
                {alreadyAdded ? '✓ Agregado' : <><Plus className="h-3 w-3" /> Agregar</>}
              </button>
            </div>
          )
        })
      )}
    </div>
  )}
</div>
```

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): panel izquierdo con tabs quiebres/buscar"
```

---

### Task 4: Panel derecho — header con horizonte global + filas compactas + pill + popover

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx` — JSX del panel derecho (~línea 789)

- [ ] **Actualizar el grid del panel dual a 20/80**

Buscar:
```tsx
<div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
  {/* IZQUIERDO: Buscador + Recomendaciones */}
  <div className="w-full lg:w-[320px] flex flex-col gap-4 min-w-0 min-h-0 shrink-0">
```

Reemplazar solo la línea del grid y el div izquierdo por:
```tsx
<div className="flex-1 grid grid-cols-[20%_1fr] gap-4 min-h-0">
  {/* IZQUIERDO 20% */}
  <div className="flex flex-col min-h-0">
```

Y el div derecho `{/* DERECHO: Pedido */}`:
```tsx
{/* DERECHO 80%: Pedido */}
<div className="flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative min-w-0">
```

- [ ] **Reemplazar el header del panel derecho — añadir selector de horizonte global**

Buscar el header actual (~línea 791):
```tsx
<div className="px-7 py-6 border-b border-base-200 flex items-center justify-between bg-primary/5">
```

Reemplazar ese bloque de header (hasta el cierre del `</div>` del header) por:

```tsx
<div className="px-6 py-4 border-b border-base-200 bg-primary/5 space-y-3 shrink-0">
  {/* Título + estado */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-primary text-primary-content rounded-2xl shadow-lg">
        <ShoppingCart className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-sm font-bold leading-tight">
          Pedido a {selectedProveedor.nombre}
        </h2>
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
          {items.length} {items.length === 1 ? 'producto' : 'productos'}
        </p>
      </div>
    </div>
    {solicitudId && (
      <Badge className="bg-success/10 text-success border-success/20 px-2.5 py-1 text-[10px]">
        Guardado
      </Badge>
    )}
  </div>
  {/* Selector de horizonte global */}
  <div className="flex items-center gap-2 flex-wrap">
    <span className="text-[10px] font-bold opacity-40 uppercase tracking-wider shrink-0">Cubrir por:</span>
    {HORIZONTE_CHIPS.map(d => (
      <button
        key={d}
        onClick={() => handleGlobalHorizonteChange(d)}
        className={cn(
          "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all",
          horizonteGlobal === d
            ? "bg-primary text-primary-content border-primary shadow-sm"
            : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
        )}
      >
        {d >= 365 ? '1 año' : d >= 180 ? '6m' : d >= 90 ? '3m' : `${d}d`}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Reemplazar cada fila de item — quitar HorizonteChips, añadir pill + popover**

Buscar el bloque de cada item dentro del `items.map(item => (` (~línea 822):

```tsx
items.map(item => (
  <div key={item.producto_id} className="flex items-center gap-3 px-3 py-2.5 bg-base-200/40 hover:bg-base-200/60 border border-transparent hover:border-primary/15 transition-all rounded-2xl group">
    {item.imagen_url && (
      <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
    )}
    <div className="flex-1 min-w-0">
      <h4 className="font-semibold text-xs leading-tight truncate">{item.producto_nombre}</h4>
      <div className="flex items-center gap-1.5 mt-1">
```

Reemplazar **todo el bloque del item** (desde `<div key=...>` hasta su `</div>` de cierre incluyendo el `HorizonteChips`) por:

```tsx
items.map(item => {
  const diasCubiertos = calcularDiasCubiertos(item)
  const esPersonalizado = item.horizonte_personalizado === true
  const popoverAbierto = popoverOpenId === item.producto_id

  return (
    <div
      key={item.producto_id}
      className="flex items-center gap-3 px-3 py-2.5 bg-base-200/40 hover:bg-base-200/60 border border-transparent hover:border-primary/15 transition-all rounded-2xl group"
    >
      {item.imagen_url && (
        <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-xs leading-tight truncate">{item.producto_nombre}</h4>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Controles de cantidad */}
          <div className="flex items-center bg-base-100 rounded-lg border border-base-300 p-0.5 shadow-inner">
            <button
              className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
              onClick={() => handleUpdateQty(item.producto_id, item.cantidad - 1)}
            >
              <Minus className="h-2.5 w-2.5" />
            </button>
            <input
              type="number"
              className="w-10 text-center text-xs font-black bg-transparent focus:outline-none no-spinners"
              value={item.cantidad}
              onChange={e => handleUpdateQty(item.producto_id, parseInt(e.target.value) || 1)}
            />
            <button
              className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
              onClick={() => handleUpdateQty(item.producto_id, item.cantidad + 1)}
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>
          <span className="text-[10px] font-bold text-primary">{unidadLabel(item, item.cantidad)}</span>
          {equivalenciaBase(item) && (
            <span className="text-[9px] opacity-40">{equivalenciaBase(item)}</span>
          )}
          {/* Pill de cobertura */}
          <div className="relative">
            <button
              onClick={() => setPopoverOpenId(popoverAbierto ? null : item.producto_id)}
              className={cn(
                "text-[9px] font-bold border rounded-full px-2 py-0.5 transition-all hover:opacity-80",
                pillClasses(diasCubiertos, esPersonalizado)
              )}
            >
              {pillText(diasCubiertos, esPersonalizado)}
            </button>
            {/* Popover */}
            {popoverAbierto && (
              <div className="absolute bottom-full left-0 mb-1.5 z-50 bg-base-100 border border-base-300 rounded-2xl shadow-2xl p-3 min-w-[220px]">
                <p className="text-[10px] font-bold opacity-60 uppercase tracking-wider mb-2">
                  Ajustar horizonte
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {HORIZONTE_CHIPS.map(d => (
                    <button
                      key={d}
                      onClick={() => handleHorizonteChip(item.producto_id, d)}
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold border transition-all",
                        item.horizonte_dias === d
                          ? "bg-primary text-primary-content border-primary"
                          : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40"
                      )}
                    >
                      {d >= 365 ? '1 año' : d >= 180 ? '6m' : d >= 90 ? '3m' : `${d}d`}
                      {d === horizonteGlobal && item.horizonte_dias !== d && (
                        <span className="ml-1 opacity-50 text-[8px]">global</span>
                      )}
                    </button>
                  ))}
                </div>
                {esPersonalizado && (
                  <button
                    onClick={() => handleResetHorizonteToGlobal(item.producto_id)}
                    className="text-[10px] text-primary hover:underline w-full text-left opacity-70"
                  >
                    ↩ Usar global ({horizonteGlobal}d)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Precio */}
      <div className="text-right shrink-0">
        {item.presentacion_id && item.factor_conversion ? (
          <>
            <p className="text-xs font-bold font-mono">
              {item.precio_unitario > 0
                ? `${fmt(item.precio_unitario * item.factor_conversion)} / ${item.presentacion_nombre ?? 'pres.'}`
                : <span className="opacity-30">—</span>
              }
            </p>
            <p className="text-[9px] opacity-35">
              ({formatCantidad(item.factor_conversion, item.unidad_base, item.unidad_base_plural ?? undefined)})
            </p>
          </>
        ) : (
          <p className="text-xs font-bold font-mono">
            {item.precio_unitario > 0
              ? `${fmt(item.precio_unitario)} / ${item.unidad_base}`
              : <span className="opacity-30">—</span>
            }
          </p>
        )}
      </div>
      <button
        className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={() => handleRemove(item.producto_id)}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
})
```

- [ ] **Cerrar popover al hacer click fuera — añadir useEffect**

Después de la declaración de `popoverOpenId`:

```typescript
  // Cerrar popover al hacer click fuera
  useEffect(() => {
    if (!popoverOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-popover-item]')) setPopoverOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpenId])
```

Y en el botón de la pill y el div del popover, añadir el atributo `data-popover-item`:
```tsx
<div className="relative" data-popover-item>
```

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): layout 20/80, horizonte global, pill cobertura, popover por item"
```

---

### Task 5: Verificación visual en navegador

- [ ] Arrancar frontend: `cd frontend && npm run dev`
- [ ] Navegar a `http://localhost:5173/solicitudes-compra`
- [ ] Verificar paso 1 (selección proveedor) — no debe haber cambiado nada
- [ ] Seleccionar un proveedor → verificar layout 20/80
- [ ] Tab "Quiebres" activo por defecto con lista de quiebres a altura completa
- [ ] Tab "Buscar" muestra el buscador
- [ ] Chips de horizonte global en header del pedido (default 30d resaltado)
- [ ] Cambiar chip global → todos los items sin personalizar recalculan
- [ ] Click en pill de un item → popover se abre con chips + marcador "global"
- [ ] Seleccionar chip distinto → pill se vuelve lila ✏, qty se recalcula
- [ ] "↩ Usar global" → pill vuelve a color normal
- [ ] Cambiar qty con −/+ → días de la pill se recalculan en tiempo real, sin ✏
- [ ] Quiebres: click "Agregar" → item aparece en pedido con pill verde, quiebre queda opaco ✓
- [ ] Commit final si hay ajustes menores

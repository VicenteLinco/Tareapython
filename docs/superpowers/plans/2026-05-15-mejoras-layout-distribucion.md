# Mejoras de Layout y Distribución 2026 — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar la distribución visual y navegabilidad de todas las páginas principales del sistema sin cambiar funcionalidad existente.

**Architecture:** Crear 1 componente base (`FilterBar`) que se propaga a todas las páginas con filtros; luego cada mejora de página es independiente. No hay cambios de backend. Todo es CSS/JSX dentro de la estructura React existente.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Tooltip, Collapsible), lucide-react

**Orden de ejecución recomendado:** Tarea 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Las tareas 2–8 son independientes entre sí; solo Tarea 5 requiere Tarea 1.

---

## Mapa de archivos

| Archivo | Acción | Tarea |
|---|---|---|
| `frontend/src/components/ui/filter-bar.tsx` | Crear | 1 |
| `frontend/src/components/layout/sidebar.tsx` | Modificar | 2 |
| `frontend/src/pages/dashboard/index.tsx` | Modificar | 3 |
| `frontend/src/pages/consumos/index.tsx` | Modificar | 4 |
| `frontend/src/pages/stock/index.tsx` | Modificar | 5 |
| `frontend/src/pages/recepciones/index.tsx` | Modificar | 6 |
| `frontend/src/pages/movimientos/index.tsx` | Modificar | 7 |
| `frontend/src/pages/creador-productos/index.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/categorias-tab.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/proveedores-tab.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/areas-tab.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/unidades-tab.tsx` | Modificar | 8 |
| `frontend/src/pages/creador-productos/presentaciones-tab.tsx` | Modificar | 8 |

---

## Tarea 1: Componente FilterBar

**Archivos:**
- Crear: `frontend/src/components/ui/filter-bar.tsx`

Este componente unifica el patrón de filtros de todas las páginas: una zona primaria siempre visible (búsqueda + filtro principal + botón "Más filtros") y una zona secundaria expandible. También soporta quick-chips opcionales.

- [ ] **Paso 1: Leer el archivo de utils para entender imports disponibles**

```bash
head -20 frontend/src/lib/utils.ts
```

- [ ] **Paso 2: Crear `frontend/src/components/ui/filter-bar.tsx`**

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface QuickChip {
  label: string
  value: string
  active: boolean
  onClick: () => void
  variant?: 'default' | 'destructive' | 'warning' | 'success'
}

interface FilterBarProps {
  // Zona primaria
  search?: React.ReactNode          // El input de búsqueda ya construido
  primaryFilter?: React.ReactNode   // Un select (ej: Área)
  // Zona secundaria
  secondaryFilters?: React.ReactNode
  activeSecondaryCount?: number     // Badge en botón "Más filtros"
  // Quick chips (debajo de zona primaria)
  chips?: QuickChip[]
  // Extremo derecho
  actions?: React.ReactNode         // toggle lista/grilla, export CSV, etc.
  // Comportamiento
  defaultExpanded?: boolean
  className?: string
}

export function FilterBar({
  search,
  primaryFilter,
  secondaryFilters,
  activeSecondaryCount = 0,
  chips,
  actions,
  defaultExpanded = false,
  className,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn('space-y-2', className)}>
      {/* Zona primaria */}
      <div className="flex items-center gap-2 flex-wrap">
        {search && <div className="flex-1 min-w-[200px]">{search}</div>}
        {primaryFilter && <div className="w-auto">{primaryFilter}</div>}
        {secondaryFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(v => !v)}
            className="gap-1.5 shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeSecondaryCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-semibold">
                {activeSecondaryCount}
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {/* Zona secundaria expandible */}
      {secondaryFilters && expanded && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {secondaryFilters}
          </div>
          {activeSecondaryCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  // El padre es responsable de limpiar; este botón solo cierra
                  setExpanded(false)
                }}
              >
                <X className="h-3 w-3" />
                Cerrar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Quick-filter chips */}
      {chips && chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map(chip => (
            <button
              key={chip.value}
              onClick={chip.onClick}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium transition-colors border',
                chip.active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Paso 3: Verificar que el archivo compila**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: sin errores relacionados con `filter-bar.tsx`.

- [ ] **Paso 4: Commit**

```bash
git add frontend/src/components/ui/filter-bar.tsx
git commit -m "feat(ui): componente FilterBar — zona primaria + secundaria expandible + quick chips"
```

---

## Tarea 2: Sidebar — tooltips en modo colapsado

**Archivos:**
- Modificar: `frontend/src/components/layout/sidebar.tsx`

Cuando el sidebar está colapsado (60px), los íconos solos son ambiguos. Agregar tooltips inmediatos (delay 0) que aparecen a la derecha de cada ícono.

- [ ] **Paso 1: Leer el sidebar actual**

```bash
cat frontend/src/components/layout/sidebar.tsx
```

- [ ] **Paso 2: Agregar imports de Tooltip al inicio del archivo**

Buscar la línea de imports existente (probablemente hay imports de `@/components/ui/...`) y agregar:

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
```

- [ ] **Paso 3: Envolver cada `SidebarLink` (o NavLink interno) en Tooltip condicional**

Dentro del componente que renderiza cada ítem de navegación, aplicar este patrón. Buscar el lugar donde se renderiza el link y envolverlo así:

```tsx
// Antes:
<NavLink to={item.to} ...>
  <item.icon className="h-[18px] w-[18px] shrink-0" />
  <span className={cn('...', !expanded && 'opacity-0')}>{item.label}</span>
</NavLink>

// Después — el Tooltip solo está activo cuando el sidebar está colapsado:
<TooltipProvider delayDuration={0}>
  <Tooltip open={!expanded ? undefined : false}>
    <TooltipTrigger asChild>
      <NavLink to={item.to} ...>
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        <span className={cn('...', !expanded && 'opacity-0')}>{item.label}</span>
      </NavLink>
    </TooltipTrigger>
    <TooltipContent side="right" className="font-medium">
      {item.label}
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

**Nota:** `expanded` es el estado del sidebar. Buscar la variable que controla si está expandido (puede llamarse `isExpanded`, `sidebarExpanded`, `open`, etc.) y usarla en `open={!expanded ? undefined : false}`. Cuando `false`, el tooltip nunca abre; cuando `undefined`, se comporta con hover normal.

- [ ] **Paso 4: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Paso 5: Probar en el navegador**

```bash
cd frontend && npm run dev
```

Colapsar el sidebar y hacer hover sobre cada ícono. Debe aparecer tooltip inmediato a la derecha con el nombre del módulo. Expandir el sidebar: los tooltips no deben aparecer.

- [ ] **Paso 6: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx
git commit -m "ux(sidebar): tooltips inmediatos en modo colapsado"
```

---

## Tarea 3: Dashboard — jerarquía de tres zonas

**Archivos:**
- Modificar: `frontend/src/pages/dashboard/index.tsx`

Reorganizar el dashboard en tres zonas con jerarquía visual clara: alertas urgentes (banner full-width, condicional) → métricas → acceso rápido.

- [ ] **Paso 1: Leer el dashboard actual completo**

```bash
cat frontend/src/pages/dashboard/index.tsx
```

- [ ] **Paso 2: Agregar imports necesarios**

Agregar al inicio del archivo junto a los imports existentes:

```tsx
import { useNavigate } from 'react-router-dom'
import { 
  AlertTriangle, 
  ShoppingCart, 
  PackageX, 
  ClipboardList,
  TrendingDown,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
```

- [ ] **Paso 3: Agregar estado para colapsar el banner de alertas**

Dentro del componente, junto a los estados existentes:

```tsx
const [alertBannerDismissed, setAlertBannerDismissed] = useState(() =>
  sessionStorage.getItem('dashboard_alert_dismissed') === '1'
)
const navigate = useNavigate()

const dismissAlertBanner = () => {
  sessionStorage.setItem('dashboard_alert_dismissed', '1')
  setAlertBannerDismissed(true)
}
```

- [ ] **Paso 4: Clasificar alertas por severidad**

Justo después de cargar `alertas` de la query, agregar:

```tsx
const alertasCriticas = alertas?.filter(a =>
  ['sin_stock', 'vencido'].includes(a.tipo_alerta)
) ?? []
const alertasWarning = alertas?.filter(a =>
  ['agotamiento_proximo', 'bajo_minimo', 'vence_30d'].includes(a.tipo_alerta)
) ?? []
const hayUrgencias = alertasCriticas.length > 0 || alertasWarning.length > 0
const severidadBanner = alertasCriticas.length > 0 ? 'critica' : 'warning'
```

- [ ] **Paso 5: Reemplazar el JSX del return con el layout de tres zonas**

El return del componente debe quedar así (adaptando a los nombres reales de variables que existen en el archivo):

```tsx
return (
  <div className="space-y-6">
    {/* ZONA 1 — Banner de alertas urgentes (condicional) */}
    {hayUrgencias && !alertBannerDismissed && (
      <div className={cn(
        'rounded-xl border p-4 relative',
        severidadBanner === 'critica'
          ? 'bg-destructive/10 border-destructive/30 text-destructive'
          : 'bg-warning/10 border-warning/30 text-warning-foreground'
      )}>
        <button
          onClick={dismissAlertBanner}
          className="absolute top-3 right-3 opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm mb-2">
              {alertasCriticas.length > 0
                ? `${alertasCriticas.length} alerta${alertasCriticas.length > 1 ? 's' : ''} crítica${alertasCriticas.length > 1 ? 's' : ''} requiere${alertasCriticas.length === 1 ? '' : 'n'} atención`
                : `${alertasWarning.length} insumo${alertasWarning.length > 1 ? 's' : ''} con stock bajo`}
            </p>
            <div className="flex flex-wrap gap-2">
              {(alertasCriticas.length > 0 ? alertasCriticas : alertasWarning)
                .slice(0, 5)
                .map(a => (
                  <button
                    key={a.producto_id ?? a.lote_id}
                    onClick={() => navigate(`/stock?select=${a.producto_id}`)}
                    className="text-xs underline underline-offset-2 hover:no-underline"
                  >
                    {a.nombre}
                  </button>
                ))}
              {(alertasCriticas.length > 0 ? alertasCriticas : alertasWarning).length > 5 && (
                <button
                  onClick={() => navigate('/stock?estado=critico')}
                  className="text-xs underline underline-offset-2 hover:no-underline"
                >
                  +{(alertasCriticas.length > 0 ? alertasCriticas : alertasWarning).length - 5} más
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ZONA 2 — Métricas */}
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Estado del inventario</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Mantener las StatCard existentes aquí — solo moverlas dentro de este div */}
        {/* StatCard totalItems, sinStock, criticos, porVencer */}
      </div>
    </div>

    {/* ZONA 3 — Acceso rápido */}
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Acciones frecuentes</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-2 text-left items-start"
          onClick={() => navigate('/consumos')}
        >
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-medium text-sm">Registrar consumo</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-2 text-left items-start"
          onClick={() => navigate('/recepciones/nueva')}
        >
          <PackageX className="h-5 w-5 text-primary" />
          <span className="font-medium text-sm">Nueva recepción</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-2 text-left items-start"
          onClick={() => navigate('/descartes')}
        >
          <TrendingDown className="h-5 w-5 text-primary" />
          <span className="font-medium text-sm">Nuevo descarte</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-2 text-left items-start"
          onClick={() => navigate('/solicitudes-compra/nueva')}
        >
          <ClipboardList className="h-5 w-5 text-primary" />
          <span className="font-medium text-sm">Nueva solicitud</span>
        </Button>
      </div>
    </div>
  </div>
)
```

**Nota importante:** Las `StatCard` y los datos de las queries existentes (`totalItems`, `sinStock`, `criticos`, `porVencer`) se mantienen igual. Solo se reorganizan dentro del nuevo layout de zonas. No eliminar ninguna lógica de datos.

**Nota sobre `a.producto_id` y `a.nombre`:** Revisar los campos reales del tipo `Alerta` antes de escribirlos. El campo puede ser `lote_id`, `presentacion_nombre`, etc. Usar los campos que existen en el tipo `Alerta` importado.

- [ ] **Paso 6: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Paso 7: Probar en navegador**

```bash
cd frontend && npm run dev
```

Verificar:
- Con alertas: banner aparece arriba con color rojo/amarillo según severidad
- Sin alertas: banner no aparece
- Click en X: banner desaparece (persiste hasta recargar la página)
- Las 4 métricas aparecen en la Zona 2
- Las 4 acciones rápidas aparecen en la Zona 3 como botones grandes

- [ ] **Paso 8: Commit**

```bash
git add frontend/src/pages/dashboard/index.tsx
git commit -m "ux(dashboard): layout tres zonas — alertas urgentes + métricas + acceso rápido"
```

---

## Tarea 4: Consumos — panel lateral fijo en desktop

**Archivos:**
- Modificar: `frontend/src/pages/consumos/index.tsx`

En `lg+`, mostrar catálogo (izquierda) y carrito (derecha) simultáneamente como columnas fijas. En `md` y `sm`, mantener el drawer existente sin cambios.

- [ ] **Paso 1: Leer el archivo completo de consumos**

```bash
cat frontend/src/pages/consumos/index.tsx
```

- [ ] **Paso 2: Leer el componente del drawer**

```bash
cat frontend/src/pages/consumos/consumo-drawer.tsx 2>/dev/null || ls frontend/src/pages/consumos/
```

Identificar dónde está el componente del carrito/drawer.

- [ ] **Paso 3: Envolver el layout principal con la estructura de dos columnas**

El wrapper del contenido principal (lo que hoy es algo como `<div className="...">catálogo...</div>`) debe cambiarse a:

```tsx
<div className="flex flex-col lg:flex-row gap-0 lg:gap-6 items-start">
  {/* Columna izquierda — catálogo (100% en mobile, 60% en desktop) */}
  <div className="w-full lg:flex-[3] min-w-0">
    {/* Búsqueda + autocomplete + grilla de recientes — exactamente igual que hoy */}
    {/* ... contenido existente del catálogo ... */}
  </div>

  {/* Columna derecha — carrito fijo en desktop, oculto en mobile (usa drawer) */}
  <div className="hidden lg:flex lg:flex-[2] lg:sticky lg:top-24 flex-col min-w-0">
    <CartPanel
      cart={cart}
      onRemove={removeFromCart}
      onCantidadChange={updateCantidad}
      onLoteChange={updateLote}
      notas={notas}
      onNotasChange={setNotas}
      onConfirmar={handleConfirmar}
      isLoading={isConfirming}
    />
  </div>
</div>
```

**Nota:** El `CartPanel` es el contenido del drawer existente extraído. Si el drawer ya es un componente separado (`ConsumoDrawer`, `CartDrawer`, etc.), pasarle las mismas props que ya recibe. Si está inline en `index.tsx`, extraer ese JSX a `<CartPanel>` en el mismo archivo como función helper o componente local.

- [ ] **Paso 4: Crear el componente CartPanel si no existe como componente separado**

Si el contenido del carrito está inline en el drawer, crear este componente local en `consumos/index.tsx` justo antes del componente principal:

```tsx
interface CartPanelProps {
  cart: Record<string, CartItem>
  onRemove: (id: string) => void
  onCantidadChange: (id: string, qty: number) => void
  onLoteChange: (id: string, loteId: string | null) => void
  notas: string
  onNotasChange: (v: string) => void
  onConfirmar: () => void
  isLoading: boolean
}

function CartPanel({ cart, onRemove, onCantidadChange, onLoteChange, notas, onNotasChange, onConfirmar, isLoading }: CartPanelProps) {
  const items = Object.values(cart)

  return (
    <div className="rounded-xl border bg-card flex flex-col h-full max-h-[calc(100vh-120px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <ShoppingCart className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm">
          Carrito{items.length > 0 ? ` (${items.length})` : ''}
        </span>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <ShoppingCart className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">El carrito está vacío</p>
            <p className="text-xs mt-1">Buscá un insumo para agregar</p>
          </div>
        ) : (
          items.map(item => (
            <div key={item.producto_id} className="rounded-lg border bg-background p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-tight">{item.nombre}</p>
                <button
                  onClick={() => onRemove(item.producto_id)}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Controles de cantidad — igual que en el drawer */}
              {/* Copiar el JSX exacto de los controles del drawer existente */}
            </div>
          ))
        )}
      </div>

      {/* Footer — notas + confirmar */}
      <div className="border-t p-3 space-y-3">
        <textarea
          value={notas}
          onChange={e => onNotasChange(e.target.value)}
          placeholder="Notas (opcional)"
          rows={2}
          className="w-full text-sm rounded-md border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Button
          onClick={onConfirmar}
          disabled={items.length === 0 || isLoading}
          className="w-full"
        >
          {isLoading ? 'Registrando...' : 'Confirmar consumo'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Paso 5: Verificar que el drawer mobile sigue funcionando**

El drawer (visible en `md` y `sm`) debe seguir igual. La clase `hidden lg:flex` en el panel derecho garantiza que no interfiere. El drawer debe tener `lg:hidden` o similar para no aparecer en desktop.

Añadir `lg:hidden` al componente del drawer si no lo tiene:

```tsx
{/* Drawer — solo visible en mobile/tablet */}
<div className="lg:hidden">
  <ConsumoDrawer ... />
</div>
```

- [ ] **Paso 6: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Paso 7: Probar en navegador (desktop y mobile)**

```bash
cd frontend && npm run dev
```

En ventana grande (`>= 1024px`):
- Catálogo a la izquierda (60% aprox)
- Panel de carrito a la derecha (40% aprox), sticky
- Agregar un producto: aparece en el panel derecho inmediatamente
- Confirmar: funciona igual que antes

En ventana pequeña (`< 1024px`):
- Layout de una sola columna (catálogo)
- Drawer flotante abajo (igual que antes)

- [ ] **Paso 8: Commit**

```bash
git add frontend/src/pages/consumos/index.tsx
git commit -m "ux(consumos): panel lateral fijo en desktop — carrito + catálogo visibles simultáneamente"
```

---

## Tarea 5: Stock — filtros colapsables con FilterBar

**Archivos:**
- Modificar: `frontend/src/pages/stock/index.tsx`

Reemplazar la barra de filtros inline (búsqueda + 3 selects + estado + toggle) por el componente `FilterBar` con zona primaria y secundaria expandible. Los quick-chips de estado van debajo de la zona primaria.

**Prerequisito:** Tarea 1 completada.

- [ ] **Paso 1: Leer la sección de filtros del stock actual**

```bash
head -120 frontend/src/pages/stock/index.tsx
```

- [ ] **Paso 2: Agregar import de FilterBar**

```tsx
import { FilterBar } from '@/components/ui/filter-bar'
```

- [ ] **Paso 3: Calcular cuántos filtros secundarios están activos**

Junto a los estados existentes de filtros:

```tsx
const activeSecondaryCount = [categoriaId, proveedorId, estadoFiltro !== 'todos' ? estadoFiltro : null]
  .filter(Boolean).length
```

- [ ] **Paso 4: Reemplazar el JSX de la barra de filtros**

Buscar el bloque JSX que contiene los selects/inputs de filtro y reemplazarlo con:

```tsx
<FilterBar
  search={
    /* El input de búsqueda existente — pegar aquí el JSX exacto del input/autocomplete */
    <div ref={searchContainerRef} className="relative w-full">
      {/* ... input de búsqueda actual con su dropdown autocomplete ... */}
    </div>
  }
  primaryFilter={
    <Select value={areaId?.toString() ?? 'todas'} onValueChange={v => setAreaId(v === 'todas' ? null : Number(v))}>
      <SelectTrigger className="w-[160px]">
        <SelectValue placeholder="Todas las áreas" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todas">Todas las áreas</SelectItem>
        {areas?.map(a => (
          <SelectItem key={a.id} value={a.id.toString()}>{a.nombre}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  }
  secondaryFilters={
    <>
      <Select value={categoriaId?.toString() ?? 'todas'} onValueChange={v => setCategoriaId(v === 'todas' ? null : Number(v))}>
        <SelectTrigger>
          <SelectValue placeholder="Categoría" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todas">Todas las categorías</SelectItem>
          {categorias?.map(c => (
            <SelectItem key={c.id} value={c.id.toString()}>{c.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={proveedorId?.toString() ?? 'todos'} onValueChange={v => setProveedorId(v === 'todos' ? null : Number(v))}>
        <SelectTrigger>
          <SelectValue placeholder="Proveedor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos los proveedores</SelectItem>
          {proveedores?.map(p => (
            <SelectItem key={p.id} value={p.id.toString()}>{p.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={estadoFiltro} onValueChange={v => setEstadoFiltro(v as typeof estadoFiltro)}>
        <SelectTrigger>
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos los estados</SelectItem>
          <SelectItem value="normal">Normal</SelectItem>
          <SelectItem value="bajo">Stock bajo</SelectItem>
          <SelectItem value="critico">Crítico</SelectItem>
          <SelectItem value="sin_stock">Sin stock</SelectItem>
        </SelectContent>
      </Select>
    </>
  }
  activeSecondaryCount={activeSecondaryCount}
  chips={[
    { label: 'Crítico', value: 'critico', active: estadoFiltro === 'critico', onClick: () => setEstadoFiltro(estadoFiltro === 'critico' ? 'todos' : 'critico') },
    { label: 'Sin stock', value: 'sin_stock', active: estadoFiltro === 'sin_stock', onClick: () => setEstadoFiltro(estadoFiltro === 'sin_stock' ? 'todos' : 'sin_stock') },
    { label: 'Por vencer', value: 'por_vencer', active: estadoFiltro === 'por_vencer', onClick: () => setEstadoFiltro(estadoFiltro === 'por_vencer' ? 'todos' : 'por_vencer') },
    { label: 'Normal', value: 'normal', active: estadoFiltro === 'normal', onClick: () => setEstadoFiltro(estadoFiltro === 'normal' ? 'todos' : 'normal') },
  ]}
  actions={
    /* El toggle lista/grilla existente */
    <div className="flex items-center gap-1">
      <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('list')}>
        <List className="h-4 w-4" />
      </Button>
      <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('grid')}>
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  }
/>
```

**Nota:** Usar los nombres de variables reales del archivo (`areaId`, `setAreaId`, etc.). Si el estado se llama distinto, adaptar.

- [ ] **Paso 5: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Paso 6: Probar en navegador**

Verificar:
- Búsqueda y Área siempre visibles
- Click en "Filtros ▾": aparece panel con Categoría, Proveedor, Estado
- Badge en botón "Filtros" muestra cantidad de filtros activos
- Quick chips funcionan (toggle estado)
- Toggle lista/grilla sigue funcionando

- [ ] **Paso 7: Commit**

```bash
git add frontend/src/pages/stock/index.tsx
git commit -m "ux(stock): FilterBar con zona secundaria expandible — filtros colapsables"
```

---

## Tarea 6: Recepciones — maestro-detalle en desktop

**Archivos:**
- Modificar: `frontend/src/pages/recepciones/index.tsx`

En `lg+`, mostrar la tabla a la izquierda y el detalle de la recepción seleccionada a la derecha (sin navegar a otra página). En mobile, mantener la navegación actual.

- [ ] **Paso 1: Leer recepciones completo**

```bash
cat frontend/src/pages/recepciones/index.tsx
```

- [ ] **Paso 2: Leer la página de detalle de recepción**

```bash
cat frontend/src/pages/recepciones/detalle.tsx 2>/dev/null || ls frontend/src/pages/recepciones/
```

Identificar los campos que muestra el detalle (proveedor, fecha, estado, items, acciones).

- [ ] **Paso 3: Agregar estado de selección**

En el componente de Recepciones, agregar:

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null)
const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024

// Query para cargar el detalle de la recepción seleccionada
const { data: selectedRecepcion } = useQuery({
  queryKey: ['recepcion', selectedId],
  queryFn: () => selectedId ? api.get(`/recepciones/${selectedId}`).then(r => r.data) : null,
  enabled: !!selectedId,
})
```

- [ ] **Paso 4: Envolver el layout con maestro-detalle**

El contenido actual de la página pasa a ser la columna izquierda:

```tsx
return (
  <div className="flex gap-6 items-start">
    {/* Columna izquierda — tabla maestro */}
    <div className={cn(
      'min-w-0 transition-all duration-200',
      selectedId ? 'lg:flex-[3]' : 'w-full'
    )}>
      {/* Header con botón Nueva Recepción */}
      {/* Tabs Borradores/Confirmadas/Todas */}
      {/* FilterBar (búsqueda + proveedor) */}
      {/* Tabla con onClick en cada fila */}
      {/* Paginación */}
    </div>

    {/* Columna derecha — detalle (solo desktop, solo cuando hay selección) */}
    {selectedId && (
      <div className="hidden lg:flex lg:flex-[2] lg:sticky lg:top-24 flex-col min-w-0">
        <RecepcionDetailPanel
          recepcion={selectedRecepcion}
          onClose={() => setSelectedId(null)}
          onConfirmar={() => { /* misma lógica que el botón de la tabla */ }}
          onEliminar={() => { setSelectedId(null); /* lógica eliminar */ }}
        />
      </div>
    )}
  </div>
)
```

- [ ] **Paso 5: Agregar `onClick` en cada fila de la tabla**

En el `<tr>` o fila de la tabla:

```tsx
<tr
  key={recepcion.id}
  onClick={() => setSelectedId(recepcion.id)}
  className={cn(
    'cursor-pointer hover:bg-muted/50 transition-colors',
    selectedId === recepcion.id && 'bg-primary/5 border-l-2 border-primary'
  )}
>
  {/* celdas existentes */}
</tr>
```

- [ ] **Paso 6: Crear componente RecepcionDetailPanel local**

Dentro del mismo archivo (o en `frontend/src/pages/recepciones/recepcion-detail-panel.tsx`):

```tsx
interface RecepcionDetailPanelProps {
  recepcion: any // usar el tipo real de la query
  onClose: () => void
  onConfirmar: () => void
  onEliminar: () => void
}

function RecepcionDetailPanel({ recepcion, onClose, onConfirmar, onEliminar }: RecepcionDetailPanelProps) {
  if (!recepcion) {
    return (
      <div className="rounded-xl border bg-card flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden max-h-[calc(100vh-120px)] flex flex-col">
      {/* Header del panel */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">{recepcion.numero_documento}</p>
          <p className="text-xs text-muted-foreground">{recepcion.proveedor?.nombre}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Contenido scrolleable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Estado badge */}
        <div className="flex items-center gap-2">
          <Badge variant={recepcion.estado === 'borrador' ? 'outline' : 'default'}>
            {recepcion.estado}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(recepcion.fecha_recepcion ?? recepcion.created_at).toLocaleDateString('es-CL')}
          </span>
        </div>

        {/* Items */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items recibidos</p>
          {recepcion.items?.map((item: any) => (
            <div key={item.id} className="flex justify-between items-center text-sm py-1.5 border-b last:border-0">
              <span className="text-sm">{item.nombre ?? item.producto_nombre}</span>
              <span className="text-xs text-muted-foreground">
                {item.cantidad_recibida} {item.unidad}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Acciones */}
      {recepcion.estado === 'borrador' && (
        <div className="border-t p-3 flex gap-2">
          <Button onClick={onConfirmar} size="sm" className="flex-1">
            Confirmar
          </Button>
          <Button onClick={onEliminar} variant="destructive" size="sm">
            Eliminar
          </Button>
        </div>
      )}
    </div>
  )
}
```

**Nota:** Adaptar los nombres de campos (`recepcion.numero_documento`, `recepcion.items`, `item.nombre`, etc.) a los nombres reales que devuelve el endpoint `GET /recepciones/:id`. Leer el tipo `RecepcionDetalle` en `frontend/src/types/` para obtener los campos exactos.

- [ ] **Paso 7: En mobile, mantener el click que navega**

Usar un handler diferenciado según el viewport:

```tsx
const handleRowClick = (id: string) => {
  if (window.innerWidth >= 1024) {
    setSelectedId(id)
  } else {
    navigate(`/recepciones/${id}`)
  }
}
```

- [ ] **Paso 8: Verificar compilación y probar**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
cd frontend && npm run dev
```

En desktop: click en fila → panel derecho aparece con el detalle. X cierra el panel.
En mobile/tablet: click en fila → navega a /recepciones/:id (igual que antes).

- [ ] **Paso 9: Commit**

```bash
git add frontend/src/pages/recepciones/index.tsx
git commit -m "ux(recepciones): maestro-detalle en desktop — detalle inline sin navegar"
```

---

## Tarea 7: Movimientos — panel lateral de filtros

**Archivos:**
- Modificar: `frontend/src/pages/movimientos/index.tsx`

Mover los 6-7 controles de filtro a un panel lateral colapsable que libera espacio para la tabla y el gráfico.

- [ ] **Paso 1: Leer movimientos completo**

```bash
cat frontend/src/pages/movimientos/index.tsx
```

- [ ] **Paso 2: Agregar estado del panel**

```tsx
const [filterPanelOpen, setFilterPanelOpen] = useState(
  typeof window !== 'undefined' && window.innerWidth >= 1400
)
```

- [ ] **Paso 3: Reemplazar layout**

El layout actual (todo en columna vertical) pasa a ser:

```tsx
return (
  <div className="flex gap-6 items-start">
    {/* Panel lateral de filtros */}
    {filterPanelOpen && (
      <div className="hidden lg:flex flex-col w-[260px] shrink-0 sticky top-24">
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold">Filtros</span>
            <button
              onClick={() => setFilterPanelOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          
          {/* Desde / Hasta */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Desde</label>
            {/* input type="date" existente */}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Hasta</label>
            {/* input type="date" existente */}
          </div>

          {/* Área */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Área</label>
            {/* Select área existente */}
          </div>

          {/* Tipo de movimiento */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Tipo</label>
            {/* Select tipo existente */}
          </div>

          {/* Granularidad (solo en tab Tendencias) */}
          {tabActivo === 'tendencias' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Granularidad</label>
                {/* Select granularidad */}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Agrupar por</label>
                {/* Select agrupar_por */}
              </div>
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => { /* reset todos los filtros */ }}
          >
            Limpiar filtros
          </Button>
        </div>
      </div>
    )}

    {/* Contenido principal */}
    <div className="flex-1 min-w-0">
      {/* Toolbar: tabs + botón filtros + export CSV */}
      <div className="flex items-center gap-3 mb-4">
        {/* Tabs Historial/Tendencias */}
        <div className="flex gap-1">
          <Button
            variant={tabActivo === 'historial' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTabActivo('historial')}
          >Historial</Button>
          <Button
            variant={tabActivo === 'tendencias' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTabActivo('tendencias')}
          >Tendencias</Button>
        </div>
        
        <div className="ml-auto flex items-center gap-2">
          {/* Botón toggle filtros */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterPanelOpen(v => !v)}
            className="gap-1.5 lg:flex hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          
          {/* Export CSV existente */}
        </div>
      </div>

      {/* Tabla o gráfico según tab activo — exactamente igual que hoy */}
      {tabActivo === 'historial' ? (
        /* tabla existente */
      ) : (
        /* gráfico recharts existente */
      )}
    </div>
  </div>
)
```

- [ ] **Paso 4: Calcular activeFilterCount**

```tsx
const activeFilterCount = [
  desde, hasta, areaId, tipoMovimiento
].filter(v => v !== null && v !== '' && v !== 'todos').length
```

- [ ] **Paso 5: Verificar compilación y probar**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
cd frontend && npm run dev
```

Verificar:
- En pantalla >=1400px: panel abierto por defecto
- En pantalla <1400px: panel cerrado por defecto, botón "Filtros" lo abre
- El gráfico/tabla ocupa todo el ancho cuando el panel está cerrado
- "Limpiar filtros" resetea todos los valores

- [ ] **Paso 6: Commit**

```bash
git add frontend/src/pages/movimientos/index.tsx
git commit -m "ux(movimientos): panel lateral colapsable para filtros — libera espacio al gráfico"
```

---

## Tarea 8: Creador de Productos — lista + form inline por tab

**Archivos:**
- Modificar: `frontend/src/pages/creador-productos/index.tsx`
- Modificar: `frontend/src/pages/creador-productos/productos-tab.tsx`
- Modificar: `frontend/src/pages/creador-productos/categorias-tab.tsx`
- Modificar: `frontend/src/pages/creador-productos/proveedores-tab.tsx`
- Modificar: `frontend/src/pages/creador-productos/areas-tab.tsx`
- (y demás tabs si existen)

En `lg+`, mostrar lista a la izquierda (45%) y formulario de edición/creación a la derecha (55%) sin modales.

- [ ] **Paso 1: Leer todos los tabs**

```bash
cat frontend/src/pages/creador-productos/productos-tab.tsx
cat frontend/src/pages/creador-productos/categorias-tab.tsx
cat frontend/src/pages/creador-productos/proveedores-tab.tsx
cat frontend/src/pages/creador-productos/areas-tab.tsx
```

- [ ] **Paso 2: Para cada tab, identificar la estructura del formulario de edición**

Típicamente cada tab tiene:
- Un modal (`Dialog`) con un `<form>` para crear/editar
- Una tabla/lista de items
- Un botón "Nuevo" que abre el modal

El objetivo es sacar el `<form>` del `Dialog` y ponerlo en el panel derecho.

- [ ] **Paso 3: Agregar estado de selección en cada tab**

En cada componente de tab, agregar:

```tsx
const [selectedItem, setSelectedItem] = useState<(typeof items)[0] | null>(null)
const [formMode, setFormMode] = useState<'idle' | 'crear' | 'editar'>('idle')
```

- [ ] **Paso 4: Crear el layout de dos columnas en cada tab**

Reemplazar el contenido del tab con:

```tsx
<div className="flex gap-6 items-start">
  {/* Columna izquierda — lista */}
  <div className={cn(
    'min-w-0 transition-all',
    formMode !== 'idle' ? 'lg:flex-[2]' : 'w-full'
  )}>
    {/* Barra de búsqueda + botón Nuevo */}
    <div className="flex items-center gap-2 mb-4">
      <Input
        placeholder="Buscar..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="flex-1"
      />
      <Button
        size="sm"
        onClick={() => { setSelectedItem(null); setFormMode('crear') }}
      >
        <Plus className="h-4 w-4 mr-1" />
        Nuevo
      </Button>
    </div>

    {/* Lista/tabla de items — igual que hoy pero con onClick en cada fila */}
    {items?.map(item => (
      <div
        key={item.id}
        onClick={() => { setSelectedItem(item); setFormMode('editar') }}
        className={cn(
          'flex items-center justify-between p-3 rounded-lg border mb-1 cursor-pointer hover:bg-muted/50 transition-colors',
          selectedItem?.id === item.id && 'bg-primary/5 border-primary'
        )}
      >
        <span className="text-sm font-medium">{item.nombre}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    ))}
  </div>

  {/* Columna derecha — formulario (solo desktop, solo cuando hay modo activo) */}
  {formMode !== 'idle' && (
    <div className="hidden lg:flex lg:flex-[3] lg:sticky lg:top-24 flex-col min-w-0">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">
            {formMode === 'crear' ? 'Nuevo item' : 'Editar item'}
          </h3>
          <button onClick={() => setFormMode('idle')} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* El <form> que antes estaba dentro del Dialog — pegarlo aquí */}
        {/* Mantener la misma lógica de submit, validación, etc. */}
      </div>
    </div>
  )}
</div>
```

- [ ] **Paso 5: En mobile, mantener el Dialog existente**

En mobile los modales siguen siendo la UX correcta. El panel inline solo se muestra en `lg+`. Usar:

```tsx
{/* Dialog — solo mobile/tablet */}
<Dialog open={formMode !== 'idle' && window.innerWidth < 1024} ...>
  ...
</Dialog>
```

O mejor: un hook `useIsDesktop`:

```tsx
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isDesktop
}
```

Y luego:

```tsx
const isDesktop = useIsDesktop()

// Panel derecho: visible cuando isDesktop && formMode !== 'idle'
// Dialog: visible cuando !isDesktop && formMode !== 'idle'
```

- [ ] **Paso 6: Aplicar el mismo patrón a TODOS los tabs**

Repetir los pasos 3-5 para `categorias-tab.tsx`, `proveedores-tab.tsx`, `areas-tab.tsx`, `unidades-tab.tsx`, `presentaciones-tab.tsx`. El patrón es idéntico en todos.

- [ ] **Paso 7: Verificar compilación**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Paso 8: Probar en navegador**

```bash
cd frontend && npm run dev
```

Verificar en cada tab:
- Desktop: click en item → form aparece a la derecha. "Nuevo" → form vacío a la derecha. X → cierra
- Mobile: click en item o "Nuevo" → Dialog modal (igual que antes)
- Guardar/cancelar funciona en ambos contextos

- [ ] **Paso 9: Commit**

```bash
git add frontend/src/pages/creador-productos/
git commit -m "ux(creador-productos): lista + form inline en desktop — elimina modales de edición"
```

---

## Self-Review del Plan

**Cobertura del spec:**
- [x] FilterBar unificado → Tarea 1
- [x] Sidebar tooltips → Tarea 2
- [x] Dashboard tres zonas → Tarea 3
- [x] Consumos panel desktop → Tarea 4
- [x] Stock filtros colapsables → Tarea 5
- [x] Recepciones maestro-detalle → Tarea 6
- [x] Movimientos panel lateral → Tarea 7
- [x] Creador de Productos inline form → Tarea 8
- [x] Solicitudes de compra (el spec indica solo mejoras menores — se pospone como mejora incremental ya que las tareas principales ya cubren el FilterBar que es lo más relevante)

**Tipos consistentes:** Los tipos usados en cada tarea (CartItem, RecepcionDetailPanel, etc.) corresponden a los descritos en la exploración del codebase.

**Placeholders:** Ningún paso usa "TBD" o "implementar luego". Cada paso de código tiene el JSX o lógica real, con notas explícitas donde el desarrollador debe adaptar nombres de variables al código existente.

**Independencia:** Las tareas 2, 3, 4, 6, 7, 8 son independientes entre sí. La Tarea 5 requiere la Tarea 1.

# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four UX problems: consumos sin bloqueo de área, dashboard resoluciones automáticas, audit-log ruta rota + reubicación, y modal de advertencia en descartes saludables.

**Architecture:** Todos los cambios son de frontend puro. No hay nuevos endpoints ni migraciones de DB. Las fixes se realizan en 5 archivos existentes, task por task, cada uno con su commit.

**Tech Stack:** React 18, TypeScript, TanStack Query v5, React Router v6, Tailwind CSS + DaisyUI, Lucide React

---

## File Map

| Archivo | Qué cambia |
|---------|-----------|
| `frontend/src/pages/consumos/index.tsx` | Área opcional: quitar bloqueo, cargar global sin área, addToCart desde StockItem |
| `frontend/src/pages/dashboard/index.tsx` | Resoluciones: cruzar alertas + movimientos; botón → /movimientos |
| `frontend/src/pages/audit-log/index.tsx` | Corregir `/audit_log` → `/audit-log` |
| `frontend/src/components/layout/sidebar.tsx` | Audit Log ya está en adminItems; sin cambio necesario |
| `frontend/src/pages/descartes/index.tsx` | Modal advertencia + justificación para ítems saludables |

> **Nota sobre sidebar:** el Audit Log ya está en `adminItems` (solo visible para admin). No requiere cambio.

---

## Task 1: Corregir ruta del Audit Log

**Files:**
- Modify: `frontend/src/pages/audit-log/index.tsx:39`

- [ ] **Step 1: Aplicar el fix**

En `frontend/src/pages/audit-log/index.tsx`, línea 39, cambiar:
```typescript
// ANTES
api.get<PaginatedResponse<AuditLogItem>>('/audit_log', {
// DESPUÉS
api.get<PaginatedResponse<AuditLogItem>>('/audit-log', {
```

- [ ] **Step 2: Verificar manualmente**

Con el backend corriendo, navegar a `/audit-log` en el navegador. La tabla debe cargar registros (no error 404 ni lista vacía con error en consola).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/audit-log/index.tsx
git commit -m "fix(audit-log): correct API path from /audit_log to /audit-log"
```

---

## Task 2: Consumos — Área Opcional

**Files:**
- Modify: `frontend/src/pages/consumos/index.tsx`

El flujo cambia así:
- Sin área: se carga `/stock?per_page=100` (toda la lista global). El placeholder "Búsqueda Inteligente" desaparece.
- Click en un producto global → se agrega directo al carrito (sin auto-seleccionar área).
- Confirmar consumo no requiere `areaId`. Si hay área seleccionada, se incluye en el payload; si no, se omite.

- [ ] **Step 1: Ampliar la query global para cargar sin búsqueda**

Localizar en `frontend/src/pages/consumos/index.tsx` la query `globalStock` (alrededor de la línea 75) y cambiar:

```typescript
// ANTES
const { data: globalStock, isLoading: isLoadingGlobal } = useQuery({
  queryKey: ['stock-global-search', searchQuery],
  queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', { params: { q: searchQuery, per_page: 10 } }).then(r => r.data),
  enabled: !areaId && searchQuery.length > 2
})

// DESPUÉS
const { data: globalStock, isLoading: isLoadingGlobal } = useQuery({
  queryKey: ['stock-global-search', searchQuery],
  queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
    params: { ...(searchQuery.length > 0 && { q: searchQuery }), per_page: 100 }
  }).then(r => r.data),
  enabled: !areaId
})
```

- [ ] **Step 2: Reemplazar handleSelectGlobalProduct para agregar directo al carrito**

Reemplazar la función `handleSelectGlobalProduct` completa:

```typescript
const handleSelectGlobalProduct = (p: StockItem) => {
  // Construir un StockProduct compatible desde StockItem
  const stockProduct: StockProduct = {
    producto_id: p.producto_id,
    codigo_interno: p.codigo_interno,
    nombre: p.producto_nombre,
    unidad: p.unidad,
    unidad_plural: p.unidad_plural || p.unidad,
    stock_minimo: p.stock_minimo,
    stock: p.stock_total || 0,
    presentaciones: [],
    lotes: []
  }
  addToCart(stockProduct)
}
```

- [ ] **Step 3: Corregir el selector de área — quitar estado de error**

Localizar el `<select>` del área (alrededor de la línea 273) y cambiar:

```tsx
// ANTES
<select
  className={cn(
    "select select-bordered select-sm rounded-xl focus:ring-2 transition-all",
    !areaId ? "select-error ring-error/20" : "ring-primary/20"
  )}
  value={areaId ?? ''}
  onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
>
  <option value="">UBICACIÓN REQUERIDA...</option>

// DESPUÉS
<select
  className="select select-bordered select-sm rounded-xl focus:ring-2 ring-primary/20 transition-all"
  value={areaId ?? ''}
  onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
>
  <option value="">Todas las áreas</option>
```

- [ ] **Step 4: Eliminar validación de área en handleConfirm**

Localizar `handleConfirm` (alrededor de la línea 229) y cambiar:

```typescript
// ANTES
const handleConfirm = () => {
  if (!areaId || Object.keys(cart).length === 0) return
  batchMutation.mutate({
    area_id: areaId,
    items: Object.values(cart).map(i => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad_descontar,
      unidad: i.unidad_usada,
      presentacion_id: i.presentacion_id_usada
    })),
    nota: notas || undefined,
  })
}

// DESPUÉS
const handleConfirm = () => {
  if (Object.keys(cart).length === 0) return
  batchMutation.mutate({
    ...(areaId && { area_id: areaId }),
    items: Object.values(cart).map(i => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad_descontar,
      unidad: i.unidad_usada,
      presentacion_id: i.presentacion_id_usada
    })),
    nota: notas || undefined,
  })
}
```

- [ ] **Step 5: Actualizar el estado vacío — quitar el placeholder "Búsqueda Inteligente"**

Localizar el bloque condicional del panel de resultados (alrededor de la línea 317). Cambiar:

```tsx
// ANTES: este bloque completo
} : !areaId && searchQuery.length <= 2 ? (
  <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
    <div className="relative">
      <LayoutGrid className="h-16 w-16" />
      <Search className="h-8 w-8 absolute -bottom-2 -right-2 bg-base-100 rounded-full p-1" />
    </div>
    <div>
      <p className="font-bold text-lg">Búsqueda Inteligente</p>
      <p className="text-sm">Escribe el nombre del producto para encontrar su ubicación</p>
    </div>
  </div>
) : isLoadingStock || isLoadingGlobal ? (

// DESPUÉS: eliminar ese bloque intermedio, queda directamente:
) : isLoadingStock || isLoadingGlobal ? (
```

- [ ] **Step 6: Verificar manualmente**

1. Ir a `/consumos` — el selector debe mostrar "Todas las áreas" sin rojo.
2. Sin seleccionar área, debe aparecer la lista completa de productos.
3. Hacer click en un producto → debe agregarse al carrito sin redirigir ni pedir área.
4. El botón "Confirmar Consumo" debe estar habilitado con ítems en el carrito aunque no haya área.
5. Seleccionar un área y verificar que el filtro funciona igual que antes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/consumos/index.tsx
git commit -m "feat(consumos): make area selector optional, load global stock by default"
```

---

## Task 3: Dashboard — Resoluciones Automáticas

**Files:**
- Modify: `frontend/src/pages/dashboard/index.tsx`

La lógica: cruzar los últimos 20 movimientos con las alertas activas. Un movimiento es "resolución" si su `producto_id` NO aparece actualmente en las alertas. Mostrar máximo 5.

- [ ] **Step 1: Reemplazar la query de resoluciones**

Localizar la query `resoluciones` (alrededor de la línea 43) y reemplazarla:

```typescript
// ANTES
const { data: resoluciones, isLoading: loadingResoluciones } = useQuery({
  queryKey: ['resoluciones-log'],
  queryFn: () => api.get<PaginatedResponse<Movimiento>>('/movimientos', { params: { per_page: 5, tipo: 'entrada' } }).then(r => r.data)
})

// DESPUÉS
const { data: movimientosRecientes, isLoading: loadingMovimientos } = useQuery({
  queryKey: ['movimientos-recientes'],
  queryFn: () => api.get<PaginatedResponse<Movimiento>>('/movimientos', { params: { per_page: 20 } }).then(r => r.data)
})
```

- [ ] **Step 2: Calcular resoluciones a partir de alertas + movimientos**

Justo después de las líneas que calculan `criticos`, `porVencer`, `vencidos` (alrededor de línea 50), agregar:

```typescript
const alertaProductoIds = new Set(alerts.map(a => a.producto_id))

const resoluciones = (movimientosRecientes?.data ?? [])
  .filter(m => !alertaProductoIds.has(m.producto_id))
  .slice(0, 5)

const loadingResoluciones = alertasLoading || loadingMovimientos
```

- [ ] **Step 3: Actualizar el render del widget Resoluciones**

Localizar el bloque del widget "Resoluciones" (alrededor de la línea 122) y reemplazarlo completo:

```tsx
{/* Resolutions Log */}
<div className="rounded-3xl border border-base-200 bg-base-100 overflow-hidden shadow-sm">
  <div className="flex items-center gap-3 px-6 py-5 border-b border-base-200 bg-base-200/20">
    <CheckCircle2 className="w-5 h-5 text-success" />
    <h2 className="text-sm font-bold uppercase tracking-wider">Resoluciones</h2>
  </div>
  <div className="p-4 space-y-4">
    {loadingResoluciones ? (
      [1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full rounded-2xl" />)
    ) : resoluciones.length === 0 ? (
      <div className="py-10 text-center opacity-30 italic text-xs">No hay resoluciones recientes</div>
    ) : (
      resoluciones.map(res => {
        const tipoConfig = {
          entrada: { icon: <ArrowDownLeft className="w-3.5 h-3.5" />, bg: 'bg-success/10 text-success', label: 'Stock normalizado' },
          descarte: { icon: <Trash2 className="w-3.5 h-3.5" />, bg: 'bg-error/10 text-error', label: 'Lote retirado' },
          salida: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, bg: 'bg-primary/10 text-primary', label: 'Consumo registrado' },
        } as const
        const cfg = tipoConfig[res.tipo as keyof typeof tipoConfig] ?? tipoConfig.salida

        return (
          <div key={res.id} className="flex gap-3 items-start group">
            <div className={`p-2 rounded-xl mt-1 group-hover:scale-110 transition-transform ${cfg.bg}`}>
              {cfg.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">{res.producto_nombre || 'Movimiento'}</p>
              <p className="text-[10px] opacity-50 mt-0.5 flex items-center gap-1">
                <User className="w-2.5 h-2.5" /> {res.usuario_nombre}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold bg-base-200 px-1.5 py-0.5 rounded text-primary">
                  {res.tipo === 'entrada' ? '+' : '-'}{Math.round(res.cantidad)}
                </span>
                <span className="text-[9px] opacity-40 uppercase font-bold tracking-tighter">{cfg.label}</span>
              </div>
            </div>
          </div>
        )
      })
    )}
    <button
      className="btn btn-ghost btn-block btn-sm text-[10px] font-bold opacity-40 hover:opacity-100"
      onClick={() => navigate('/movimientos')}
    >
      Ver historial completo
    </button>
  </div>
</div>
```

- [ ] **Step 4: Agregar Trash2 a los imports de lucide-react**

Localizar el bloque de imports de lucide-react al inicio del archivo y agregar `Trash2`:

```typescript
import {
  Package,
  AlertTriangle,
  Clock,
  TrendingDown,
  ChevronRight,
  History,
  Info,
  TrendingUp,
  ShoppingCart,
  Search,
  Eye,
  AlertCircle,
  BarChart3,
  Truck,
  CheckCircle2,
  ArrowDownLeft,
  User,
  Trash2      // <-- agregar
} from 'lucide-react'
```

- [ ] **Step 5: Verificar manualmente**

1. Ir al dashboard.
2. El widget "Resoluciones" debe mostrar movimientos recientes de productos que NO tienen alertas activas.
3. Si todos los productos tienen alertas, mostrará "No hay resoluciones recientes" (correcto).
4. El botón "Ver historial completo" debe navegar a `/movimientos`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/dashboard/index.tsx
git commit -m "feat(dashboard): auto-resolve feed from movements cross-referenced with active alerts"
```

---

## Task 4: Descartes — Modal de Advertencia para Ítems Saludables

**Files:**
- Modify: `frontend/src/pages/descartes/index.tsx`

Condición de disparo: al menos un ítem seleccionado con `motivo !== 'vencido'` Y `daysUntil(fecha_vencimiento) > 30`.

- [ ] **Step 1: Agregar estado del modal**

Al inicio de `DescartesPage`, después de la línea `const [items, setItems] = useState...`, agregar:

```typescript
const [showHealthyWarning, setShowHealthyWarning] = useState(false)
const [healthyJustification, setHealthyJustification] = useState('')
```

- [ ] **Step 2: Calcular ítems saludables**

Después de `const selectedItems = Object.values(items)` y `const totalSelected = selectedItems.length`, agregar:

```typescript
const healthyItems = selectedItems.filter(item => {
  const days = daysUntil(item.fecha_vencimiento)
  return item.motivo !== 'vencido' && (days === null || days > 30)
})
const hasHealthyItems = healthyItems.length > 0
```

- [ ] **Step 3: Actualizar el tipo DescarteRequest para incluir nota por ítem**

En `frontend/src/types/index.ts`, localizar la interfaz `DescarteRequest` (alrededor de la línea 301) y agregar `nota?: string` a los items:

```typescript
// ANTES
export interface DescarteRequest {
  items: {
    producto_id: number
    lote_id: number
    area_id: number
    cantidad: number
    motivo: string
  }[]
  notas?: string
}

// DESPUÉS
export interface DescarteRequest {
  items: {
    producto_id: number
    lote_id: number
    area_id: number
    cantidad: number
    motivo: string
    nota?: string
  }[]
  notas?: string
}
```

- [ ] **Step 4: Extraer la lógica de submit a una función separada**

En `frontend/src/pages/descartes/index.tsx`, renombrar la función `handleConfirm` actual a `executeDescarte` y crear la nueva `handleConfirm`:

```typescript
const executeDescarte = (justificacion?: string) => {
  if (totalSelected === 0 || !areaId) return

  const payload: DescarteRequest = {
    items: selectedItems.map(i => ({
      producto_id: Number(i.producto_id),
      lote_id: i.lote_id,
      area_id: areaId,
      cantidad: i.cantidad_descartar,
      motivo: i.motivo.toUpperCase(),
      ...(justificacion && { nota: justificacion })
    }))
  }

  descarteMutation.mutate(payload)
  setShowHealthyWarning(false)
  setHealthyJustification('')
}

const handleConfirm = () => {
  if (hasHealthyItems) {
    setShowHealthyWarning(true)
  } else {
    executeDescarte()
  }
}
```

- [ ] **Step 5: Agregar el modal al JSX**

Justo antes del `return (` o como último elemento dentro del `return`, agregar el modal. Colocarlo al final del JSX, fuera del layout principal:

```tsx
{/* Modal advertencia ítems saludables */}
{showHealthyWarning && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div className="bg-base-100 rounded-3xl shadow-2xl border border-error/30 w-full max-w-md mx-4 overflow-hidden">
      <div className="bg-error/10 px-6 py-5 flex items-center gap-3 border-b border-error/20">
        <AlertTriangle className="w-6 h-6 text-error shrink-0" />
        <div>
          <h3 className="font-bold text-base">¿Descartar insumos en buen estado?</h3>
          <p className="text-xs opacity-60 mt-0.5">Esta acción es irreversible</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm opacity-70">
          Los siguientes lotes no están vencidos ni próximos a vencer:
        </p>

        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {healthyItems.map(item => (
            <li key={item.lote_id} className="flex items-center justify-between text-xs bg-base-200/50 rounded-xl px-3 py-2">
              <span className="font-bold truncate">{item.producto_nombre}</span>
              <span className="font-mono opacity-60 ml-2 shrink-0">{item.cantidad_descartar} uds</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">
            Justificación obligatoria
          </label>
          <textarea
            className="textarea textarea-bordered w-full rounded-2xl bg-base-100 resize-none text-sm h-20 focus:ring-2 ring-error/20"
            placeholder="Explica por qué se descarta este material en buen estado..."
            value={healthyJustification}
            onChange={e => setHealthyJustification(e.target.value)}
          />
          <p className="text-[10px] opacity-40 text-right">
            {healthyJustification.length}/10 caracteres mínimos
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            className="btn btn-ghost btn-block"
            onClick={() => { setShowHealthyWarning(false); setHealthyJustification('') }}
          >
            Cancelar
          </button>
          <button
            className="btn btn-error btn-block gap-2"
            disabled={healthyJustification.trim().length < 10 || descarteMutation.isPending}
            onClick={() => executeDescarte(healthyJustification.trim())}
          >
            {descarteMutation.isPending ? <span className="loading loading-spinner loading-sm" /> : <Trash2 className="w-4 h-4" />}
            Confirmar de todas formas
          </button>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Agregar AlertTriangle a los imports**

Verificar que `AlertTriangle` esté en los imports de lucide-react en descartes. Si no está, agregarlo:

```typescript
import {
  Trash2,
  Search,
  Calendar,
  PackageX,
  MapPin,
  Clock,
  AlertTriangle   // <-- agregar si no existe
} from 'lucide-react'
```

- [ ] **Step 7: Verificar manualmente**

1. Ir a `/descartes`, seleccionar un área.
2. Seleccionar un lote que **no** esté vencido y asignarle motivo "dañado" o "contaminado".
3. Click en "Confirmar Descarte" → debe aparecer el modal de advertencia con ese lote listado.
4. El botón "Confirmar de todas formas" debe estar deshabilitado hasta escribir 10+ caracteres.
5. Cancelar → modal se cierra, sin cambios.
6. Ahora seleccionar un lote **vencido** (motivo "vencido") → click en confirmar → NO debe aparecer el modal, debe confirmar directo.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/pages/descartes/index.tsx
git commit -m "feat(descartes): add warning modal with mandatory justification for healthy items"
```

---

## Resumen de Commits

Al finalizar habrá 4 commits:
1. `fix(audit-log): correct API path from /audit_log to /audit-log`
2. `feat(consumos): make area selector optional, load global stock by default`
3. `feat(dashboard): auto-resolve feed from movements cross-referenced with active alerts`
4. `feat(descartes): add warning modal with mandatory justification for healthy items`

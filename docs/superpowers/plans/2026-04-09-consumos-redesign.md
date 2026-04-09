# Consumos Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/consumos` con layout de una columna, escaneo como acción principal y bottom drawer como carrito.

**Architecture:** Extraemos la UI en tres componentes nuevos (`ProductoCard`, `LoteSelector`, `ConsumoDrawer`) dentro de `pages/consumos/components/`. El `index.tsx` se reescribe como orquestador delgado que maneja estado y queries; los componentes solo reciben props. La lógica de backend (mutations, queries, tipos) no cambia.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, DaisyUI, shadcn/ui, TanStack Query, Zustand (useAuthStore para userId), html5-qrcode (QrScanner existente)

---

## Mapa de Archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `frontend/src/pages/consumos/index.tsx` | Modificar (reescribir) | Orquestador: estado, queries, mutations, HID detection, localStorage |
| `frontend/src/pages/consumos/components/lote-selector.tsx` | Crear | Dropdown "FEFO automático" / override de lote |
| `frontend/src/pages/consumos/components/producto-card.tsx` | Crear | Card de producto en grilla (normal / agregado / sin-stock) |
| `frontend/src/pages/consumos/components/consumo-drawer.tsx` | Crear | Bottom drawer colapsado/expandido con lista de items a confirmar |

---

## Task 1: Tipos locales compartidos + LoteSelector

**Files:**
- Create: `frontend/src/pages/consumos/components/lote-selector.tsx`

- [ ] **Step 1.1: Crear directorio de componentes**

```bash
mkdir -p "frontend/src/pages/consumos/components"
```

- [ ] **Step 1.2: Crear `lote-selector.tsx`**

```tsx
// frontend/src/pages/consumos/components/lote-selector.tsx
import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'

export interface LoteDisponible {
  lote_id: string
  numero_lote: string
  stock: number
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
}

interface LoteSelectorProps {
  lotes: LoteDisponible[]
  loteElegidoId: string | null  // null = FEFO automático
  unidad: string
  unidad_plural: string
  onChange: (loteId: string | null) => void
}

export function LoteSelector({ lotes, loteElegidoId, unidad, unidad_plural, onChange }: LoteSelectorProps) {
  const [open, setOpen] = useState(false)

  // No mostrar selector si hay 0 o 1 lote (sin elección real)
  if (lotes.length <= 1) return null

  const loteActual = lotes.find(l => l.lote_id === loteElegidoId)
  const label = loteActual ? loteActual.numero_lote : 'FEFO automático'

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-base-content/50 hover:text-base-content/80 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {!loteActual && <Sparkles className="h-3 w-3 text-success" />}
        <span className="font-medium">{label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-20 bg-base-100 border border-base-200 rounded-xl shadow-lg min-w-[200px] overflow-hidden">
          {/* Opción FEFO */}
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-base-200 transition-colors text-left',
              loteElegidoId === null && 'bg-success/10 text-success font-semibold'
            )}
            onClick={() => { onChange(null); setOpen(false) }}
          >
            <Sparkles className="h-3 w-3 flex-shrink-0" />
            <div>
              <div>FEFO automático</div>
              <div className="text-base-content/40 font-normal">El sistema elige el lote</div>
            </div>
          </button>
          <div className="border-t border-base-200" />
          {lotes.map(l => {
            const stockLabel = formatCantidad(l.stock, unidad, unidad_plural)
            return (
              <button
                key={l.lote_id}
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-base-200 transition-colors text-left',
                  loteElegidoId === l.lote_id && 'bg-primary/10 text-primary font-semibold'
                )}
                onClick={() => { onChange(l.lote_id); setOpen(false) }}
              >
                <div className="flex-1">
                  <div className="font-mono">{l.numero_lote}</div>
                  <div className="text-base-content/40 font-normal">{stockLabel} · vence {l.fecha_vencimiento.slice(0, 10)}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 1.3: Commit**

```bash
git add frontend/src/pages/consumos/components/lote-selector.tsx
git commit -m "feat(consumos): componente LoteSelector FEFO/override"
```

---

## Task 2: CartItem types + ProductoCard

**Files:**
- Create: `frontend/src/pages/consumos/components/producto-card.tsx`

- [ ] **Step 2.1: Crear `producto-card.tsx`**

```tsx
// frontend/src/pages/consumos/components/producto-card.tsx
import { useState, useEffect } from 'react'
import { Plus, Check } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { ProductoImage } from '@/components/ui/producto-image'
import type { StockItem } from '@/types'
import type { LoteDisponible } from './lote-selector'

// CartItem definition compartida — importada por index.tsx y consumo-drawer.tsx
export interface CartItem {
  producto_id: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_total: number
  area_id: number
  area_nombre: string
  imagen_url?: string | null
  codigo_interno: string
  categoria: string | null
  lotes: LoteDisponible[]
  lote_elegido_id: string | null
  cantidad_descontar: number
}

interface ProductoCardProps {
  producto: StockItem
  isEnCarrito: boolean
  areaFiltro: number | null
  onAdd: () => void
}

export function ProductoCard({ producto, isEnCarrito, onAdd }: ProductoCardProps) {
  const [flash, setFlash] = useState(false)
  const sinStock = (producto.stock_total ?? 0) <= 0

  // Flash verde breve al agregar
  useEffect(() => {
    if (isEnCarrito) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      return () => clearTimeout(t)
    }
  }, [isEnCarrito])

  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 p-3 rounded-2xl border transition-all duration-200',
        sinStock && 'opacity-40',
        flash && 'bg-success/10 border-success/40',
        !flash && isEnCarrito && 'bg-primary/5 border-primary/30',
        !flash && !isEnCarrito && 'bg-base-100 border-base-200 hover:border-base-300',
      )}
    >
      {/* Imagen + badges */}
      <div className="flex items-start gap-2">
        <ProductoImage src={producto.imagen_url} size="sm" className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight line-clamp-2">{producto.producto_nombre}</p>
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            {producto.area_nombre && (
              <span className="badge badge-xs bg-blue-100 text-blue-700 border-none">{producto.area_nombre}</span>
            )}
            {producto.categoria && (
              <span className="badge badge-xs bg-green-100 text-green-700 border-none">{producto.categoria}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stock */}
      <div className="flex items-center justify-between">
        {sinStock ? (
          <span className="badge badge-xs badge-error badge-outline">Sin stock</span>
        ) : (
          <span className="text-xs text-base-content/50 font-medium">
            {formatCantidad(producto.stock_total ?? 0, producto.unidad, producto.unidad_plural ?? undefined)}
          </span>
        )}

        {!sinStock && (
          <button
            className={cn(
              'btn btn-xs btn-circle transition-all',
              isEnCarrito ? 'btn-primary' : 'btn-outline hover:btn-primary'
            )}
            onClick={onAdd}
            aria-label={isEnCarrito ? 'Ya agregado' : 'Agregar'}
          >
            {isEnCarrito ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2.2: Commit**

```bash
git add frontend/src/pages/consumos/components/producto-card.tsx
git commit -m "feat(consumos): componente ProductoCard con estados y flash"
```

---

## Task 3: ConsumoDrawer

**Files:**
- Create: `frontend/src/pages/consumos/components/consumo-drawer.tsx`

- [ ] **Step 3.1: Crear `consumo-drawer.tsx`**

```tsx
// frontend/src/pages/consumos/components/consumo-drawer.tsx
import { useRef, useEffect } from 'react'
import { Zap, ChevronDown, Trash2, Minus, Plus, X } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { LoteSelector } from './lote-selector'
import type { CartItem } from './producto-card'

interface ConsumoDrawerProps {
  cart: Record<string, CartItem>
  isExpanded: boolean
  onToggle: () => void
  onUpdateCantidad: (productoId: string, cantidad: number) => void
  onUpdateLote: (productoId: string, loteId: string | null) => void
  onRemove: (productoId: string) => void
  onClear: () => void
  onConfirm: () => void
  isPending: boolean
  notas: string
  onNotasChange: (v: string) => void
}

export function ConsumoDrawer({
  cart, isExpanded, onToggle,
  onUpdateCantidad, onUpdateLote, onRemove, onClear,
  onConfirm, isPending, notas, onNotasChange,
}: ConsumoDrawerProps) {
  const items = Object.values(cart)
  const count = items.length
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll al top del drawer cuando se expande
  useEffect(() => {
    if (isExpanded) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [isExpanded])

  if (count === 0) return null

  return (
    <>
      {/* Backdrop al expandir */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px]"
          onClick={onToggle}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 bg-base-100 border-t border-base-200 shadow-2xl transition-all duration-300 ease-out',
          isExpanded ? 'rounded-t-3xl' : 'rounded-t-2xl',
        )}
      >
        {/* Handle / barra colapsada */}
        <button
          className="w-full flex items-center justify-between px-4 py-3 gap-3"
          onClick={onToggle}
          aria-label={isExpanded ? 'Colapsar' : 'Ver consumo a registrar'}
        >
          <div className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-base-content/40 transition-transform duration-300', !isExpanded && 'rotate-180')} />
            <span className="font-bold text-sm">
              {isExpanded ? 'Consumo a registrar' : `${count} ${count === 1 ? 'item' : 'items'} agregado${count === 1 ? '' : 's'}`}
            </span>
          </div>
          {!isExpanded && (
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-xl gap-1"
              onClick={e => { e.stopPropagation(); onConfirm() }}
              disabled={isPending}
            >
              {isPending
                ? <span className="loading loading-spinner loading-xs" />
                : <><Zap className="h-3.5 w-3.5" /> Confirmar consumo</>
              }
            </button>
          )}
        </button>

        {/* Contenido expandido */}
        {isExpanded && (
          <div className="flex flex-col max-h-[70vh]">
            {/* Header con "vaciar" */}
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-xs text-base-content/40">{count} {count === 1 ? 'item' : 'items'}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error gap-1"
                onClick={onClear}
              >
                <X className="h-3 w-3" /> Vaciar
              </button>
            </div>

            {/* Lista de items */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-3 pb-2">
              {items.map(item => (
                <div key={item.producto_id} className="bg-base-200/40 rounded-2xl p-3 space-y-2">
                  {/* Nombre + eliminar */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight line-clamp-2">{item.nombre}</p>
                      {item.area_nombre && (
                        <span className="text-[11px] text-base-content/40">{item.area_nombre}</span>
                      )}
                    </div>
                    <button
                      className="btn btn-ghost btn-xs btn-circle text-error flex-shrink-0"
                      onClick={() => onRemove(item.producto_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Selector de lote */}
                  <LoteSelector
                    lotes={item.lotes}
                    loteElegidoId={item.lote_elegido_id}
                    unidad={item.unidad}
                    unidad_plural={item.unidad_plural}
                    onChange={loteId => onUpdateLote(item.producto_id, loteId)}
                  />

                  {/* Cantidad */}
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-ghost btn-xs btn-circle"
                      onClick={() => onUpdateCantidad(item.producto_id, Math.max(1, item.cantidad_descontar - 1))}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      type="number"
                      className="input input-bordered input-xs w-14 text-center font-bold"
                      value={item.cantidad_descontar}
                      min={1}
                      onChange={e => onUpdateCantidad(item.producto_id, Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <button
                      className="btn btn-ghost btn-xs btn-circle"
                      onClick={() => onUpdateCantidad(item.producto_id, item.cantidad_descontar + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <span className="text-xs text-base-content/50">
                      {formatCantidad(item.cantidad_descontar, item.unidad, item.unidad_plural)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Nota + botón confirmar */}
            <div className="px-4 pt-2 pb-4 border-t border-base-200 space-y-2 bg-base-100">
              <input
                className="input input-bordered input-sm w-full rounded-xl text-sm"
                placeholder="Nota (opcional)..."
                value={notas}
                onChange={e => onNotasChange(e.target.value)}
              />
              <button
                className="btn btn-primary w-full rounded-xl gap-2"
                disabled={isPending}
                onClick={onConfirm}
              >
                {isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : <><Zap className="h-4 w-4" /> Confirmar consumo</>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3.2: Commit**

```bash
git add frontend/src/pages/consumos/components/consumo-drawer.tsx
git commit -m "feat(consumos): componente ConsumoDrawer bottom sheet"
```

---

## Task 4: Reescribir index.tsx

**Files:**
- Modify: `frontend/src/pages/consumos/index.tsx`

- [ ] **Step 4.1: Reemplazar `index.tsx` completo**

```tsx
// frontend/src/pages/consumos/index.tsx
import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { Search, Camera, Package } from 'lucide-react'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { toast } from 'sonner'
import { useAuthStore } from '@/hooks/use-auth-store'
import { QrScanner } from '@/components/shared/qr-scanner'
import { ProductoCard } from './components/producto-card'
import { ConsumoDrawer } from './components/consumo-drawer'
import type { CartItem } from './components/producto-card'
import type { LoteDisponible } from './components/lote-selector'

// ─── Helpers localStorage para productos recientes ───────────────────────────

function getRecentIds(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`consumos_recientes_${userId}`) ?? '[]')
  } catch { return [] }
}

function pushRecentIds(userId: string, ids: string[]) {
  const prev = getRecentIds(userId).filter(id => !ids.includes(id))
  const next = [...ids, ...prev].slice(0, 8)
  localStorage.setItem(`consumos_recientes_${userId}`, JSON.stringify(next))
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ConsumosPage() {
  const usuario = useAuthStore(s => s.usuario)
  const userId = usuario?.id ?? 'anon'

  const [searchQuery, setSearchQuery] = useState('')
  const [areaFiltro, setAreaFiltro] = useState<number | null>(null)
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [notas, setNotas] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const hidStartTime = useRef<number>(0)
  const queryClient = useQueryClient()

  // Enfocar input al montar (listo para HID)
  useEffect(() => { inputRef.current?.focus() }, [])

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: areasData } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<{ id: number; nombre: string; activa: boolean }[]>('/areas').then(r => r.data),
    staleTime: 300_000,
  })
  const areas = areasData?.filter(a => a.activa) ?? []

  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock-list', searchQuery, areaFiltro],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
      params: {
        ...(searchQuery.length >= 2 && { q: searchQuery }),
        ...(areaFiltro && { area_id: areaFiltro }),
        per_page: 100,
      }
    }).then(r => r.data),
  })

  // Productos a mostrar: si hay búsqueda → resultados; si no → recientes (si hay) o vacío
  const recentIds = getRecentIds(userId)
  const allProducts = stockResponse?.data ?? []
  const productsToShow: StockItem[] = (() => {
    if (searchQuery.length >= 2) return allProducts
    if (recentIds.length === 0) return []
    // Ordenar: recientes primero, luego el resto
    const recentSet = new Set(recentIds)
    const recents = recentIds
      .map(id => allProducts.find(p => p.producto_id === id))
      .filter((p): p is StockItem => !!p)
    const others = allProducts.filter(p => !recentSet.has(p.producto_id))
    return [...recents, ...others].slice(0, 50)
  })()

  // ── Agregar al carrito ─────────────────────────────────────────────────────

  const addToCart = useCallback((p: StockItem) => {
    if ((p.stock_total ?? 0) <= 0) { toast.error('Sin stock disponible'); return }
    const key = p.producto_id
    setCart(prev => {
      if (prev[key]) return { ...prev, [key]: { ...prev[key], cantidad_descontar: prev[key].cantidad_descontar + 1 } }
      return {
        ...prev,
        [key]: {
          producto_id: p.producto_id,
          nombre: p.producto_nombre,
          codigo_interno: p.codigo_interno,
          unidad: p.unidad,
          unidad_plural: p.unidad_plural ?? p.unidad,
          stock_total: p.stock_total ?? 0,
          area_id: p.area_id ?? areaFiltro ?? 0,
          area_nombre: p.area_nombre ?? '',
          imagen_url: p.imagen_url,
          categoria: (p as any).categoria ?? null,
          lotes: [],
          lote_elegido_id: null,
          cantidad_descontar: 1,
        }
      }
    })
    // Fetch lotes en background
    api.get<{ id: string; numero_lote: string; stock_total: string | null; fecha_vencimiento: string }[]>('/lotes', {
      params: { producto_id: p.producto_id, con_stock: true, vencido: false, ...(areaFiltro && { area_id: areaFiltro }) }
    }).then(res => {
      const lotes: LoteDisponible[] = res.data.map(l => ({
        lote_id: l.id,
        numero_lote: l.numero_lote,
        stock: parseFloat(l.stock_total ?? '0'),
        fecha_vencimiento: l.fecha_vencimiento,
        area_id: areaFiltro ?? p.area_id ?? 0,
        area_nombre: p.area_nombre ?? '',
      }))
      setCart(prev => prev[key] ? { ...prev, [key]: { ...prev[key], lotes } } : prev)
    }).catch(() => {})
  }, [areaFiltro])

  // ── Detección HID ──────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value.length === 1) hidStartTime.current = Date.now()
    setSearchQuery(value)
  }

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const elapsed = Date.now() - hidStartTime.current
    const isHid = searchQuery.length >= 4 && elapsed < 200
    if (!isHid) return
    e.preventDefault()
    await handleScanCode(searchQuery)
    setSearchQuery('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── Escaneo (QR + HID comparten esta función) ──────────────────────────────

  const handleScanCode = async (code: string) => {
    try {
      const res = await api.get<PaginatedResponse<StockItem>>('/stock', {
        params: { q: code, ...(areaFiltro && { area_id: areaFiltro }) }
      })
      const items = res.data.data
      if (items.length === 0) { toast.error('Producto no encontrado'); return }
      addToCart(items[0])
      setIsScannerOpen(false)
    } catch { toast.error('Error al escanear') }
  }

  // ── Mutation batch ─────────────────────────────────────────────────────────

  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      pushRecentIds(userId, Object.keys(cart))
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-list'] })
      setCart({})
      setNotas('')
      setIsDrawerExpanded(false)
      toast.success('Consumo registrado')
    },
    onError: (err: any) => toast.error(parseApiError(err)),
  })

  const handleConfirm = () => {
    const items = Object.values(cart)
    if (items.length === 0) return
    batchMutation.mutate({
      items: items.map(i => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad_descontar,
        unidad: 'base' as const,
        area_id: i.area_id || undefined,
        ...(i.lote_elegido_id && { lote_id: i.lote_elegido_id }),
      })),
      nota: notas || undefined,
    })
  }

  // ── Helpers carrito ────────────────────────────────────────────────────────

  const updateCantidad = (id: string, cantidad: number) =>
    setCart(prev => ({ ...prev, [id]: { ...prev[id], cantidad_descontar: cantidad } }))

  const updateLote = (id: string, loteId: string | null) =>
    setCart(prev => ({ ...prev, [id]: { ...prev[id], lote_elegido_id: loteId } }))

  const removeItem = (id: string) =>
    setCart(prev => { const n = { ...prev }; delete n[id]; return n })

  const clearCart = () => { setCart({}); setIsDrawerExpanded(false) }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasNoSearch = searchQuery.length < 2
  const emptyRecents = hasNoSearch && recentIds.length === 0
  const drawerCount = Object.keys(cart).length

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">

      {/* ── Header: título + área ── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <h1 className="font-bold text-base">Registrar consumo</h1>
        <select
          className="select select-bordered select-sm rounded-xl text-sm max-w-[160px]"
          value={areaFiltro ?? ''}
          onChange={e => setAreaFiltro(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Todas las áreas</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      {/* ── Barra de búsqueda + QR ── */}
      <div className="px-4 pb-3 flex-shrink-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 pointer-events-none" />
            <input
              ref={inputRef}
              className="input input-bordered w-full pl-9 h-11 rounded-xl text-sm"
              placeholder="Buscar o escanear código..."
              value={searchQuery}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              autoComplete="off"
            />
          </div>
          <button
            className="btn btn-outline h-11 w-11 rounded-xl p-0 flex-shrink-0"
            onClick={() => setIsScannerOpen(true)}
            aria-label="Abrir escáner QR"
          >
            <Camera className="h-5 w-5" />
          </button>
        </div>
        {searchQuery.length === 1 && (
          <p className="text-xs text-base-content/40 mt-1 px-1">Escribe al menos 2 letras para buscar</p>
        )}
      </div>

      {/* ── Lista de productos ── */}
      <div
        className="flex-1 overflow-y-auto px-4"
        style={{ paddingBottom: drawerCount > 0 ? '80px' : '16px' }}
      >
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array(6).fill(0).map((_, i) => (
              <div key={i} className="h-28 bg-base-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : emptyRecents ? (
          <div className="py-20 text-center opacity-30">
            <Package className="h-10 w-10 mx-auto mb-2" />
            <p className="text-sm font-medium">Escanea o busca un producto</p>
            <p className="text-xs mt-1">Los productos que uses aparecerán aquí</p>
          </div>
        ) : productsToShow.length === 0 ? (
          <div className="py-20 text-center opacity-30">
            <Package className="h-10 w-10 mx-auto mb-2" />
            <p className="text-sm">Sin resultados para "{searchQuery}"</p>
          </div>
        ) : (
          <>
            {hasNoSearch && recentIds.length > 0 && (
              <p className="text-xs text-base-content/40 mb-2 px-1">Usados recientemente</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {productsToShow.map(p => (
                <ProductoCard
                  key={p.producto_id}
                  producto={p}
                  isEnCarrito={!!cart[p.producto_id]}
                  areaFiltro={areaFiltro}
                  onAdd={() => addToCart(p)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Drawer ── */}
      <ConsumoDrawer
        cart={cart}
        isExpanded={isDrawerExpanded}
        onToggle={() => setIsDrawerExpanded(e => !e)}
        onUpdateCantidad={updateCantidad}
        onUpdateLote={updateLote}
        onRemove={removeItem}
        onClear={clearCart}
        onConfirm={handleConfirm}
        isPending={batchMutation.isPending}
        notas={notas}
        onNotasChange={setNotas}
      />

      {/* ── Scanner QR overlay ── */}
      {isScannerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setIsScannerOpen(false)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-3 -right-3 z-10 btn btn-circle btn-sm btn-error"
              onClick={() => setIsScannerOpen(false)}
            >
              ✕
            </button>
            <QrScanner onScan={handleScanCode} active={isScannerOpen} />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4.2: Verificar que el frontend compila sin errores TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Resultado esperado: sin output (exit code 0).

- [ ] **Step 4.3: Commit**

```bash
git add frontend/src/pages/consumos/index.tsx
git commit -m "feat(consumos): rediseño completo scan-first + bottom drawer"
```

---

## Task 5: Prueba visual y ajustes finales

- [ ] **Step 5.1: Abrir `http://localhost:5173/consumos` y verificar:**
  - [ ] El input queda enfocado al cargar la página
  - [ ] Al escribir 2+ letras aparece la grilla de productos en 2 columnas
  - [ ] Sin búsqueda: si no hay recientes, aparece empty state
  - [ ] Agregar un producto con `[+]` → botón cambia a `[✓]`, flash verde breve
  - [ ] El drawer aparece en la parte inferior con "X items agregados · Confirmar consumo"
  - [ ] Tocar el drawer lo expande, mostrando los items con cantidad y selector de lote
  - [ ] "Confirmar consumo" registra el batch y cierra el drawer
  - [ ] Botón `[📷]` abre el scanner QR en overlay full-screen
  - [ ] Selector de área en header filtra los resultados
  - [ ] Después de confirmar, los productos usados aparecen primero al volver a la página

- [ ] **Step 5.2: Commit de ajustes si los hubo**

```bash
git add -p  # staging selectivo de ajustes
git commit -m "fix(consumos): ajustes visuales post-review"
```

---

## Notas para el implementador

- `paddingBottom` dinámico en la lista evita que el drawer tape los últimos cards
- El HID detection usa tiempo desde el primer char hasta `Enter`: < 200ms → scan automático
- `pushRecentIds` se llama en `onSuccess` del mutation, después de confirmar, con los product_ids del cart que se confirmó
- `LoteSelector` se oculta si `lotes.length <= 1` (no hay elección real que ofrecer)
- Si el lote fetch falla (catch vacío), el FEFO automático sigue funcionando sin problemas

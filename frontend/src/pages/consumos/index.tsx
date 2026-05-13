// frontend/src/pages/consumos/index.tsx
import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { Search, Camera, Package, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { toast } from 'sonner'
import { useAuthStore } from '@/hooks/use-auth-store'
import { QrScanner } from '@/components/shared/qr-scanner'
import { PageLoading } from '@/components/ui/page-state'
import { ProductoCard } from './components/producto-card'
import { ConsumoDrawer } from './components/consumo-drawer'
import type { CartItem } from './components/producto-card'
import type { LoteDisponible } from './components/lote-selector'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { KeyboardLegend } from '@/components/ui/keyboard-legend'
import { cn, formatCantidad } from '@/lib/utils'
import { ProductoImage } from '@/components/ui/producto-image'

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
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const hidStartTime = useRef<number>(0)
  const queryClient = useQueryClient()

  // Enfocar input al montar (listo para HID)
  useEffect(() => { inputRef.current?.focus() }, [])

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Scroll automático al ítem activo
  useEffect(() => {
    if (activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // Resetear índice al cambiar la búsqueda
  useEffect(() => { setActiveIndex(-1) }, [searchQuery])

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

  const [recentIds, setRecentIds] = useState(() => getRecentIds(userId))
  const allProducts = stockResponse?.data ?? []

  // Items mostrados en el dropdown
  const dropdownItems: StockItem[] = (() => {
    if (searchQuery.length >= 2) return allProducts
    if (recentIds.length === 0) return []
    return recentIds
      .map(id => allProducts.find(p => p.producto_id === id))
      .filter((p): p is StockItem => !!p)
  })()

  // Items mostrados en la lista principal (solo recientes, sin búsqueda activa)
  const recentProducts: StockItem[] = (() => {
    if (recentIds.length === 0) return []
    return recentIds
      .map(id => allProducts.find(p => p.producto_id === id))
      .filter((p): p is StockItem => !!p)
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
          categoria: p.categoria ?? null,
          lotes: [],
          cargando_lotes: true,
          lote_elegido_id: null,
          cantidad_descontar: 1,
        }
      }
    })
    api.get<{ id: string; numero_lote: string; stock_total: string | null; fecha_vencimiento: string }[]>('/lotes', {
      params: { producto_id: p.producto_id, con_stock: true, vencido: false }
    }).then(res => {
      const lotes: LoteDisponible[] = res.data.map(l => ({
        lote_id: l.id,
        numero_lote: l.numero_lote,
        stock: parseFloat(l.stock_total ?? '0'),
        fecha_vencimiento: l.fecha_vencimiento,
        area_id: areaFiltro ?? p.area_id ?? 0,
        area_nombre: p.area_nombre ?? '',
      }))
      setCart(prev => prev[key] ? { ...prev, [key]: { ...prev[key], lotes, cargando_lotes: false } } : prev)
    }).catch(() => {
      setCart(prev => prev[key] ? { ...prev, [key]: { ...prev[key], cargando_lotes: false } } : prev)
    })
  }, [areaFiltro])

  const addFromDropdown = useCallback((item: StockItem) => {
    addToCart(item)
    setDropdownOpen(false)
    setSearchQuery('')
    setActiveIndex(-1)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [addToCart])

  // ── Detección HID ──────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (value.length === 1) hidStartTime.current = Date.now()
    setSearchQuery(value)
    if (value.length >= 2) setDropdownOpen(true)
  }

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!dropdownOpen) setDropdownOpen(true)
      if (dropdownItems.length === 0) return
      setActiveIndex(i => i < dropdownItems.length - 1 ? i + 1 : 0)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (dropdownItems.length === 0) return
      setActiveIndex(i => i > 0 ? i - 1 : dropdownItems.length - 1)
      return
    }

    if (e.key === 'Escape') {
      setDropdownOpen(false)
      setActiveIndex(-1)
      setSearchQuery('')
      inputRef.current?.blur()
      return
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && dropdownItems[activeIndex]) {
        e.preventDefault()
        addFromDropdown(dropdownItems[activeIndex])
        return
      }
      // HID scan (escritura muy rápida)
      const elapsed = Date.now() - hidStartTime.current
      const isHid = searchQuery.length >= 4 && elapsed < 200
      if (isHid) {
        e.preventDefault()
        await handleScanCode(searchQuery)
        setSearchQuery('')
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
  }

  // ── Escaneo (QR + HID comparten esta función) ──────────────────────────────

  const handleScanCode = useCallback(async (code: string) => {
    try {
      const res = await api.get<PaginatedResponse<StockItem>>('/stock', {
        params: { q: code, ...(areaFiltro && { area_id: areaFiltro }) }
      })
      const items = res.data.data
      if (items.length === 0) { toast.error('Producto no encontrado'); return }
      addToCart(items[0])
      setIsScannerOpen(false)
    } catch { toast.error('Error al escanear') }
  }, [areaFiltro, addToCart])

  // ── Mutation batch ─────────────────────────────────────────────────────────

  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      pushRecentIds(userId, Object.keys(cart))
      setRecentIds(getRecentIds(userId))
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-list'] })
      setCart({})
      setNotas('')
      setIsDrawerExpanded(false)
      toast.success('Consumo registrado')
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
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

  // ── Atajos de teclado ─────────────────────────────────────────────────────

  useKeyboardShortcut({ key: '/', onKeyDown: (e) => { e.preventDefault(); inputRef.current?.focus() } })
  useKeyboardShortcut({ key: 'Escape', ignoreInputs: false, onKeyDown: () => { setSearchQuery(''); inputRef.current?.blur() } })

  // ── Helpers carrito ────────────────────────────────────────────────────────

  const updateCantidad = (id: string, cantidad: number) =>
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], cantidad_descontar: cantidad } } : prev)

  const updateLote = (id: string, loteId: string | null) =>
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], lote_elegido_id: loteId } } : prev)

  const removeItem = (id: string) =>
    setCart(prev => { const n = { ...prev }; delete n[id]; return n })

  const clearCart = () => { setCart({}); setIsDrawerExpanded(false) }

  // ── Render ─────────────────────────────────────────────────────────────────

  const emptyRecents = recentIds.length === 0
  const drawerCount = Object.keys(cart).length
  const showDropdown = dropdownOpen && dropdownItems.length > 0

  return (
    <div
      className="flex flex-col h-[calc(100vh-64px)] overflow-hidden transition-[margin] duration-300"
      style={{ marginRight: drawerCount > 0 ? '320px' : 0 }}
    >

      {/* ── Header: título + área ── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-base">Registrar consumo</h1>
          <KeyboardLegend shortcuts={[
            { keys: ['/'], description: 'Enfocar búsqueda' },
            { keys: ['↓'], description: 'Desplegar sugerencias' },
            { keys: ['↑↓'], description: 'Navegar lista' },
            { keys: ['Enter'], description: 'Agregar producto' },
            { keys: ['Esc'], description: 'Cerrar / limpiar' },
          ]} />
        </div>
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
          {/* Contenedor del autocomplete */}
          <div ref={containerRef} className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 pointer-events-none z-10" />
            <input
              ref={inputRef}
              className="input input-bordered w-full pl-9 h-11 rounded-xl text-sm"
              placeholder="Buscar o escanear código…"
              value={searchQuery}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onFocus={() => { if (dropdownItems.length > 0) setDropdownOpen(true) }}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              aria-activedescendant={activeIndex >= 0 ? `sugerencia-${activeIndex}` : undefined}
            />

            {/* Dropdown de sugerencias */}
            {showDropdown && (
              <div
                className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-y-auto max-h-72"
                role="listbox"
              >
                {searchQuery.length < 2 && recentIds.length > 0 && (
                  <p className="text-[11px] text-base-content/40 px-3 pt-2 pb-1 font-medium">Usados recientemente</p>
                )}
                {isLoading && searchQuery.length >= 2 ? (
                  <div className="py-4 text-center text-sm text-base-content/40">Buscando…</div>
                ) : dropdownItems.map((item, i) => {
                  const sinStock = (item.stock_total ?? 0) <= 0
                  const enCarrito = !!cart[item.producto_id]
                  return (
                    <div
                      key={item.producto_id}
                      id={`sugerencia-${i}`}
                      ref={el => { itemRefs.current[i] = el }}
                      role="option"
                      aria-selected={i === activeIndex}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                        i === activeIndex && 'bg-base-200',
                        i !== activeIndex && !sinStock && 'hover:bg-base-200/60',
                        sinStock && 'opacity-40 cursor-not-allowed',
                      )}
                      onClick={() => !sinStock && addFromDropdown(item)}
                      onMouseEnter={() => setActiveIndex(i)}
                    >
                      <ProductoImage
                        src={item.imagen_url}
                        size="sm"
                        className="w-8 h-8 rounded-lg flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight line-clamp-1">{item.producto_nombre}</p>
                        {item.area_nombre && (
                          <p className="text-[11px] text-base-content/40 leading-tight">{item.area_nombre}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {enCarrito && (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        )}
                        {sinStock ? (
                          <span className="text-[10px] text-error font-semibold">Sin stock</span>
                        ) : (
                          <span className="text-[11px] text-base-content/50 font-medium tabular-nums">
                            {formatCantidad(item.stock_total ?? 0, item.unidad, item.unidad_plural ?? undefined)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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

      {/* ── Lista de recientes ── */}
      <div
        className="flex-1 overflow-y-auto px-4"
        style={{ paddingBottom: drawerCount > 0 ? '80px' : '16px' }}
      >
        {isLoading && recentIds.length === 0 ? (
          <PageLoading label="Cargando productos…" />
        ) : emptyRecents ? (
          <div className="py-20 text-center opacity-30">
            <Package className="h-10 w-10 mx-auto mb-2" />
            <p className="text-sm font-medium">Presiona ↓ o escribe para buscar</p>
            <p className="text-xs mt-1">Los productos que uses aparecerán aquí</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-base-content/40 mb-2 px-1">Usados recientemente</p>
            <div className="flex flex-col gap-2">
              {recentProducts.map(p => (
                <ProductoCard
                  key={p.producto_id}
                  producto={p}
                  isEnCarrito={!!cart[p.producto_id]}
                  cantidadEnCarrito={cart[p.producto_id]?.cantidad_descontar ?? 0}
                  onAdd={() => addToCart(p)}
                  onIncrement={() => updateCantidad(p.producto_id, (cart[p.producto_id]?.cantidad_descontar ?? 0) + 1)}
                  onDecrement={() => {
                    const cur = cart[p.producto_id]?.cantidad_descontar ?? 0
                    if (cur <= 1) removeItem(p.producto_id)
                    else updateCantidad(p.producto_id, cur - 1)
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Drawer ── */}
      <ConsumoDrawer
        cart={cart}
        areaFiltro={areaFiltro}
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
          <div className="relative w-[min(90vw,384px)]" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-3 -right-3 z-10 btn btn-circle btn-sm btn-error"
              onClick={() => setIsScannerOpen(false)}
              aria-label="Cerrar escáner"
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

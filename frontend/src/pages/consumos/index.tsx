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
  const [recentIds, setRecentIds] = useState(() => getRecentIds(userId))
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
          cargando_lotes: true,
          lote_elegido_id: null,
          cantidad_descontar: 1,
        }
      }
    })
    // Fetch lotes con indicador de carga
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
      setCart(prev => prev[key] ? { ...prev, [key]: { ...prev[key], lotes, cargando_lotes: false } } : prev)
    }).catch(() => {
      setCart(prev => prev[key] ? { ...prev, [key]: { ...prev[key], cargando_lotes: false } } : prev)
    })
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
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], cantidad_descontar: cantidad } } : prev)

  const updateLote = (id: string, loteId: string | null) =>
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], lote_elegido_id: loteId } } : prev)

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

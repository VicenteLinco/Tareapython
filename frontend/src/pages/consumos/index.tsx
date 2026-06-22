// frontend/src/pages/consumos/index.tsx
import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { Search, Camera, Package, CheckCircle2, ShoppingCart, Zap, Trash2, Minus, Plus, X, AlertTriangle, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { notify } from '@/lib/notify'
import { useAuthStore } from '@/hooks/use-auth-store'
import { QrScanner } from '@/components/shared/qr-scanner'
import { PageLoading } from '@/components/ui/page-state'
import { ProductoCard } from './components/producto-card'
import { ConsumoDrawer } from './components/consumo-drawer'
import type { CartItem } from './components/producto-card'
import type { LoteDisponible } from './components/lote-selector'
import { LoteSelector } from './components/lote-selector'
import { parseGS1 } from '@/lib/gs1'
import { classifyConsumoScan, findLoteByNumero } from './consumo-scan'
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut'
import { KeyboardLegend } from '@/components/ui/keyboard-legend'
import { cn, formatCantidad } from '@/lib/utils'
import { ProductoImage } from '@/components/ui/producto-image'

// UUID v4 (codificado en el QR de nuestras etiquetas de lote)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LoteDetalleResponse {
  producto_id: string
  producto_nombre: string
  fecha_vencimiento: string | null
  stock_por_area: { area_id: number; area_nombre: string; cantidad: string | number }[]
}

interface ProductoDetalleResponse {
  codigo_interno: string | null
  categoria: { nombre: string } | null
  unidad_base: { nombre: string; nombre_plural: string | null } | null
  imagen_url: string | null
}

// Subset of `/productos/scan` GS1 response used by the consumption flow.
interface ScanGs1Response {
  encontrado?: boolean
  tipo?: string
  producto_id: string
  producto_nombre: string
  unidad_base_nombre?: string | null
  unidad_base_nombre_plural?: string | null
  stock_total?: string | number | null
  imagen_url?: string | null
  gs1?: { gtin?: string; numero_lote?: string | null; fecha_vencimiento?: string | null } | null
}

interface LoteListItem {
  id: string
  numero_lote: string
  stock_total: string | null
  fecha_vencimiento: string
}

// Builds a minimal StockItem from a GS1 scan result, for the FEFO fallback path
// (when the scanned lot is not usable in the active area).
function buildStockItemFromScan(data: ScanGs1Response, areaFiltro: number | null): StockItem {
  return {
    producto_id: String(data.producto_id),
    codigo_interno: '',
    producto_nombre: data.producto_nombre,
    categoria: null,
    unidad: data.unidad_base_nombre ?? '',
    unidad_plural: data.unidad_base_nombre_plural ?? null,
    stock_total: data.stock_total != null ? Number(data.stock_total) : 0,
    proximo_vencimiento: data.gs1?.fecha_vencimiento ?? null,
    proveedor_nombre: null,
    proveedor_icono: null,
    imagen_url: data.imagen_url ?? null,
    area_id: areaFiltro ?? undefined,
    area_nombre: '',
  }
}

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

// ─── CartPanel: panel fijo de carrito para desktop (lg+) ─────────────────────

interface CartPanelProps {
  cart: Record<string, CartItem>
  areaFiltro: number | null
  onUpdateCantidad: (productoId: string, cantidad: number) => void
  onUpdateLote: (productoId: string, loteId: string | null) => void
  onRemove: (productoId: string) => void
  onClear: () => void
  onConfirm: () => void
  isPending: boolean
  notas: string
  onNotasChange: (v: string) => void
}

function CartPanel({
  cart, areaFiltro,
  onUpdateCantidad, onUpdateLote, onRemove, onClear,
  onConfirm, isPending, notas, onNotasChange,
}: CartPanelProps) {
  const items = Object.values(cart)
  const count = items.length
  const [showValidacion, setShowValidacion] = useState(false)

  const hayCargando = items.some(i => i.cargando_lotes)
  const itemsDesajustados = areaFiltro
    ? items.filter(i => i.area_id !== 0 && i.area_id !== areaFiltro) : []
  const hayDesajuste = itemsDesajustados.length > 0

  function stockLoteSeleccionado(item: CartItem): number | null {
    if (!item.lote_elegido_id) return null
    return item.lotes.find(l => l.lote_id === item.lote_elegido_id)?.stock ?? null
  }

  const itemsConExceso = items.filter(i => {
    const s = stockLoteSeleccionado(i)
    return s !== null && i.cantidad_descontar > s
  })
  const confirmarBloqueado = hayCargando || hayDesajuste

  const handleConfirmClick = () => {
    if (itemsConExceso.length > 0) {
      setShowValidacion(true)
    } else {
      onConfirm()
    }
  }

  return (
    <div className="rounded-xl border border-base-200 bg-base-100 flex flex-col h-full overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-200 flex-shrink-0">
        <div className="flex items-center gap-2 font-bold text-sm">
          <ShoppingCart className="h-4 w-4 text-primary" />
          Consumo a registrar
          {count > 0 && (
            <span className="badge badge-primary badge-sm font-bold">{count}</span>
          )}
        </div>
        {count > 0 && (
          <button
            className="btn btn-ghost btn-xs text-error gap-1"
            onClick={onClear}
          >
            <X className="h-3 w-3" /> Vaciar
          </button>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3 py-3 scrollbar-thin-hover">
        {count === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-base-content/40 text-center">
            <ShoppingCart className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">El carrito está vacío</p>
            <p className="text-xs mt-1">Busca un insumo para agregar</p>
          </div>
        ) : (
          <>
            {hayDesajuste && (
              <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning font-medium leading-snug">
                  {itemsDesajustados.length} {itemsDesajustados.length === 1 ? 'item' : 'items'} de otra área.
                  Cambia el filtro o elimínalos antes de confirmar.
                </p>
              </div>
            )}

            {items.map(item => {
              const stockLote = stockLoteSeleccionado(item)
              const excedeLote = stockLote !== null && item.cantidad_descontar > stockLote
              const desajustado = areaFiltro !== null && item.area_id !== 0 && item.area_id !== areaFiltro

              return (
                <div
                  key={item.producto_id}
                  className={cn(
                    'rounded-2xl p-3 space-y-2',
                    desajustado ? 'bg-warning/5 border border-warning/30' : 'bg-base-200/40'
                  )}
                >
                  {/* Fila 1: nombre + área + quitar */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight line-clamp-2">{item.nombre}</p>
                      {item.area_nombre && (
                        <span className={cn(
                          'inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1',
                          desajustado ? 'bg-warning/15 text-warning' : 'bg-base-300/60 text-base-content/50'
                        )}>
                          {item.area_nombre}
                        </span>
                      )}
                    </div>
                    <button
                      className="btn btn-ghost btn-xs btn-circle text-error flex-shrink-0 -mt-0.5"
                      onClick={() => onRemove(item.producto_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Fila 2: lote pill (izq) + stepper (der) */}
                  <div className="flex items-center justify-between gap-2">
                    <LoteSelector
                      lotes={item.lotes}
                      cargandoLotes={item.cargando_lotes}
                      loteElegidoId={item.lote_elegido_id}
                      unidad={item.unidad}
                      unidad_plural={item.unidad_plural}
                      onChange={id => onUpdateLote(item.producto_id, id)}
                    />

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                          'border border-base-300 hover:border-primary hover:bg-primary/8 hover:text-primary transition-all duration-150'
                        )}
                        onClick={() => onUpdateCantidad(item.producto_id, Math.max(1, item.cantidad_descontar - 1))}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        className={cn(
                          'input input-bordered input-xs h-7 w-14 rounded-lg px-1 text-center text-sm font-bold tabular-nums',
                          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                          excedeLote ? 'input-error text-error' : 'text-base-content'
                        )}
                        value={item.cantidad_descontar}
                        onChange={e => {
                          const next = Number(e.target.value)
                          onUpdateCantidad(item.producto_id, Number.isFinite(next) ? Math.max(1, Math.trunc(next)) : 1)
                        }}
                        onFocus={e => e.currentTarget.select()}
                        aria-label={`Cantidad de ${item.nombre}`}
                      />
                      <button
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
                          'border border-base-300 hover:border-primary hover:bg-primary/8 hover:text-primary transition-all duration-150'
                        )}
                        onClick={() => onUpdateCantidad(item.producto_id, item.cantidad_descontar + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <span className="text-[11px] text-base-content/40 whitespace-nowrap">
                        {formatCantidad(item.cantidad_descontar, item.unidad, item.unidad_plural ?? undefined)
                          .replace(/^[\d.,\s]+/, '')
                          .trim()}
                      </span>
                    </div>
                  </div>

                  {/* Fila 3: feedback de stock */}
                  {stockLote !== null && (
                    excedeLote
                      ? <p className="text-[11px] text-error font-medium">Excede stock del lote (máx {formatCantidad(stockLote, item.unidad, item.unidad_plural)})</p>
                      : <p className="text-[11px] text-base-content/35">Disponible: {formatCantidad(stockLote, item.unidad, item.unidad_plural)}</p>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pt-2 pb-4 border-t border-base-200 space-y-2 bg-base-100 flex-shrink-0">
        <input
          className="input input-bordered input-sm w-full rounded-xl text-sm"
          placeholder="Nota (opcional)..."
          value={notas}
          onChange={e => onNotasChange(e.target.value)}
        />
        <button
          className="btn btn-primary w-full rounded-xl gap-2"
          disabled={count === 0 || isPending || confirmarBloqueado}
          onClick={handleConfirmClick}
        >
          {isPending
            ? <span className="loading loading-spinner loading-sm" />
            : hayCargando
              ? <><span className="loading loading-spinner loading-sm" /> Cargando lotes…</>
              : <><Zap className="h-4 w-4" /> Confirmar consumo</>}
        </button>
      </div>

      {/* Modal de validación */}
      {showValidacion && (
        <div className="modal modal-open z-50">
          <div className="modal-box max-w-md">
            <h3 className="font-bold text-base mb-1">Revisión antes de confirmar</h3>
            <p className="text-sm text-base-content/60 mb-4">
              {itemsConExceso.length} {itemsConExceso.length === 1 ? 'ítem excede' : 'ítems exceden'} el stock disponible.
            </p>
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {items.map(item => {
                const stock = stockLoteSeleccionado(item)
                const excede = stock !== null && item.cantidad_descontar > stock
                return (
                  <div key={item.producto_id} className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2 text-sm',
                    excede ? 'bg-error/8 border border-error/20' : 'bg-success/8 border border-success/20',
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      {excede
                        ? <XCircle className="size-4 text-error shrink-0" />
                        : <CheckCircle2 className="size-4 text-success shrink-0" />}
                      <span className="truncate font-medium">{item.nombre}</span>
                    </div>
                    <span className={cn('shrink-0 text-xs tabular-nums', excede ? 'text-error' : 'text-success')}>
                      {formatCantidad(item.cantidad_descontar, item.unidad, item.unidad_plural)}
                      {excede && stock !== null && (
                        <span className="opacity-60"> / {formatCantidad(stock, item.unidad, item.unidad_plural)}</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-base-content/50 mb-4">
              El backend usará FEFO automático. Si el stock total es insuficiente, el consumo fallará.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowValidacion(false)}>
                Corregir
              </button>
              <button
                className="btn btn-error btn-sm"
                onClick={() => { setShowValidacion(false); onConfirm() }}
              >
                Confirmar de todas formas
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowValidacion(false)} />
        </div>
      )}
    </div>
  )
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
  // GS1 scan whose lot can't be used in the active area → offer FEFO or cancel.
  const [fefoPrompt, setFefoPrompt] = useState<{
    stockItem: StockItem
    numeroLote: string
    motivo: 'sin-stock-en-area' | 'lote-no-encontrado'
  } | null>(null)

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
    staleTime: 5 * 60 * 1000,
  })
  const areas = areasData?.filter(a => a.activa) ?? []

  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock-list', searchQuery, areaFiltro],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
      params: {
        ...(searchQuery && { q: searchQuery }),
        ...(areaFiltro && { area_id: areaFiltro }),
        per_page: 100,
      }
    }).then(r => r.data),
  })

  const [recentIds, setRecentIds] = useState(() => getRecentIds(userId))
  const allProducts = stockResponse?.data ?? []

  // Items mostrados en el dropdown: con búsqueda → filtrado; sin búsqueda → primeros 16 alfabéticos
  const dropdownItems: StockItem[] = searchQuery ? allProducts : allProducts.slice(0, 16)

  // Items mostrados en la lista principal (solo recientes, sin búsqueda activa)
  const recentProducts: StockItem[] = (() => {
    if (recentIds.length === 0) return []
    return recentIds
      .map(id => allProducts.find(p => p.producto_id === id))
      .filter((p): p is StockItem => !!p)
  })()

  // ── Agregar al carrito ─────────────────────────────────────────────────────

  const addToCart = useCallback((p: StockItem, preselectLoteId?: string | null) => {
    if ((p.stock_total ?? 0) <= 0) { notify.error('Sin stock disponible'); return }
    const key = p.producto_id
    setCart(prev => {
      if (prev[key]) return {
        ...prev,
        [key]: {
          ...prev[key],
          cantidad_descontar: prev[key].cantidad_descontar + 1,
          // Si se escaneó un lote específico, fijarlo aunque el ítem ya estuviera en el carrito.
          ...(preselectLoteId ? { lote_elegido_id: preselectLoteId } : {}),
        },
      }
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
          lote_elegido_id: preselectLoteId ?? null,
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
    setDropdownOpen(true)
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

  // Resuelve un QR propio (lote_id) al lote exacto y lo agrega al carrito ya seleccionado,
  // salteando FEFO. El lote se resuelve por clave primaria → sin ambigüedad.
  const handleScanLote = useCallback(async (loteId: string) => {
    try {
      const { data: lote } = await api.get<LoteDetalleResponse>(`/lotes/${loteId}`)
      const { data: prod } = await api.get<ProductoDetalleResponse>(`/productos/${lote.producto_id}`)
      const areasConStock = lote.stock_por_area ?? []
      const areaSel = (areaFiltro && areasConStock.find(a => a.area_id === areaFiltro)) || areasConStock[0]
      const stockTotal = areasConStock.reduce((s, a) => s + Number(a.cantidad), 0)

      const item: StockItem = {
        producto_id: lote.producto_id,
        codigo_interno: prod.codigo_interno ?? '',
        producto_nombre: lote.producto_nombre,
        categoria: prod.categoria?.nombre ?? null,
        unidad: prod.unidad_base?.nombre ?? '',
        unidad_plural: prod.unidad_base?.nombre_plural ?? null,
        stock_total: stockTotal,
        proximo_vencimiento: lote.fecha_vencimiento ?? null,
        proveedor_nombre: null,
        proveedor_icono: null,
        imagen_url: prod.imagen_url ?? null,
        area_id: areaSel?.area_id ?? areaFiltro ?? undefined,
        area_nombre: areaSel?.area_nombre ?? '',
      }
      addToCart(item, loteId)
      setIsScannerOpen(false)
    } catch {
      notify.error('No se pudo resolver el lote escaneado')
    }
  }, [areaFiltro, addToCart])

  // Búsqueda por texto/código de barras → primer match + FEFO.
  const buscarYAgregarFefo = useCallback(async (q: string) => {
    try {
      const res = await api.get<PaginatedResponse<StockItem>>('/stock', {
        params: { q, ...(areaFiltro && { area_id: areaFiltro }) }
      })
      const items = res.data.data
      if (items.length === 0) { notify.error('Producto no encontrado'); return }
      addToCart(items[0])
      setIsScannerOpen(false)
    } catch { notify.error('Error al escanear') }
  }, [areaFiltro, addToCart])

  // GS1 DataMatrix: el backend resuelve GTIN→producto + lote; respetamos el lote escaneado.
  const handleScanGs1 = useCallback(async (rawCode: string) => {
    try {
      const { data } = await api.get<ScanGs1Response>('/productos/scan', { params: { codigo: rawCode } })
      if (!data?.encontrado || data.tipo !== 'gs1') {
        // El backend no lo resolvió como GS1 → caemos a búsqueda por texto.
        await buscarYAgregarFefo(rawCode)
        return
      }
      const productoId = String(data.producto_id)
      const numeroLote = data.gs1?.numero_lote ?? null

      // Sin lote en el código → FEFO directo.
      if (!numeroLote) {
        const item = buildStockItemFromScan(data, areaFiltro)
        if ((item.stock_total ?? 0) <= 0) { notify.error('Sin stock disponible'); return }
        addToCart(item)
        setIsScannerOpen(false)
        return
      }

      // Resolver el lote escaneado contra el stock del producto (en el área y global).
      const [lotesArea, lotesAll] = await Promise.all([
        areaFiltro
          ? api.get<LoteListItem[]>('/lotes', {
              params: { producto_id: productoId, con_stock: true, vencido: false, area_id: areaFiltro },
            }).then(r => r.data)
          : Promise.resolve<LoteListItem[] | null>(null),
        api.get<LoteListItem[]>('/lotes', {
          params: { producto_id: productoId, con_stock: true, vencido: false },
        }).then(r => r.data),
      ])
      const matchAll = findLoteByNumero(lotesAll, numeroLote)
      const loteEnArea = areaFiltro ? findLoteByNumero(lotesArea ?? [], numeroLote) : matchAll

      const outcome = classifyConsumoScan({
        numeroLote,
        loteEnArea: loteEnArea ? { lote_id: loteEnArea.id } : null,
        existeEnStock: !!matchAll,
      })

      if (outcome.kind === 'lote-exacto') {
        // Reutilizamos el resolver de lote exacto (arma el StockItem con el área correcta).
        await handleScanLote(outcome.loteId)
        return
      }
      // sin-stock-en-area | lote-no-encontrado → avisar y ofrecer FEFO/cancelar (nunca a ciegas).
      if (outcome.kind === 'sin-stock-en-area' || outcome.kind === 'lote-no-encontrado') {
        setIsScannerOpen(false)
        setFefoPrompt({
          stockItem: buildStockItemFromScan(data, areaFiltro),
          numeroLote: outcome.numeroLote,
          motivo: outcome.kind,
        })
      }
    } catch {
      notify.error('Error al escanear')
    }
  }, [areaFiltro, addToCart, handleScanLote, buscarYAgregarFefo])

  const handleScanCode = useCallback(async (code: string) => {
    const trimmed = code.trim()
    // Nuestras etiquetas codifican el lote_id (UUID) → resolución por lote exacto.
    if (UUID_RE.test(trimmed)) { await handleScanLote(trimmed); return }
    // Código GS1 (DataMatrix GTIN+lote+venc) → flujo con lote escaneado.
    if (parseGS1(trimmed)) { await handleScanGs1(trimmed); return }
    // Otro código (texto, código de barras de proveedor) → búsqueda de producto + FEFO.
    await buscarYAgregarFefo(trimmed)
  }, [handleScanLote, handleScanGs1, buscarYAgregarFefo])

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
      notify.success('Consumo registrado')
    },
    onError: (err: unknown) => notify.error(parseApiError(err)),
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
  const isSearching = !!searchQuery
  const showDropdown = dropdownOpen && (isSearching || dropdownItems.length > 0)

  // Props compartidas entre CartPanel y ConsumoDrawer
  const cartProps = {
    cart,
    areaFiltro,
    onUpdateCantidad: updateCantidad,
    onUpdateLote: updateLote,
    onRemove: removeItem,
    onClear: clearCart,
    onConfirm: handleConfirm,
    isPending: batchMutation.isPending,
    notas,
    onNotasChange: setNotas,
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start px-4 pt-3 pb-4 min-h-[calc(100vh-64px)]">

      {/* ── Columna izquierda — catálogo ── */}
      <div className="w-full lg:flex-[3] min-w-0 flex flex-col">

        {/* Header: título + área */}
        <div className="flex items-center justify-between pb-2 flex-shrink-0">
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

        {/* Barra de búsqueda + QR */}
        <div className="pb-3 flex-shrink-0">
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

        {/* Lista de recientes */}
        <div
          className="flex-1 overflow-y-auto"
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
      </div>

      {/* ── Columna derecha — carrito (solo desktop lg+) ── */}
      <div className="hidden lg:flex lg:flex-[2] lg:sticky lg:top-24 flex-col min-w-0 h-[calc(100vh-112px)]">
        <CartPanel {...cartProps} />
      </div>

      {/* ── Bottom Drawer (oculto en lg+) ── */}
      <div className="lg:hidden">
        <ConsumoDrawer
          {...cartProps}
          isExpanded={isDrawerExpanded}
          onToggle={() => setIsDrawerExpanded(e => !e)}
        />
      </div>

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

      {/* ── Aviso: lote escaneado no usable en el área → FEFO o cancelar ── */}
      {fefoPrompt && (
        <div className="modal modal-open z-[60]">
          <div className="modal-box max-w-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h3 className="font-bold text-base leading-snug">{fefoPrompt.stockItem.producto_nombre}</h3>
                <p className="text-sm text-base-content/70 mt-1">
                  {fefoPrompt.motivo === 'sin-stock-en-area'
                    ? <>El lote <span className="font-mono font-semibold">{fefoPrompt.numeroLote}</span> no tiene stock{areaFiltro ? <> en {areas.find(a => a.id === areaFiltro)?.nombre ?? 'el área'}</> : ''}.</>
                    : <>El lote <span className="font-mono font-semibold">{fefoPrompt.numeroLote}</span> no se encontró en stock.</>}
                </p>
                <p className="text-sm text-base-content/50 mt-1">
                  ¿Descontar por FEFO (vencimiento más próximo) o cancelar?
                </p>
              </div>
            </div>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" onClick={() => setFefoPrompt(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { addToCart(fefoPrompt.stockItem); setFefoPrompt(null) }}
              >
                Descontar por FEFO
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setFefoPrompt(null)} />
        </div>
      )}
    </div>
  )
}

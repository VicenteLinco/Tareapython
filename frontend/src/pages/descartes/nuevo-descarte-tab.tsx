import { useState, useMemo, useEffect, useRef } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
  Trash2, Search, Calendar, PackageX, AlertTriangle,
  ShieldCheck, CheckCircle2, Download,
} from 'lucide-react'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { Area, Proveedor, DescarteVencidoItem, DescarteSession } from '@/types'
import type { DescarteRequest } from '@/types/generated'
import { toast } from 'sonner'
import { cn, formatCantidad, daysUntil, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useDescartesStock } from './use-descartes-stock'
import { exportarDescartePDF } from '@/lib/descarte-pdf'
import { useAuthStore } from '@/hooks/use-auth-store'

interface DescarteItemLocal extends DescarteVencidoItem {
  cantidad_descartar: number
  motivo: 'vencido' | 'dañado' | 'contaminado' | 'otro'
}

const stockKey = (item: Pick<DescarteVencidoItem, 'lote_id' | 'area_id'>) =>
  `${item.lote_id}:${item.area_id}`
const MIN_SEARCH_CHARS = 2

const normalizeSearch = (value: string) =>
  value.trim().toLowerCase()

const searchRank = (item: DescarteVencidoItem, query: string) => {
  const product = normalizeSearch(item.producto_nombre)
  const lote = normalizeSearch(item.codigo_lote)

  if (lote === query) return 0
  if (lote.startsWith(query)) return 1
  if (product.startsWith(query)) return 2
  if (lote.includes(query)) return 3
  if (product.includes(query)) return 4
  return 5
}

interface NuevoDescarteTabProps {
  onDescarteCreado: () => void
}

export function NuevoDescarteTab({ onDescarteCreado }: NuevoDescarteTabProps) {
  const [search, setSearch] = useState('')
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false)
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([])

  const [filterAreaId, setFilterAreaId] = useState<number | null>(null)
  const [filterProveedorId, setFilterProveedorId] = useState<number | null>(null)
  const [filterIncluirProximos, setFilterIncluirProximos] = useState(false)
  const [items, setItems] = useState<Record<string, DescarteItemLocal>>({})
  const [showHealthyWarning, setShowHealthyWarning] = useState(false)
  const [healthyJustification, setHealthyJustification] = useState('')
  const [successSession, setSuccessSession] = useState<DescarteSession | null>(null)

  const queryClient = useQueryClient()
  const usuario = useAuthStore((s) => s.usuario)
  const searchTerm = search.trim()
  const canSearch = searchTerm.length >= MIN_SEARCH_CHARS

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const { data: config } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Record<string, string>>('/configuracion').then((r) => r.data),
  })

  const { data: stock = [], isLoading } = useDescartesStock({
    diasAlerta: filterIncluirProximos ? 30 : 0,
    areaId: filterAreaId,
    proveedorId: filterProveedorId,
  })

  const filteredStock = useMemo(() => {
    if (!canSearch) return stock
    const q = normalizeSearch(searchTerm)
    return stock.filter(
      (s) =>
        normalizeSearch(s.producto_nombre).includes(q) ||
        normalizeSearch(s.codigo_lote).includes(q)
    )
  }, [stock, searchTerm, canSearch])

  const selectedItems = Object.values(items)
  const totalSelected = selectedItems.length
  const healthyItems = selectedItems.filter((item) => {
    const days = daysUntil(item.fecha_vencimiento)
    return item.motivo !== 'vencido' && (days === null || days > 30)
  })
  const hasHealthyItems = healthyItems.length > 0

  const descarteMutation = useMutation({
    mutationFn: ({ request }: { request: DescarteRequest; snapshot: DescarteItemLocal[] }) =>
      api
        .post('/descartes', request, { headers: { 'X-Idempotency-Key': uuidv4() } })
        .then((r) => r.data),
    onSuccess: (data, variables) => {
      const { snapshot } = variables
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['descartes-stock'] })
      queryClient.invalidateQueries({ queryKey: ['descartes-historial'] })
      const session: DescarteSession = {
        grupo_movimiento: data.grupo_movimiento,
        fecha: new Date().toISOString(),
        usuario_nombre: usuario?.nombre ?? '',
        total_items: snapshot.length,
        areas: [...new Set(snapshot.map((i) => i.area_nombre))],
        items: snapshot.map((i) => ({
          producto_nombre: i.producto_nombre,
          codigo_lote: i.codigo_lote,
          area_nombre: i.area_nombre,
          tipo: i.motivo === 'vencido' ? 'DESCARTE_VENCIDO' : 'DESCARTE_DAÑADO',
          cantidad: i.cantidad_descartar,
          unidad_base_nombre: i.unidad_base_nombre,
          unidad_base_nombre_plural: i.unidad_base_nombre_plural,
          fecha_vencimiento: i.fecha_vencimiento,
          nota: null,
        })),
      }
      setSuccessSession(session)
      setItems({})
      onDescarteCreado()
    },
    onError: (err: unknown) => toast.error(parseApiError(err)),
  })

  const toggleItem = (stockItemKey: string) => {
    setItems((prev) => {
      if (prev[stockItemKey]) {
        const rest = { ...prev }
        delete rest[stockItemKey]
        return rest
      }
      const stockItem = stock.find((s) => stockKey(s) === stockItemKey)
      if (!stockItem) return prev
      const days = daysUntil(stockItem.fecha_vencimiento)
      const isExpired = days !== null && days < 0
      return {
        ...prev,
        [stockItemKey]: {
          ...stockItem,
          cantidad_descartar: stockItem.cantidad,
          motivo: isExpired ? 'vencido' : 'dañado',
        },
      }
    })
  }

  const updateItem = (
    stockItemKey: string,
    field: 'cantidad_descartar' | 'motivo',
    value: number | string
  ) => {
    setItems((prev) => ({ ...prev, [stockItemKey]: { ...prev[stockItemKey], [field]: value } }))
  }

  const executeDescarte = (justificacion?: string) => {
    if (totalSelected === 0) return
    const snapshot = [...selectedItems]

    const invalidItem = snapshot.find((i) => i.cantidad_descartar <= 0)
    if (invalidItem) {
      toast.error(`La cantidad de "${invalidItem.producto_nombre}" debe ser mayor a 0`)
      return
    }

    const request: DescarteRequest = {
      items: snapshot.map((i) => ({
        lote_id: i.lote_id,
        area_id: i.area_id,
        cantidad: String(i.cantidad_descartar),
        tipo: i.motivo === 'vencido' ? 'DESCARTE_VENCIDO' : 'DESCARTE_DAÑADO',
        nota:
          justificacion &&
          i.motivo !== 'vencido' &&
          (daysUntil(i.fecha_vencimiento) ?? 999) > 30
            ? justificacion
            : null,
      })),
    }
    descarteMutation.mutate({ request, snapshot })
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

  useEffect(() => { setSearchActiveIndex(-1) }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node))
        setSearchDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (searchActiveIndex >= 0)
      searchItemRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [searchActiveIndex])

  const searchSuggestions = useMemo(() => {
    if (!canSearch || selectedSearchStockKey) return []
    const q = normalizeSearch(searchTerm)
    return [...filteredStock]
      .sort((a, b) => {
        const rankDiff = searchRank(a, q) - searchRank(b, q)
        if (rankDiff !== 0) return rankDiff
        return a.producto_nombre.localeCompare(b.producto_nombre, 'es')
      })
      .slice(0, 12)
  }, [canSearch, filteredStock, searchTerm, selectedSearchStockKey])
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

  const groupedSearchItems = (() => {
    const result: ({ type: 'header'; letter: string } | { type: 'item'; item: typeof filteredStock[number]; idx: number })[] = []
    let lastL = ''
    searchSuggestions.forEach((item, idx) => {
      const l = item.producto_nombre[0]?.toUpperCase() ?? '#'
      if (l !== lastL) { result.push({ type: 'header', letter: l }); lastL = l }
      result.push({ type: 'item', item, idx })
    })
    return result
  })()

  const selectSearchItem = (item: typeof stock[number]) => {
    setSearch(`${item.producto_nombre} · ${item.codigo_lote}`)
    setSelectedSearchStockKey(stockKey(item))
    setSelectedSearchQuery(item.codigo_lote)
    setSearchDropdownOpen(false)
    setSearchActiveIndex(-1)
  }

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

  if (successSession) {
    return (
      <div className="flex items-center justify-center flex-1 py-12">
        <div className="bg-base-100 border border-success/30 rounded-3xl shadow-xl w-full max-w-md p-8 flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-success" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Descarte registrado</h2>
            <p className="text-sm opacity-50 mt-1">
              {successSession.total_items} {successSession.total_items === 1 ? 'ítem' : 'ítems'} descartados
              · {successSession.areas.join(', ')}
            </p>
            <p className="text-xs opacity-40 mt-0.5">{formatDate(successSession.fecha)}</p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Button
              className="gap-2 w-full"
              onClick={() =>
                exportarDescartePDF(
                  successSession,
                  config?.nombre_laboratorio ?? 'Laboratorio Clínico'
                )
              }
            >
              <Download className="w-4 h-4" />
              Descargar Acta PDF
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setSuccessSession(null)}>
              Nuevo descarte
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
      {/* Lista izquierda */}
      <div className="flex-1 flex flex-col min-w-0 gap-3">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div ref={searchContainerRef} className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 pointer-events-none z-10" />
            <Input
              placeholder="Buscar por insumo o lote..."
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSelectedSearchStockKey(null)
                setSelectedSearchQuery(null)
                setSearchDropdownOpen(true)
              }}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setSearchDropdownOpen(true)}
              aria-autocomplete="list"
              aria-expanded={showSearchDropdown}
            />
            {showSearchDropdown && (
              <div
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-64"
                role="listbox"
              >
                {groupedSearchItems.map(entry =>
                  entry.type === 'header' ? (
                    <div key={`h-${entry.letter}`} className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-base-content/30 bg-base-200/40 sticky top-0">
                      {entry.letter}
                    </div>
                  ) : (
                    <div
                      key={stockKey(entry.item)}
                      ref={(el) => { searchItemRefs.current[entry.idx] = el }}
                      role="option"
                      aria-selected={entry.idx === searchActiveIndex}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 cursor-pointer text-sm',
                        entry.idx === searchActiveIndex ? 'bg-primary/10 text-primary' : 'hover:bg-base-200/60'
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectSearchItem(entry.item)
                      }}
                    >
                      <span className="font-medium truncate">{entry.item.producto_nombre}</span>
                      <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">{entry.item.codigo_lote}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          <select
            className="select select-bordered select-sm w-auto"
            value={filterAreaId ?? ''}
            onChange={(e) => setFilterAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las áreas</option>
            {areas?.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>

          <select
            className="select select-bordered select-sm w-auto"
            value={filterProveedorId ?? ''}
            onChange={(e) => setFilterProveedorId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos los proveedores</option>
            {proveedores?.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>

          <button
            className={cn(
              'btn btn-sm gap-1.5',
              filterIncluirProximos ? 'btn-warning' : 'btn-outline'
            )}
            onClick={() => setFilterIncluirProximos((v) => !v)}
          >
            <Calendar className="w-3.5 h-3.5" />
            &lt;30d
          </button>
        </div>

        {/* Tabla */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-base-200 bg-base-100">
          <table className="table w-full">
            <thead className="sticky top-0 bg-base-100 z-10">
              <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
                <th className="w-8"></th>
                <th>Insumo / Lote</th>
                <th>Área</th>
                <th>Vencimiento</th>
                <th className="text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td colSpan={5}>
                      <div className="h-10 bg-base-200 animate-pulse rounded-lg" />
                    </td>
                  </tr>
                ))
              ) : filteredStock.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-20 text-center opacity-40 italic text-sm">
                    {stock.length === 0
                      ? 'No hay ítems vencidos en este momento'
                      : 'No se encontraron ítems con ese filtro'}
                  </td>
                </tr>
              ) : (
                filteredStock.flatMap((s) => {
                  const days = daysUntil(s.fecha_vencimiento)
                  const isExpired = days !== null && days < 0
                  const isExpiring = days !== null && days >= 0 && days <= 30
                  const isSano = days === null || days > 30
                  const itemKey = stockKey(s)
                  const isSelected = !!items[itemKey]
                  const item = items[itemKey]

                  const rows: React.ReactElement[] = [
                    <tr
                      key={itemKey}
                      className={cn(
                        'hover:bg-base-200/30 cursor-pointer transition-colors',
                        isSelected && 'bg-primary/5 hover:bg-primary/10'
                      )}
                      onClick={() => toggleItem(itemKey)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-error"
                          checked={isSelected}
                          readOnly
                        />
                      </td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm">{s.producto_nombre}</span>
                            {isSano && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                                <ShieldCheck className="w-2.5 h-2.5" /> sano
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono opacity-50">
                            LOTE: {s.codigo_lote}
                          </span>
                        </div>
                      </td>
                      <td className="text-sm opacity-70">{s.area_nombre}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'text-xs font-medium',
                              isExpired ? 'text-error' : isExpiring ? 'text-warning' : ''
                            )}
                          >
                            {formatDate(s.fecha_vencimiento)}
                          </span>
                          {isExpired && (
                            <Badge variant="destructive" className="h-4 text-[8px] px-1">
                              VENCIDO
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-right">
                        <span className="font-mono font-bold text-sm">
                          {formatCantidad(s.cantidad, s.unidad_base_nombre, s.unidad_base_nombre_plural)}
                        </span>
                      </td>
                    </tr>,
                  ]

                  if (isSelected && item) {
                    rows.push(
                      <tr
                        key={`${itemKey}-edit`}
                        className="bg-primary/5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <td />
                        <td colSpan={4}>
                          <div className="flex items-center gap-4 py-1">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] font-bold opacity-50 uppercase tracking-wider">
                                Cantidad
                              </label>
                              <input
                                type="number"
                                className="input input-bordered input-xs w-24 font-mono font-bold"
                                value={item.cantidad_descartar}
                                min={0.01}
                                max={item.cantidad}
                                step="any"
                                onChange={(e) =>
                                  updateItem(itemKey, 'cantidad_descartar', Number(e.target.value))
                                }
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] font-bold opacity-50 uppercase tracking-wider">
                                Motivo
                              </label>
                              <select
                                className="select select-bordered select-xs text-[11px]"
                                value={item.motivo}
                                onChange={(e) =>
                                  updateItem(itemKey, 'motivo', e.target.value)
                                }
                              >
                                <option value="vencido">Vencido</option>
                                <option value="dañado">Dañado</option>
                                <option value="contaminado">Contaminado</option>
                                <option value="otro">Otro</option>
                              </select>
                            </div>
                            <button
                              className="ml-auto text-error opacity-50 hover:opacity-100"
                              onClick={() => toggleItem(itemKey)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return rows
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Carrito derecho */}
      <div
        className={cn(
          'w-full lg:w-80 flex flex-col bg-base-100 border border-base-200 rounded-2xl shadow-lg transition-all',
          totalSelected === 0 && 'opacity-40 grayscale'
        )}
      >
        <div className="p-5 border-b border-base-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-error" />
            <h2 className="font-bold text-sm">Ítems a descartar</h2>
          </div>
          <Badge variant="outline">{totalSelected}</Badge>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {totalSelected === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 gap-2 py-12">
              <PackageX className="w-10 h-10" />
              <p className="text-xs">Seleccioná ítems de la lista</p>
            </div>
          ) : (
            selectedItems.map((item) => {
              const days = daysUntil(item.fecha_vencimiento)
              const isSano = days === null || days > 30
              return (
                <div
                  key={stockKey(item)}
                  className="p-3 bg-base-200/40 rounded-xl border border-base-300 text-xs space-y-1"
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-bold line-clamp-1">{item.producto_nombre}</span>
                    {isSano && <ShieldCheck className="w-3 h-3 text-warning shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 opacity-50">
                    <span className="font-mono">{item.codigo_lote}</span>
                    <span>·</span>
                    <span>{item.area_nombre}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-60">
                    <span className="font-mono font-bold">
                      {formatCantidad(item.cantidad_descartar, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{item.motivo}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="p-4 border-t border-base-200">
          <Button
            className="w-full h-10 rounded-xl gap-2"
            variant="destructive"
            disabled={totalSelected === 0 || descarteMutation.isPending}
            onClick={handleConfirm}
          >
            {descarteMutation.isPending ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Confirmar Descarte
          </Button>
          <p className="text-[9px] text-center mt-2 opacity-30 leading-tight">
            Genera movimientos de salida tipo DESCARTE en el historial
          </p>
        </div>
      </div>

      {/* Modal advertencia sanos */}
      {showHealthyWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-base-100 rounded-3xl shadow-2xl border border-warning/30 w-full max-w-md mx-4">
            <div className="bg-warning/10 px-6 py-5 flex items-center gap-3 border-b border-warning/20 rounded-t-3xl">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              <div>
                <h3 className="font-bold">¿Descartar insumos en buen estado?</h3>
                <p className="text-xs opacity-60 mt-0.5">
                  {healthyItems.length}{' '}
                  {healthyItems.length === 1 ? 'ítem sano requiere' : 'ítems sanos requieren'}{' '}
                  justificación
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                {healthyItems.map((item) => (
                  <li
                    key={stockKey(item)}
                    className="flex items-center justify-between text-xs bg-base-200/50 rounded-xl px-3 py-2"
                  >
                    <span className="font-bold truncate">{item.producto_nombre}</span>
                    <span className="font-mono opacity-50 ml-2 shrink-0">
                      {formatCantidad(item.cantidad_descartar, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">
                  Justificación obligatoria
                </label>
                <textarea
                  className="textarea textarea-bordered w-full rounded-2xl resize-none text-sm h-20"
                  placeholder="Explica por qué se descarta material en buen estado..."
                  value={healthyJustification}
                  onChange={(e) => setHealthyJustification(e.target.value)}
                />
                <p className="text-[10px] opacity-40 text-right">
                  {healthyJustification.length}/10 min
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => { setShowHealthyWarning(false); setHealthyJustification('') }}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-warning flex-1 gap-2"
                  disabled={healthyJustification.trim().length < 10 || descarteMutation.isPending}
                  onClick={() => executeDescarte(healthyJustification.trim())}
                >
                  {descarteMutation.isPending && <span className="loading loading-spinner loading-sm" />}
                  Confirmar de todas formas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

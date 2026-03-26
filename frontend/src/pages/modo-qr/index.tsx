import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { Camera, X, CheckCircle2, Trash2, Send, ScanLine, ClipboardCheck } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useAreaStore } from '@/hooks/use-area-store'
import type { Area, SesionConteo, ConteoItem } from '@/types'
import { cn, formatCantidad } from '@/lib/utils'
import { ExitModeModal } from '@/components/ui/exit-mode-modal'

// ─── Types ─────────────────────────────────────────────────────────────────

type QrMode = 'select' | 'consumo' | 'conteo'

interface ScannedItem {
  id: string
  codigo: string
  producto_id: string
  producto_nombre: string
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  presentacion_nombre: string | null
  factor_conversion: number | null
  cantidad: number
}

// ─── Camera Scanner Component ────────────────────────────────────────────────

function CameraScanner({
  onScan,
  active,
}: {
  onScan: (code: string) => void
  active: boolean
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const divId = 'qr-reader-' + useRef(uuidv4().slice(0, 8)).current
  const [error, setError] = useState<string | null>(null)
  const scanning = useRef(false)

  useEffect(() => {
    if (!active) return

    const scanner = new Html5Qrcode(divId)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (!scanning.current) {
            scanning.current = true
            onScan(decodedText)
            setTimeout(() => { scanning.current = false }, 1500)
          }
        },
        () => {}
      )
      .catch((err) => {
        setError(String(err))
      })

    return () => {
      scanner.stop().catch(() => {}).finally(() => scanner.clear())
    }
  }, [active, onScan, divId])

  return (
    <div className="relative">
      <div id={divId} className="w-full rounded-xl overflow-hidden" />
      {error && (
        <div className="p-3 bg-error/10 text-error text-sm rounded-xl mt-2">
          No se pudo acceder a la cámara: {error}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ModoQrPage() {
  const { accessToken } = useAuthStore()
  const logout = useAuthStore((s) => s.logout)
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [mode, setMode] = useState<QrMode>('select')
  const [showExit, setShowExit] = useState(false)
  const [areaId, setAreaId] = useState<number | null>(globalAreaId)
  const [cameraActive, setCameraActive] = useState(false)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [notas, setNotas] = useState('')

  // Conteo mode state
  const [conteoSessionId, setConteoSessionId] = useState<string | null>(null)
  const [conteoItems, setConteoItems] = useState<ConteoItem[]>([])
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, { cantidad: string; version: number }>>({})
  const [lastScannedItemId, setLastScannedItemId] = useState<string | null>(null)

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: sesionesAbiertas } = useQuery({
    queryKey: ['conteo', { estado: 'en_progreso' }],
    queryFn: () =>
      api.get<{ data: SesionConteo[] }>('/conteo', { params: { estado: 'en_progreso', per_page: 20 } })
        .then((r) => r.data.data),
    enabled: mode === 'conteo',
  })

  // Auth guard
  if (!accessToken) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <a href="/login" className="btn btn-primary">Iniciar sesión</a>
      </div>
    )
  }

  // ── Scan barcode lookup ──
  const handleScan = useCallback(async (code: string) => {
    if (mode === 'consumo') {
      try {
        const res = await api.get<{
          encontrado: boolean
          producto_id?: string
          producto_nombre?: string
          unidad_base_nombre?: string
          unidad_base_nombre_plural?: string
          presentacion_nombre?: string | null
          factor_conversion?: number | null
        }>(`/productos/scan?codigo=${encodeURIComponent(code)}`)

        if (!res.data.encontrado) {
          toast.error(`Código no reconocido: ${code}`)
          return
        }

        const existing = scannedItems.find((i) => i.codigo === code)
        if (existing) {
          setScannedItems((prev) =>
            prev.map((i) => i.codigo === code ? { ...i, cantidad: i.cantidad + 1 } : i)
          )
          toast.success(`+1 ${res.data.producto_nombre}`)
          return
        }

        setScannedItems((prev) => [
          ...prev,
          {
            id: uuidv4(),
            codigo: code,
            producto_id: res.data.producto_id!,
            producto_nombre: res.data.producto_nombre!,
            unidad_base_nombre: res.data.unidad_base_nombre!,
            unidad_base_nombre_plural: res.data.unidad_base_nombre_plural!,
            presentacion_nombre: res.data.presentacion_nombre ?? null,
            factor_conversion: res.data.factor_conversion ?? null,
            cantidad: 1,
          },
        ])
        toast.success(`Agregado: ${res.data.producto_nombre}`)
      } catch {
        toast.error('Error al buscar código')
      }
    } else if (mode === 'conteo' && conteoItems.length > 0) {
      // Try to match QR code to a conteo item
      // QR encodes: {"tipo":"producto","id":"<uuid>","nombre":"...","codigo":"..."}
      let productoId: string | null = null
      try {
        const parsed = JSON.parse(code)
        if (parsed.tipo === 'producto' || parsed.tipo === 'lote') {
          productoId = parsed.id
        }
      } catch {
        // Not JSON, treat as barcode/codigo_interno
        productoId = code
      }

      const matchingItems = conteoItems.filter(
        (i) => i.producto_id === productoId || i.lote_id === productoId
      )

      if (matchingItems.length === 0) {
        toast.warning('Producto no encontrado en esta sesión de conteo')
        return
      }

      // If single match, highlight it
      if (matchingItems.length === 1) {
        setLastScannedItemId(matchingItems[0].id)
        toast.success(`Encontrado: ${matchingItems[0].producto_nombre}`)
      } else {
        toast.success(`${matchingItems.length} lotes encontrados para este producto`)
      }
    }
  }, [mode, scannedItems, conteoItems])

  // ── Batch consume ──
  const batchMut = useMutation({
    mutationFn: () => {
      if (!areaId || scannedItems.length === 0) throw new Error()
      return api.post('/consumos/batch', {
        area_id: areaId,
        items: scannedItems.map((i) => ({
          producto_id: i.producto_id,
          cantidad: i.factor_conversion ? i.cantidad * i.factor_conversion : i.cantidad,
        })),
        notas: notas || undefined,
      }, { headers: { 'X-Idempotency-Key': uuidv4() } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      setScannedItems([])
      setNotas('')
      setCameraActive(false)
      toast.success(`${scannedItems.length} productos consumidos`)
    },
    onError: () => toast.error('Error al registrar consumos'),
  })

  // ── Load conteo session ──
  async function loadConteoSession(sessionId: string) {
    try {
      const res = await api.get<{ sesion: SesionConteo; items: ConteoItem[] }>(`/conteo/${sessionId}`)
      setConteoSessionId(sessionId)
      setConteoItems(res.data.items)
    } catch {
      toast.error('Error al cargar sesión')
    }
  }

  // ── Save conteo updates ──
  const saveMut = useMutation({
    mutationFn: () => {
      const payload = Object.entries(pendingUpdates).map(([item_id, u]) => ({
        item_id,
        cantidad_contada: parseFloat(u.cantidad),
        estado_item: 'contado',
        version: u.version,
      }))
      return api.patch(`/conteo/${conteoSessionId}/items`, { items: payload })
    },
    onSuccess: () => {
      setPendingUpdates({})
      toast.success('Guardado')
      loadConteoSession(conteoSessionId!)
    },
    onError: () => toast.error('Error al guardar'),
  })

  // ─── Select Mode Screen ───
  if (mode === 'select') {
    return (
      <div className="min-h-screen bg-base-200 p-4 space-y-6">
        <div className="flex items-center gap-3 pt-2">
          <ScanLine className="h-6 w-6 text-primary" />
          <div className="flex-1">
            <h1 className="text-xl font-bold">Modo QR / Escáner</h1>
            <p className="text-xs opacity-40">Seleccione el modo de operación</p>
          </div>
          <button
            className="btn btn-ghost btn-xs opacity-20 hover:opacity-60"
            onClick={() => setShowExit(true)}
            title="Salir del modo QR"
          >
            ⚙
          </button>
        </div>

        {/* Area selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Área de trabajo</label>
          <select
            className="select select-bordered w-full"
            value={areaId ?? ''}
            onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Seleccionar área...</option>
            {(areas ?? []).filter((a) => a.activa).map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <button
            className="btn btn-primary w-full h-20 flex-col gap-1 text-left normal-case"
            onClick={() => { setMode('consumo'); setCameraActive(true) }}
            disabled={!areaId}
          >
            <div className="flex items-center gap-3 w-full">
              <Camera className="h-6 w-6 shrink-0" />
              <div>
                <p className="font-bold text-base">Consumo por escaneo</p>
                <p className="text-xs opacity-70 font-normal">Escanee productos para registrar salidas masivas</p>
              </div>
            </div>
          </button>

          <button
            className="btn btn-secondary w-full h-20 flex-col gap-1 text-left normal-case"
            onClick={() => setMode('conteo')}
          >
            <div className="flex items-center gap-3 w-full">
              <ClipboardCheck className="h-6 w-6 shrink-0" />
              <div>
                <p className="font-bold text-base">Conteo por sesión</p>
                <p className="text-xs opacity-70 font-normal">Seleccione una sesión activa y escanee los ítems</p>
              </div>
            </div>
          </button>
        </div>

        <p className="text-xs text-center opacity-30">
          Requiere acceso a la cámara del dispositivo
        </p>

        {showExit && (
          <ExitModeModal
            onConfirm={() => { logout(); navigate('/login', { replace: true }) }}
            onCancel={() => setShowExit(false)}
          />
        )}
      </div>
    )
  }

  // ─── Consumo Mode ───
  if (mode === 'consumo') {
    const selectedAreaName = areas?.find((a) => a.id === areaId)?.nombre ?? ''
    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        {/* Header */}
        <div className="bg-base-100 border-b border-base-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            className="btn btn-ghost btn-circle btn-sm"
            onClick={() => { setMode('select'); setCameraActive(false); setScannedItems([]) }}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <p className="font-semibold text-sm">Consumo por escaneo</p>
            <p className="text-xs opacity-40">{selectedAreaName} · {scannedItems.length} producto{scannedItems.length !== 1 ? 's' : ''}</p>
          </div>
          {scannedItems.length > 0 && (
            <button
              className="btn btn-ghost btn-sm gap-1"
              onClick={() => setCameraActive((v) => !v)}
            >
              <Camera className="h-4 w-4" />
              {cameraActive ? 'Pausar' : 'Escanear'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs opacity-20 hover:opacity-60"
            onClick={() => setShowExit(true)}
            title="Salir del modo QR"
          >
            ⚙
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Camera */}
          {cameraActive && (
            <div className="p-3">
              <CameraScanner onScan={handleScan} active={cameraActive} />
            </div>
          )}

          {!cameraActive && scannedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Camera className="h-12 w-12 opacity-20" />
              <p className="opacity-40">Inicie la cámara para escanear</p>
              <button className="btn btn-primary" onClick={() => setCameraActive(true)}>
                <Camera className="h-4 w-4 mr-2" /> Abrir cámara
              </button>
            </div>
          )}

          {/* Scanned items list */}
          {scannedItems.length > 0 && (
            <div className="px-3 py-2 space-y-2">
              {scannedItems.map((item) => (
                <div key={item.id} className="bg-base-100 rounded-xl p-3 border border-base-200 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{item.producto_nombre}</p>
                    {item.presentacion_nombre && (
                      <p className="text-xs opacity-40">{item.presentacion_nombre}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-ghost btn-xs btn-circle"
                      onClick={() => setScannedItems((p) => p.map((i) => i.id === item.id ? { ...i, cantidad: Math.max(1, i.cantidad - 1) } : i))}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      className="input input-bordered input-sm w-16 text-center text-sm font-bold"
                      value={item.cantidad}
                      min={1}
                      onChange={(e) => setScannedItems((p) => p.map((i) => i.id === item.id ? { ...i, cantidad: Math.max(1, Math.round(Number(e.target.value))) } : i))}
                    />
                    <button
                      className="btn btn-ghost btn-xs btn-circle"
                      onClick={() => setScannedItems((p) => p.map((i) => i.id === item.id ? { ...i, cantidad: i.cantidad + 1 } : i))}
                    >
                      +
                    </button>
                    <button
                      className="btn btn-ghost btn-xs btn-circle opacity-30"
                      onClick={() => setScannedItems((p) => p.filter((i) => i.id !== item.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        {scannedItems.length > 0 && (
          <div className="sticky bottom-0 bg-base-100 border-t border-base-200 p-3 space-y-2">
            <input
              type="text"
              className="input input-bordered w-full input-sm"
              placeholder="Notas (opcional)"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
            <button
              className="btn btn-primary w-full gap-2"
              onClick={() => batchMut.mutate()}
              disabled={batchMut.isPending}
            >
              {batchMut.isPending
                ? <span className="loading loading-spinner loading-sm" />
                : <Send className="h-4 w-4" />}
              Registrar {scannedItems.length} consumo{scannedItems.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}
        {showExit && (
          <ExitModeModal
            onConfirm={() => { logout(); navigate('/login', { replace: true }) }}
            onCancel={() => setShowExit(false)}
          />
        )}
      </div>
    )
  }

  // ─── Conteo Mode ───
  if (mode === 'conteo') {
    const hasPending = Object.keys(pendingUpdates).length > 0

    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        <div className="bg-base-100 border-b border-base-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            className="btn btn-ghost btn-circle btn-sm"
            onClick={() => { setMode('select'); setConteoSessionId(null); setConteoItems([]) }}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <p className="font-semibold text-sm">Conteo por sesión</p>
            {conteoSessionId && (
              <p className="text-xs opacity-40">
                {conteoItems.filter((i) => i.estado_item === 'contado').length} / {conteoItems.length} contados
              </p>
            )}
          </div>
          {hasPending && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? <span className="loading loading-spinner loading-xs" /> : 'Guardar'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-xs opacity-20 hover:opacity-60"
            onClick={() => setShowExit(true)}
            title="Salir del modo QR"
          >
            ⚙
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!conteoSessionId ? (
            <>
              <p className="text-sm opacity-60 font-medium">Sesiones en progreso:</p>
              {(sesionesAbiertas ?? []).length === 0 ? (
                <div className="text-center py-8 opacity-30">
                  <ClipboardCheck className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">No hay sesiones en progreso</p>
                </div>
              ) : (
                (sesionesAbiertas ?? []).map((s) => (
                  <button
                    key={s.id}
                    className="w-full bg-base-100 rounded-xl p-4 border border-base-200 text-left hover:border-primary/40 transition-colors"
                    onClick={() => loadConteoSession(s.id)}
                  >
                    <p className="font-semibold">{s.area_nombre}</p>
                    <p className="text-xs opacity-40">
                      {s.items_contados} / {s.total_items} ítems · {s.usuario_creador_nombre}
                    </p>
                  </button>
                ))
              )}
            </>
          ) : (
            <>
              {/* Camera scanner */}
              <CameraScanner onScan={handleScan} active={true} />

              {/* Items */}
              <div className="space-y-1.5">
                {conteoItems.map((item) => {
                  const isHighlighted = item.id === lastScannedItemId
                  const pending = pendingUpdates[item.id]
                  const cantidadDisplay = pending?.cantidad ?? (item.cantidad_contada !== null ? String(item.cantidad_contada) : '')

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'bg-base-100 rounded-xl border p-3 transition-all',
                        isHighlighted ? 'border-primary shadow-md' : 'border-base-200',
                        item.estado_item === 'contado' && !isHighlighted ? 'opacity-60' : ''
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{item.producto_nombre}</p>
                          <p className="text-xs opacity-40 font-mono">{item.numero_lote} · {item.fecha_vencimiento.slice(0, 7)}</p>
                          <p className="text-xs opacity-40">
                            Sistema: {formatCantidad(Number(item.stock_sistema), item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="input input-bordered input-sm w-20 text-center font-bold"
                            placeholder="—"
                            value={cantidadDisplay}
                            onChange={(e) =>
                              setPendingUpdates((prev) => ({
                                ...prev,
                                [item.id]: { cantidad: e.target.value, version: item.version },
                              }))
                            }
                          />
                          {item.estado_item === 'contado' && !pending && (
                            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        {showExit && (
          <ExitModeModal
            onConfirm={() => { logout(); navigate('/login', { replace: true }) }}
            onCancel={() => setShowExit(false)}
          />
        )}
      </div>
    )
  }

  return null
}

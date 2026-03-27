import { useState, useEffect, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import QRCode from 'qrcode'
import api from '@/lib/api'
import { useAuthStore } from '@/hooks/use-auth-store'
import type { Area } from '@/types'
import { formatCantidad } from '@/lib/utils'
import { ExitModeModal } from '@/components/ui/exit-mode-modal'

// ─── Types ─────────────────────────────────────────────────────────────────

interface ScanResult {
  encontrado: boolean
  producto_id?: string
  producto_nombre?: string
  unidad_base_nombre?: string
  unidad_base_nombre_plural?: string
  presentacion_id?: number | null
  presentacion_nombre?: string | null
  factor_conversion?: number | null
  stock_total?: number | null
}

type KioskMode = 'home' | 'consumir' | 'recibir' | 'imprimir'

// ─── Barcode Scanner Hook ───────────────────────────────────────────────────

function useBarcodeScanner(onScan: (code: string) => void, active: boolean) {
  const bufferRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier-only keypresses and function keys
      if (e.key.length > 1 && e.key !== 'Enter') return
      if (e.ctrlKey || e.altKey || e.metaKey) return

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim()
        bufferRef.current = ''
        if (timerRef.current) clearTimeout(timerRef.current)
        if (code.length >= 3) onScan(code)
        return
      }

      bufferRef.current += e.key
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        bufferRef.current = ''
      }, 200)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onScan, active])
}

// ─── QR Canvas Component ────────────────────────────────────────────────────

function QrCanvas({ data }: { data: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, data, { width: 256, margin: 2 })
    }
  }, [data])
  return <canvas ref={canvasRef} />
}

// ─── Main Kiosk Component ───────────────────────────────────────────────────

export default function KioskPage() {
  const { accessToken, usuario } = useAuthStore()
  const logout = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [mode, setMode] = useState<KioskMode>('home')
  const [showExit, setShowExit] = useState(false)
  const [areaId, setAreaId] = useState<number | null>(() => {
    const saved = sessionStorage.getItem('kiosk-area-id')
    return saved ? Number(saved) : null
  })
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [cantidad, setCantidad] = useState('1')
  const [notas, setNotas] = useState('')
  const [qrData, setQrData] = useState<string | null>(null)
  const [inactiveOverlay, setInactiveOverlay] = useState(false)
  const inactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  const INACTIVITY_MS = 5 * 60 * 1000

  // Auth guard
  if (!accessToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200">
        <div className="text-center">
          <p className="text-lg opacity-60">Sesión no iniciada</p>
          <a href="/login" className="btn btn-primary mt-4">Iniciar sesión</a>
        </div>
      </div>
    )
  }

  // ── Inactivity timer ──
  const resetInactivity = useCallback(() => {
    setInactiveOverlay(false)
    if (inactiveTimer.current) clearTimeout(inactiveTimer.current)
    inactiveTimer.current = setTimeout(() => setInactiveOverlay(true), INACTIVITY_MS)
  }, [])

  useEffect(() => {
    resetInactivity()
    window.addEventListener('mousemove', resetInactivity)
    window.addEventListener('keydown', resetInactivity)
    window.addEventListener('touchstart', resetInactivity)
    return () => {
      if (inactiveTimer.current) clearTimeout(inactiveTimer.current)
      window.removeEventListener('mousemove', resetInactivity)
      window.removeEventListener('keydown', resetInactivity)
      window.removeEventListener('touchstart', resetInactivity)
    }
  }, [resetInactivity])

  // ── Area ──
  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  function selectArea(id: number) {
    setAreaId(id)
    sessionStorage.setItem('kiosk-area-id', String(id))
  }

  // ── Scan handler ──
  const handleScan = useCallback(async (code: string) => {
    if (mode === 'home' || !['consumir', 'imprimir'].includes(mode)) return
    try {
      const res = await api.get<ScanResult>(`/productos/scan?codigo=${encodeURIComponent(code)}`)
      if (!res.data.encontrado) {
        toast.error(`Código no encontrado: ${code}`)
        return
      }
      setScanResult(res.data)
      setCantidad('1')
      if (mode === 'imprimir') {
        const qrPayload = JSON.stringify({
          tipo: 'producto',
          id: res.data.producto_id,
          nombre: res.data.producto_nombre,
          codigo: code,
        })
        setQrData(qrPayload)
      } else {
        setTimeout(() => cantidadRef.current?.focus(), 100)
      }
    } catch {
      toast.error('Error al buscar código')
    }
  }, [mode])

  useBarcodeScanner(handleScan, mode === 'consumir' || mode === 'imprimir')

  // ── Consume mutation ──
  const consumoMut = useMutation({
    mutationFn: () => {
      if (!scanResult?.producto_id || !areaId) throw new Error('Datos incompletos')
      const cant = parseFloat(cantidad)
      const base = scanResult.factor_conversion ? cant * scanResult.factor_conversion : cant
      return api.post('/consumos', {
        producto_id: scanResult.producto_id,
        area_id: areaId,
        cantidad: base,
        notas: notas || undefined,
      }, { headers: { 'X-Idempotency-Key': uuidv4() } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      toast.success(`Consumo registrado: ${scanResult?.producto_nombre}`)
      setScanResult(null)
      setCantidad('1')
      setNotas('')
    },
    onError: () => toast.error('Error al registrar consumo'),
  })

  const selectedArea = areas?.find((a) => a.id === areaId)

  // ─── Setup: no area selected ───
  if (!areaId || !selectedArea) {
    return (
      <div className="min-h-screen bg-base-200 flex flex-col items-center justify-center p-6 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-black tracking-tight">Modo Kiosko</h1>
          <p className="opacity-50 mt-1">Seleccione el área de este terminal</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-lg">
          {(areas ?? []).filter((a) => a.activa).map((a) => (
            <button
              key={a.id}
              onClick={() => selectArea(a.id)}
              className="btn btn-lg btn-outline h-20 flex-col gap-1"
            >
              <span className="text-base font-bold">{a.nombre}</span>
              {a.es_bodega && <span className="badge badge-ghost badge-xs">Bodega</span>}
            </button>
          ))}
        </div>
        <p className="text-xs opacity-30">Usuario: {usuario?.nombre}</p>
      </div>
    )
  }

  // ─── Home Screen ───
  if (mode === 'home') {
    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        {/* Top bar */}
        <div className="bg-base-100 border-b border-base-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="badge badge-primary badge-lg font-bold">{selectedArea.nombre}</div>
            <span className="text-sm opacity-40">{usuario?.nombre}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost btn-sm text-primary font-bold"
              onClick={() => { setAreaId(null); sessionStorage.removeItem('kiosk-area-id') }}
            >
              Cambiar área
            </button>
            <button
              className="btn btn-ghost btn-sm text-error font-bold gap-1"
              onClick={() => { resetInactivity(); setShowExit(true) }}
            >
              <X className="h-4 w-4" />
              Salir
            </button>
          </div>
        </div>

        {/* Action grid */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <h1 className="text-2xl font-black opacity-30 uppercase tracking-widest">Escanee o seleccione</h1>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl">
            <ActionCard
              emoji="📤"
              label="Registrar Consumo"
              description="Escanee el código del reactivo a consumir"
              color="btn-primary"
              onClick={() => { setMode('consumir'); setScanResult(null) }}
            />
            <ActionCard
              emoji="📥"
              label="Recibir Insumos"
              description="Registrar entrada de reactivos"
              color="btn-secondary"
              onClick={() => setMode('recibir')}
            />
            <ActionCard
              emoji="🖨️"
              label="Imprimir QR"
              description="Generar código QR de un producto"
              color="btn-accent"
              onClick={() => { setMode('imprimir'); setScanResult(null); setQrData(null) }}
            />
          </div>
        </div>

        {inactiveOverlay && (
          <InactivityOverlay onDismiss={resetInactivity} />
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

  // ─── Consumir Mode ───
  if (mode === 'consumir') {
    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        <KioskHeader title="Registrar Consumo" area={selectedArea.nombre} onBack={() => { setMode('home'); setScanResult(null) }} onExit={() => { resetInactivity(); setShowExit(true) }} />

        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-lg mx-auto w-full">
          {!scanResult ? (
            <div className="text-center space-y-4">
              <div className="text-8xl">📡</div>
              <p className="text-2xl font-bold opacity-60">Escanee el código de barras</p>
              <p className="text-sm opacity-30">El lector capturará el código automáticamente</p>
              <div className="divider text-xs opacity-30">o ingrese manualmente</div>
              <ManualInput onSubmit={handleScan} />
            </div>
          ) : (
            <div className="w-full space-y-4">
              <div className="bg-base-100 rounded-2xl p-6 text-center shadow-sm border border-base-200">
                <p className="text-sm opacity-40 uppercase font-bold tracking-wider mb-1">Producto identificado</p>
                <p className="text-2xl font-black">{scanResult.producto_nombre}</p>
                {scanResult.presentacion_nombre && (
                  <p className="text-base opacity-60 mt-1">{scanResult.presentacion_nombre}</p>
                )}
                {scanResult.stock_total !== null && scanResult.stock_total !== undefined && (
                  <p className="mt-2 text-sm">
                    Stock disponible:{' '}
                    <span className={`font-bold ${(scanResult.stock_total ?? 0) <= 0 ? 'text-error' : 'text-success'}`}>
                      {formatCantidad(scanResult.stock_total ?? 0, scanResult.unidad_base_nombre ?? '', scanResult.unidad_base_nombre_plural)}
                    </span>
                  </p>
                )}
              </div>

              <div className="bg-base-100 rounded-2xl p-6 space-y-4 border border-base-200">
                <div className="space-y-2">
                  <label className="text-sm font-bold opacity-40 uppercase tracking-wider">
                    Cantidad {scanResult.presentacion_nombre ? `(${scanResult.presentacion_nombre})` : `(${scanResult.unidad_base_nombre})`}
                  </label>
                  <input
                    ref={cantidadRef}
                    type="number"
                    min="1"
                    step="1"
                    className="input input-bordered w-full text-4xl font-black text-center h-20"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold opacity-40 uppercase tracking-wider">Notas (opcional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full h-12"
                    placeholder="Ej: Corrida matutina"
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  className="btn btn-ghost flex-1 h-16 text-lg"
                  onClick={() => { setScanResult(null); setCantidad('1') }}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-primary flex-1 h-16 text-lg font-bold"
                  onClick={() => consumoMut.mutate()}
                  disabled={!cantidad || parseFloat(cantidad) <= 0 || consumoMut.isPending}
                >
                  {consumoMut.isPending
                    ? <span className="loading loading-spinner" />
                    : '✓ Confirmar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {inactiveOverlay && <InactivityOverlay onDismiss={resetInactivity} />}
        {showExit && (
          <ExitModeModal
            onConfirm={() => { logout(); navigate('/login', { replace: true }) }}
            onCancel={() => setShowExit(false)}
          />
        )}
      </div>
    )
  }

  // ─── Imprimir Mode ───
  if (mode === 'imprimir') {
    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        <KioskHeader title="Imprimir QR" area={selectedArea.nombre} onBack={() => { setMode('home'); setQrData(null); setScanResult(null) }} onExit={() => { resetInactivity(); setShowExit(true) }} />

        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 max-w-lg mx-auto w-full">
          {!qrData ? (
            <div className="text-center space-y-4">
              <div className="text-8xl">🔍</div>
              <p className="text-2xl font-bold opacity-60">Escanee el producto</p>
              <p className="text-sm opacity-30">Se generará su código QR</p>
              <div className="divider text-xs opacity-30">o ingrese manualmente</div>
              <ManualInput onSubmit={handleScan} />
            </div>
          ) : (
            <div className="space-y-4 w-full text-center">
              <div className="bg-base-100 rounded-2xl p-6 border border-base-200">
                <p className="font-black text-xl mb-4">{scanResult?.producto_nombre}</p>
                <div className="flex justify-center">
                  <QrCanvas data={qrData} />
                </div>
                <p className="text-xs font-mono opacity-30 mt-2">{scanResult?.producto_id?.slice(0, 12)}…</p>
              </div>
              <div className="flex gap-3">
                <button className="btn btn-ghost flex-1 h-14" onClick={() => { setQrData(null); setScanResult(null) }}>
                  Otro producto
                </button>
                <button className="btn btn-primary flex-1 h-14 font-bold" onClick={() => window.print()}>
                  🖨️ Imprimir
                </button>
              </div>
            </div>
          )}
        </div>

        {inactiveOverlay && <InactivityOverlay onDismiss={resetInactivity} />}
        {showExit && (
          <ExitModeModal
            onConfirm={() => { logout(); navigate('/login', { replace: true }) }}
            onCancel={() => setShowExit(false)}
          />
        )}
      </div>
    )
  }

  // ─── Recibir Mode ───
  if (mode === 'recibir') {
    return (
      <div className="min-h-screen bg-base-200 flex flex-col">
        <KioskHeader title="Recibir Insumos" area={selectedArea.nombre} onBack={() => setMode('home')} onExit={() => { resetInactivity(); setShowExit(true) }} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center opacity-40">
            <div className="text-6xl mb-4">🚧</div>
            <p className="text-lg font-medium">Para recepciones use la app completa</p>
            <p className="text-sm mt-1">El modo kiosko está optimizado para consumos rápidos</p>
            <button className="btn btn-ghost mt-4" onClick={() => setMode('home')}>Volver</button>
          </div>
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

// ─── Sub-components ─────────────────────────────────────────────────────────

function ActionCard({
  emoji, label, description, color, onClick
}: {
  emoji: string; label: string; description: string; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`btn ${color} btn-lg h-36 flex-col gap-2 text-left p-5 normal-case shadow-md hover:shadow-lg transition-shadow`}
    >
      <span className="text-4xl">{emoji}</span>
      <div>
        <p className="text-base font-bold leading-tight">{label}</p>
        <p className="text-xs opacity-70 font-normal mt-0.5 leading-tight">{description}</p>
      </div>
    </button>
  )
}

function KioskHeader({
  title, area, onBack, onExit
}: {
  title: string; area: string; onBack: () => void; onExit?: () => void
}) {
  return (
    <div className="bg-base-100 border-b border-base-200 px-6 py-3 flex items-center gap-4">
      <button onClick={onBack} className="btn btn-ghost btn-circle btn-sm">
        ←
      </button>
      <div className="flex-1">
        <p className="font-bold text-base">{title}</p>
        <p className="text-xs opacity-40">{area}</p>
      </div>
      {onExit && (
        <button
          onClick={onExit}
          className="btn btn-ghost btn-sm text-error font-bold"
        >
          Salir
        </button>
      )}
    </div>
  )
}

function ManualInput({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div className="flex gap-2">
      <input
        type="text"
        className="input input-bordered flex-1"
        placeholder="Código de barras..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onSubmit(value.trim())
            setValue('')
          }
        }}
      />
      <button
        className="btn btn-primary"
        onClick={() => { if (value.trim()) { onSubmit(value.trim()); setValue('') } }}
      >
        Buscar
      </button>
    </div>
  )
}

function InactivityOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-base-300/90 backdrop-blur-sm flex items-center justify-center cursor-pointer"
      onClick={onDismiss}
    >
      <div className="text-center">
        <p className="text-4xl font-black opacity-60">Toque para continuar</p>
        <p className="text-sm opacity-30 mt-2">Terminal en espera por inactividad</p>
      </div>
    </div>
  )
}

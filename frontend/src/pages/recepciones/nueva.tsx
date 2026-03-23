import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Plus, Trash2, Save, CheckCircle, ArrowLeft, ArrowRight,
  Camera, Keyboard, ScanLine, X, Search, Minus,
  ChevronDown, ChevronRight, Package, Copy, Tag, CalendarDays, MapPin, Printer,
} from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'
import api from '@/lib/api'
import type { Proveedor, Producto, Presentacion, Area } from '@/types'
import { formatCantidad, autoPlural } from '@/lib/utils'

// Payload que coincide exactamente con el struct Rust del backend
interface RecepcionPayload {
  proveedor_id: number
  guia_despacho?: string
  fecha_recepcion: string   // ISO 8601 DateTime
  nota?: string
  estado?: string
  detalle: {
    producto_id: string       // UUID
    numero_lote: string
    fecha_vencimiento: string // YYYY-MM-DD
    presentacion_id?: number | null  // null = unidad base
    cantidad_presentaciones: number
    area_destino_id: number
  }[]
}
import { toast } from 'sonner'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import { useAreaStore } from '@/hooks/use-area-store'

interface DetalleLineUI {
  id: string
  producto_id: string   // UUID desde backend
  producto_nombre: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  cantidad_presentacion: number
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  codigo_lote: string
  fecha_vencimiento: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
}


const now = new Date()
const TODAY = now.toISOString().split('T')[0]
const CURRENT_TIME = now.toTimeString().slice(0, 5)


export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { selectedAreaId } = useAreaStore()

  const scanInputRef = useRef<HTMLInputElement>(null)
  const searchWrapperRef = useRef<HTMLDivElement>(null)
  const scannerInstanceRef = useRef<Html5Qrcode | null>(null)
  const lotInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // ── Wizard step ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(1)

  // ── Paso 1 ───────────────────────────────────────────────────────────────
  const [guiaDespacho, setGuiaFactura] = useState('')
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [fechaRecepcion, setFechaRecepcion] = useState(TODAY)
  const [horaRecepcion, setHoraRecepcion] = useState(CURRENT_TIME)
  const [areaGlobalId, setAreaGlobalId] = useState<number | null>(selectedAreaId)

  // ── Paso 2 ───────────────────────────────────────────────────────────────
  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])
  const [lastAddedId, setLastAddedId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // ── Scanner zone ─────────────────────────────────────────────────────────
  const [scanMode, setScanMode] = useState<'camera' | 'manual'>('manual')
  const [cameraError, setCameraError] = useState('')
  const [scanCode, setScanCode] = useState('')
  const [scanNotFound, setScanNotFound] = useState(false)
  const [suggestions, setSuggestions] = useState<Producto[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })
  const { data: productos } = useQuery({
    queryKey: ['productos-all'],
    queryFn: () =>
      api.get<{ data: Producto[] }>('/productos', { params: { per_page: 500 } }).then((r) => r.data.data),
  })
  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  // ── Sync área global → nuevas líneas cuando cambia en paso 1 ─────────────
  useEffect(() => {
    if (areaGlobalId === null) return
    const area = areas?.find((a) => a.id === areaGlobalId)
    const nombre = area?.nombre ?? ''
    setDetalles((prev) =>
      prev.map((d) =>
        d.area_destino_id === null ? { ...d, area_destino_id: areaGlobalId, area_destino_nombre: nombre } : d,
      ),
    )
  }, [areaGlobalId, areas])

  // ── Camera lifecycle ─────────────────────────────────────────────────────
  const stopCamera = useCallback(async () => {
    if (scannerInstanceRef.current) {
      try { await scannerInstanceRef.current.stop(); scannerInstanceRef.current.clear() } catch { /* ok */ }
      scannerInstanceRef.current = null
    }
  }, [])

  // defined after addProductoDirecto so it can call it — use ref trick
  const addProductoRef = useRef<(code: string) => void>(() => {})

  const startCamera = useCallback(async () => {
    setCameraError('')
    try {
      const scanner = new Html5Qrcode('scanner-reader')
      scannerInstanceRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => addProductoRef.current(decoded),
        () => {},
      )
    } catch {
      setCameraError('No se pudo acceder a la cámara. Usa el modo manual.')
      setScanMode('manual')
    }
  }, [])

  useEffect(() => {
    if (step !== 2) { stopCamera(); return }
    if (scanMode === 'camera') startCamera()
    else stopCamera()
    return () => { stopCamera() }
  }, [scanMode, step, startCamera, stopCamera])

  // Auto-focus lote del ítem recién agregado
  useEffect(() => {
    if (!lastAddedId) return
    const t = setTimeout(() => {
      lotInputRefs.current.get(lastAddedId)?.focus()
    }, 60)
    return () => clearTimeout(t)
  }, [lastAddedId])

  // Cerrar autocomplete fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node))
        setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Mutations ────────────────────────────────────────────────────────────
  const uploadFoto = async (recepcionId: string) => {
    if (!fotoPreview) return
    try {
      await api.put(`/recepciones/${recepcionId}/foto`, { data_url: fotoPreview })
    } catch {
      toast.warning('Recepción guardada, pero no se pudo adjuntar la foto')
    }
  }

  const confirmarMutation = useMutation({
    mutationFn: (data: RecepcionPayload) =>
      api.post('/recepciones', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      await uploadFoto(response.data.id)
      toast.success('Recepción confirmada')
      navigate('/recepciones')
    },
    onError: (err: any) => {
      const d = err?.response?.data
      const msg = d?.error?.message ?? d?.message ?? err?.message ?? 'Error al crear recepción'
      toast.error(String(msg))
    },
  })

  const borradorMutation = useMutation({
    mutationFn: (data: RecepcionPayload) =>
      api.post('/recepciones', { ...data, estado: 'borrador' }),
    onSuccess: async (response) => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      await uploadFoto(response.data.id)
      toast.success('Borrador guardado')
      navigate('/recepciones')
    },
    onError: (err: any) => {
      const d = err?.response?.data
      const msg = d?.error?.message ?? d?.message ?? err?.message ?? 'Error al guardar borrador'
      toast.error(String(msg))
    },
  })

  // ── Paso 1 helpers ───────────────────────────────────────────────────────
  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setFotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ── Agregar producto a la lista — fetcha detalles completos (presentaciones + unidad) ─
  const addProductoDirecto = useCallback(async (prod: Producto) => {
    try {
      const defaultArea = areas?.find((a) => a.id === areaGlobalId)
      const defaultAreaNombre = defaultArea?.nombre ?? ''

      // Fetch full product to get presentaciones and unidad_base.nombre_plural
      let fullProd: any = prod
      try {
        const res = await api.get(`/productos/${prod.id}`)
        fullProd = res.data
      } catch { /* fallback to list data */ }

      const presentaciones: Presentacion[] = Array.isArray(fullProd.presentaciones)
        ? fullProd.presentaciones
        : []
      const pres = presentaciones[0] ?? null
      const unidad_base_nombre: string = fullProd.unidad_base?.nombre ?? (fullProd as any).unidad_base_nombre ?? ''
      const unidad_base_nombre_plural: string = fullProd.unidad_base?.nombre_plural ?? unidad_base_nombre

      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        presentacion_id: pres?.id ?? null,
        presentacion_nombre: pres?.nombre ?? '',
        presentacion_nombre_plural: pres?.nombre_plural ?? (pres ? autoPlural(pres.nombre) : ''),
        cantidad_presentacion: 1,
        // serde-with-str serializes Decimal as string — convert to number
        factor_conversion: Number(pres?.factor_conversion ?? 1),
        unidad_base_nombre,
        unidad_base_nombre_plural,
        codigo_lote: '',
        fecha_vencimiento: '',
        area_destino_id: areaGlobalId,
        area_destino_nombre: defaultAreaNombre,
        presentaciones,
      }

      setDetalles((prev) => [line, ...prev])
      setLastAddedId(line.id)
      setScanCode('')
      setScanNotFound(false)
      setSuggestions([])
      setShowSuggestions(false)
      toast.success(`${prod.nombre} agregado`)
      setTimeout(() => scanInputRef.current?.focus(), 300)
    } catch (err) {
      console.error('Error al agregar producto:', err)
      toast.error('No se pudo agregar el producto. Intente nuevamente.')
    }
  }, [areas, areaGlobalId])

  // Mantener la referencia actualizada para el callback de cámara
  useEffect(() => {
    addProductoRef.current = (code: string) => {
      if (!productos) return
      const found = productos.find((p) => p.codigo === code) ??
        productos.find((p) => p.nombre.toLowerCase() === code.toLowerCase())
      if (found) addProductoDirecto(found)
      else { setScanNotFound(true); setScanCode(code) }
    }
  }, [productos, addProductoDirecto])

  // ── Búsqueda manual ──────────────────────────────────────────────────────
  const handleScanInputChange = (value: string) => {
    setScanCode(value)
    setScanNotFound(false)
    if (!value.trim() || !productos) { setSuggestions([]); setShowSuggestions(false); return }
    const q = value.toLowerCase()
    const results = productos
      .filter((p) => p.activo && (p.nombre.toLowerCase().includes(q) || (p.codigo && p.codigo.toLowerCase().includes(q))))
      .slice(0, 8)
    setSuggestions(results)
    setShowSuggestions(results.length > 0)
  }

  const buscarPorCodigo = () => {
    const code = scanCode.trim()
    if (!code || !productos) return
    setShowSuggestions(false)
    const found = productos.find((p) => p.codigo === code) ??
      productos.find((p) => p.nombre.toLowerCase() === code.toLowerCase())
    if (found) addProductoDirecto(found)
    else setScanNotFound(true)
  }

  // ── Editar línea ─────────────────────────────────────────────────────────
  const updateLine = (id: string, updates: Partial<DetalleLineUI>) => {
    setDetalles((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        const updated = { ...d, ...updates }
        if (updates.presentacion_id !== undefined) {
          const pres = (updated.presentaciones ?? []).find((p) => p.id === updates.presentacion_id)
          updated.factor_conversion = Number(pres?.factor_conversion ?? 1)
          updated.presentacion_nombre = pres?.nombre ?? ''
          updated.presentacion_nombre_plural = pres?.nombre_plural ?? (pres ? autoPlural(pres.nombre) : '')
        }
        if (updates.area_destino_id !== undefined) {
          const area = areas?.find((a) => a.id === updates.area_destino_id)
          updated.area_destino_nombre = area?.nombre ?? ''
        }
        return updated
      }),
    )
  }

  // ── Separar lote ─────────────────────────────────────────────────────────
  const handleSplit = useCallback((id: string) => {
    setDetalles((prev) => {
      const item = prev.find((d) => d.id === id)
      if (!item || item.cantidad_presentacion <= 1) return prev
      const newItem: DetalleLineUI = { ...item, id: uuidv4(), cantidad_presentacion: 1, codigo_lote: '', fecha_vencimiento: '' }
      const updated = prev.map((d) => d.id === id ? { ...d, cantidad_presentacion: d.cantidad_presentacion - 1 } : d)
      updated.splice(updated.findIndex((d) => d.id === id) + 1, 0, newItem)
      toast.success(`1 unidad separada — asigna el lote en la nueva fila`)
      setLastAddedId(newItem.id)
      return updated
    })
  }, [])

  // ── Agregar otro lote al mismo producto ──────────────────────────────────
  const addLoteAGrupo = useCallback((group: { producto_id: string; producto_nombre: string; items: DetalleLineUI[] }) => {
    const ref = group.items[0]
    const newLine: DetalleLineUI = {
      ...ref,
      id: uuidv4(),
      codigo_lote: '',
      fecha_vencimiento: '',
    }
    setDetalles((prev) => [...prev, newLine])
    setLastAddedId(newLine.id)
    setCollapsedGroups((prev) => { const s = new Set(prev); s.delete(group.producto_id); return s })
  }, [])

  // ── Grupos ────────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, { producto_id: string; producto_nombre: string; items: DetalleLineUI[] }>()
    const order: string[] = []
    for (const d of detalles) {
      if (!map.has(d.producto_id)) {
        map.set(d.producto_id, { producto_id: d.producto_id, producto_nombre: d.producto_nombre, items: [] })
        order.push(d.producto_id)
      }
      map.get(d.producto_id)!.items.push(d)
    }
    return order.map((id) => map.get(id)!)
  }, [detalles])

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  // ── Helpers de unidades base ──────────────────────────────────────────────
  const lineBaseUnits = (d: DetalleLineUI) =>
    Math.round(d.cantidad_presentacion * d.factor_conversion)

  const groupBaseUnits = (items: DetalleLineUI[]) =>
    items.reduce((sum, d) => sum + lineBaseUnits(d), 0)

  // ── Totales ───────────────────────────────────────────────────────────────
  const totalDistintos = groups.length
  const totalItems = detalles.reduce((sum, d) => sum + d.cantidad_presentacion, 0)

  // ── Request builder ──────────────────────────────────────────────────────
  const buildRequest = (): RecepcionPayload | null => {
    if (!proveedorId) return null
    const valid = detalles.filter(
      (d) => d.cantidad_presentacion > 0 && d.codigo_lote && d.fecha_vencimiento && d.area_destino_id,
    )
    if (valid.length === 0) return null
    const fechaHoraISO = new Date(`${fechaRecepcion}T${horaRecepcion}:00`).toISOString()
    return {
      proveedor_id: proveedorId,
      guia_despacho: guiaDespacho || undefined,
      fecha_recepcion: fechaHoraISO,
      detalle: valid.map((d) => ({
        producto_id: String(d.producto_id),           // UUID como string
        numero_lote: d.codigo_lote,                   // renombrado
        fecha_vencimiento: d.fecha_vencimiento,
        presentacion_id: d.presentacion_id, // null se serializa como null → backend lo recibe como None
        cantidad_presentaciones: d.cantidad_presentacion, // renombrado
        area_destino_id: d.area_destino_id!,
      })),
    }
  }

  const handleConfirmar = () => {
    if (!proveedorId) { toast.error('Seleccione un proveedor en el Paso 1'); setStep(1); return }
    const req = buildRequest()
    if (!req) { toast.error('Agregue al menos una línea con lote, vencimiento y área completos'); return }
    confirmarMutation.mutate(req)
  }

  const handleBorrador = () => {
    if (!proveedorId) { toast.error('Seleccione un proveedor en el Paso 1'); setStep(1); return }
    const req = buildRequest()
    if (!req) { toast.error('Agregue al menos una línea para guardar'); return }
    borradorMutation.mutate(req)
  }

  const isBusy = confirmarMutation.isPending || borradorMutation.isPending

  // ── Generar PDF (print window) ────────────────────────────────────────────
  const handlePrintPDF = () => {
    const proveedorNombre = proveedores?.find((p) => p.id === proveedorId)?.nombre ?? '—'
    const rows = detalles.map((d, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${d.producto_nombre}</strong></td>
        <td>${d.presentacion_nombre || 'Unidad base'}</td>
        <td style="text-align:center">${d.cantidad_presentacion}</td>
        <td style="text-align:center;color:#1d4ed8;font-weight:600">
          ${Math.round(d.cantidad_presentacion * d.factor_conversion)} ${d.unidad_base_nombre}
        </td>
        <td>${d.codigo_lote || '<span style="color:#ef4444">—</span>'}</td>
        <td>${d.fecha_vencimiento || '<span style="color:#ef4444">—</span>'}</td>
        <td>${d.area_destino_nombre || '—'}</td>
      </tr>`)
      .join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Recepción de Insumos</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 24px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { display: flex; gap: 32px; margin-bottom: 16px; color: #555; font-size: 11px; }
        .meta span strong { color: #111; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; padding: 6px 8px; border: 1px solid #e5e7eb; text-align: left; }
        td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: middle; }
        tr:nth-child(even) td { background: #fafafa; }
        .totals { border-top: 2px solid #111; padding-top: 10px; display:flex; gap:32px; font-size:12px; }
        .totals .val { font-size:20px; font-weight:700; }
        .badge-missing { color:#ef4444; font-weight:600; }
        @media print { body { padding: 12px; } }
      </style>
    </head><body>
      <h1>Recepción de Insumos</h1>
      <div class="meta">
        <span><strong>Proveedor:</strong> ${proveedorNombre}</span>
        <span><strong>Fecha:</strong> ${fechaRecepcion} ${horaRecepcion}</span>
        ${guiaDespacho ? `<span><strong>Guía:</strong> ${guiaDespacho}</span>` : ''}
        <span><strong>Generado:</strong> ${new Date().toLocaleDateString('es-CL')}</span>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Producto</th><th>Presentación</th>
          <th style="text-align:center">Cant.</th>
          <th style="text-align:center">Unidades base</th>
          <th>Lote</th><th>Vencimiento</th><th>Área Destino</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div><div class="val">${totalDistintos}</div>productos distintos</div>
        <div><div class="val">${totalItems}</div>items totales</div>
      </div>
      <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>
    </body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button className="btn btn-ghost btn-square btn-sm" onClick={() => navigate('/recepciones')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-bold">Nueva Recepción</h1>
      </div>

      <ul className="steps steps-vertical lg:steps-horizontal w-full">
        <li className={`step ${step >= 1 ? 'step-primary' : ''} cursor-pointer`} onClick={() => setStep(1)}>
          Datos Generales
        </li>
        <li className={`step ${step >= 2 ? 'step-primary' : ''} cursor-pointer`} onClick={() => setStep(2)}>
          Líneas de Recepción
        </li>
      </ul>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* PASO 1                                                            */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {step === 1 && (
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body space-y-5">
            <h2 className="card-title text-base">Información del documento</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

              <fieldset className="fieldset">
                <legend className="fieldset-legend">Guía de Despacho</legend>
                <input type="text" className="input input-bordered w-full" placeholder="GD-2024-001"
                  value={guiaDespacho} onChange={(e) => setGuiaFactura(e.target.value)} />
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">
                  Foto de Guía de Despacho <span className="font-normal opacity-50">(opcional)</span>
                </legend>
                <div className="flex items-center gap-3">
                  <label className="btn btn-outline btn-sm cursor-pointer gap-2">
                    <Camera className="h-4 w-4" />
                    {fotoPreview ? 'Cambiar foto' : 'Adjuntar foto'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleFotoChange} />
                  </label>
                  {fotoPreview && (
                    <div className="relative">
                      <img src={fotoPreview} alt="Vista previa" className="h-12 w-12 rounded-lg border object-cover" />
                      <button type="button" className="btn btn-circle btn-error btn-xs absolute -right-2 -top-2" onClick={() => setFotoPreview(null)}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">Proveedor *</legend>
                <ProveedorSelect
                  value={proveedorId ?? ''} onChange={(v) => setProveedorId(v ? Number(v) : null)}
                  proveedores={(proveedores ?? []).filter((p) => p.activo)}
                  placeholder="Seleccionar proveedor..." size="md" className="w-full"
                />
              </fieldset>

              <fieldset className="fieldset">
                <legend className="fieldset-legend">Fecha y Hora *</legend>
                <div className="flex gap-2">
                  <input type="date" className="input input-bordered flex-1" value={fechaRecepcion} onChange={(e) => setFechaRecepcion(e.target.value)} />
                  <input type="time" className="input input-bordered w-32" value={horaRecepcion} onChange={(e) => setHoraRecepcion(e.target.value)} />
                </div>
              </fieldset>

              {/* Área destino por defecto – aplica a todas las líneas */}
              <fieldset className="fieldset md:col-span-2">
                <legend className="fieldset-legend">
                  Área Destino por Defecto
                  <span className="ml-1 font-normal opacity-50 text-xs">(se aplica a todos los reactivos · editable por línea en el paso 2)</span>
                </legend>
                <select
                  className="select select-bordered w-full max-w-sm"
                  value={areaGlobalId ?? ''}
                  onChange={(e) => setAreaGlobalId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sin área por defecto</option>
                  {areas?.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.es_bodega ? ' (bodega)' : ''}</option>)}
                </select>
              </fieldset>
            </div>

            <div className="flex justify-end pt-2">
              <button className="btn btn-primary gap-2" onClick={() => setStep(2)}>
                Siguiente <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* PASO 2                                                            */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {step === 2 && (
        <div className="space-y-3">

          {/* ── Zona de Escaneo (compacta) ──────────────────────────────── */}
          <div className="card bg-base-100 shadow-sm border border-base-300">
            <div className="card-body p-3 space-y-2">

              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <ScanLine className="h-4 w-4 text-primary" />
                  Zona de Escaneo
                </h2>
                <div className="join">
                  <button className={`btn btn-xs join-item gap-1 ${scanMode === 'camera' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setScanMode('camera')}>
                    <Camera className="h-3 w-3" /> Cámara
                  </button>
                  <button className={`btn btn-xs join-item gap-1 ${scanMode === 'manual' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => { setScanMode('manual'); setTimeout(() => scanInputRef.current?.focus(), 100) }}>
                    <Keyboard className="h-3 w-3" /> Manual
                  </button>
                </div>
              </div>

              {/* Modo cámara */}
              {scanMode === 'camera' && (
                <div className="overflow-hidden rounded-box bg-base-200">
                  <div id="scanner-reader" className="min-h-[200px]" />
                  {cameraError && <p className="p-2 text-center text-sm text-error">{cameraError}</p>}
                </div>
              )}

              {/* Modo manual */}
              {scanMode === 'manual' && (
                <div ref={searchWrapperRef} className="relative">
                  <form onSubmit={(e) => { e.preventDefault(); buscarPorCodigo() }} className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none" />
                      <input
                        ref={scanInputRef}
                        type="text"
                        className="input input-bordered w-full pl-9"
                        placeholder="Buscar por nombre o escanear código de barras…"
                        value={scanCode}
                        autoComplete="off"
                        onChange={(e) => handleScanInputChange(e.target.value)}
                        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setShowSuggestions(false); setScanCode('') } }}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary font-semibold">Agregar</button>
                  </form>

                  {showSuggestions && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-box border border-base-300 bg-base-100 shadow-xl ring-1 ring-base-content/10 overflow-hidden">
                      {suggestions.map((prod) => (
                        <button key={prod.id} type="button"
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-base-200 transition-colors"
                          onMouseDown={(e) => { e.preventDefault(); addProductoDirecto(prod) }}>
                          <Package className="h-4 w-4 shrink-0 opacity-40" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{prod.nombre}</p>
                            {prod.codigo && <p className="text-xs opacity-50">{prod.codigo}</p>}
                          </div>
                          {prod.presentaciones?.[0] && (
                            <span className="text-xs opacity-40 shrink-0">{prod.presentaciones[0].nombre}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {scanNotFound && (
                <div role="alert" className="alert alert-warning py-2 text-sm">
                  No se encontró <strong className="mx-1">"{scanCode}"</strong>. Verifique o regístrelo en el catálogo.
                </div>
              )}
            </div>
          </div>

          {/* ── Contador ────────────────────────────────────────────────── */}
          {detalles.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="stats stats-horizontal shadow-sm border border-base-300 bg-base-100 flex-1">
                <div className="stat py-2 px-4">
                  <div className="stat-title text-xs">Productos distintos</div>
                  <div className="stat-value text-2xl text-primary">{totalDistintos}</div>
                </div>
                <div className="stat py-2 px-4">
                  <div className="stat-title text-xs">Items totales</div>
                  <div className="stat-value text-2xl text-success">{totalItems}</div>
                </div>
              </div>
              <button className="btn btn-outline gap-2 self-stretch" onClick={handlePrintPDF} title="Generar PDF">
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">PDF</span>
              </button>
            </div>
          )}

          {/* ── Lista acumulada ─────────────────────────────────────────── */}
          {groups.length > 0 ? (
            <div className="space-y-3">
              {groups.map((group, groupIdx) => {
                const isCollapsed = collapsedGroups.has(group.producto_id)
                const multiLot = group.items.length > 1
                const totalBase = groupBaseUnits(group.items)
                // tomamos la unidad del primer item del grupo
                const firstItem = group.items[0]
                const ubNombre = firstItem.unidad_base_nombre
                const ubPlural = firstItem.unidad_base_nombre_plural || ubNombre

                return (
                  <div key={group.producto_id} className="rounded-xl border border-base-300 bg-base-100 shadow-sm overflow-hidden">

                    {/* ── Cabecera del producto ────────────────────────── */}
                    <div
                      className="flex items-start gap-3 px-4 py-3 bg-base-200/50 border-b border-base-300 cursor-pointer hover:bg-base-200 transition-colors"
                      onClick={() => toggleGroup(group.producto_id)}
                    >
                      {/* Número + ícono */}
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ${isCollapsed && !multiLot ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'}`}>
                          {groupIdx + 1}
                        </span>
                        {isCollapsed
                          ? multiLot
                            ? <ChevronRight className="h-4 w-4 opacity-40" />
                            : <CheckCircle className="h-4 w-4 text-success" />
                          : <ChevronDown className="h-4 w-4 opacity-40" />
                        }
                      </div>

                      {/* Nombre + subtítulo */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold leading-snug truncate">{group.producto_nombre}</p>
                        <p className="mt-0.5 text-xs text-base-content/60">
                          {isCollapsed ? (
                            !multiLot ? (
                              <>
                                <span className="text-success font-semibold">Recibido · </span>
                                <span className="font-semibold text-base-content/80">
                                  {firstItem.presentacion_id
                                    ? formatCantidad(firstItem.cantidad_presentacion, firstItem.presentacion_nombre, firstItem.presentacion_nombre_plural)
                                    : formatCantidad(totalBase, ubNombre, ubPlural)
                                  }
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="font-semibold text-base-content/80">
                                  {formatCantidad(totalBase, ubNombre, ubPlural)}
                                </span>
                                <span className="ml-2 opacity-60">· {group.items.length} lotes</span>
                              </>
                            )
                          ) : (
                            multiLot
                              ? <span className="opacity-60">{group.items.length} lotes</span>
                              : null
                          )}
                        </p>
                      </div>

                      {/* Botón Agregar lote cuando está colapsado */}
                      {isCollapsed && (
                        <button
                          className="btn btn-ghost btn-xs gap-1 shrink-0 text-primary"
                          onClick={(e) => { e.stopPropagation(); addLoteAGrupo(group) }}
                          title="Agregar otro lote de este producto"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline text-xs">Agregar lote</span>
                        </button>
                      )}
                    </div>

                    {/* ── Líneas de lote ───────────────────────────────── */}
                    {(!isCollapsed) && (
                      <div className="divide-y divide-base-200">
                        {group.items.map((d, lotIdx) => {
                          const baseUnits = lineBaseUnits(d)
                          return (
                            <div key={d.id}
                              className={`px-4 py-3 transition-colors ${d.id === lastAddedId ? 'scan-flash' : ''}`}>

                              {/* Fila A: formato · cantidad · → unidades base · delete */}
                              <div className="flex items-center gap-3 flex-wrap">

                                {/* Etiqueta de lote si hay múltiples */}
                                {multiLot && (
                                  <span className="text-xs font-semibold text-base-content/40 w-10 shrink-0 tabular-nums">
                                    L{lotIdx + 1}
                                  </span>
                                )}

                                {/* Selector de presentación */}
                                {(d.presentaciones?.length ?? 0) > 0 && (
                                  <select
                                    className="select select-sm select-bordered flex-1 min-w-[150px] max-w-[210px]"
                                    value={d.presentacion_id ?? ''}
                                    onChange={(e) => updateLine(d.id, { presentacion_id: e.target.value ? Number(e.target.value) : null })}
                                  >
                                    <option value="">
                                      {ubNombre ? `Unidad base (${ubNombre})` : 'Unidad base'}
                                    </option>
                                    {(d.presentaciones ?? []).map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.nombre} · {Math.round(Number(p.factor_conversion))} {ubPlural}
                                      </option>
                                    ))}
                                  </select>
                                )}

                                {/* Cantidad +/- con unidad dentro del input */}
                                <div className="flex items-center gap-1 shrink-0">
                                  <button className="btn btn-outline btn-sm btn-square"
                                    disabled={d.cantidad_presentacion <= 1}
                                    onClick={() => updateLine(d.id, { cantidad_presentacion: Math.max(1, d.cantidad_presentacion - 1) })}>
                                    <Minus className="h-3.5 w-3.5" />
                                  </button>
                                  <label className="input input-sm input-bordered flex items-center gap-0 px-2 cursor-text min-w-0">
                                    <input
                                      type="number"
                                      min={1}
                                      className="w-10 text-center font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none bg-transparent outline-none min-w-0"
                                      value={d.cantidad_presentacion}
                                      onChange={(e) => {
                                        const v = parseInt(e.target.value, 10)
                                        if (!isNaN(v) && v >= 1) updateLine(d.id, { cantidad_presentacion: v })
                                      }}
                                    />
                                    <span className="text-xs text-base-content/40 shrink-0 whitespace-nowrap border-l border-base-300 pl-1.5 ml-1">
                                      {d.presentacion_id
                                        ? (d.cantidad_presentacion === 1 ? d.presentacion_nombre : (d.presentacion_nombre_plural || autoPlural(d.presentacion_nombre)))
                                        : (d.cantidad_presentacion === 1 ? d.unidad_base_nombre : (d.unidad_base_nombre_plural || autoPlural(d.unidad_base_nombre)))
                                      }
                                    </span>
                                  </label>
                                  <button className="btn btn-outline btn-sm btn-square"
                                    onClick={() => updateLine(d.id, { cantidad_presentacion: d.cantidad_presentacion + 1 })}>
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                </div>

                                {/* Flecha → total unidades base (solo cuando hay presentación activa) */}
                                {d.presentacion_id && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-base-content/30 text-sm">→</span>
                                    <span className="text-sm font-semibold text-primary whitespace-nowrap">
                                      {formatCantidad(baseUnits, ubNombre, ubPlural)}
                                    </span>
                                  </div>
                                )}

                                <button className="btn btn-ghost btn-sm btn-square text-error hover:bg-error/10 shrink-0 ml-auto"
                                  onClick={() => setDetalles((prev) => prev.filter((x) => x.id !== d.id))}>
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>

                              {/* Fila B: lote · vencimiento · área · separar */}
                              <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-base-200/70">

                                <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                                  <Tag className="h-3.5 w-3.5 shrink-0 text-base-content/30" />
                                  <input
                                    type="text"
                                    className={`input input-sm input-bordered flex-1 ${!d.codigo_lote ? 'input-warning' : ''}`}
                                    placeholder="N° lote…"
                                    value={d.codigo_lote}
                                    ref={(el) => { if (el) lotInputRefs.current.set(d.id, el); else lotInputRefs.current.delete(d.id) }}
                                    onChange={(e) => updateLine(d.id, { codigo_lote: e.target.value })}
                                  />
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-base-content/30" />
                                  <span className="text-xs text-base-content/40 shrink-0">Fecha venc.</span>
                                  <input
                                    type="date"
                                    className={`input input-sm input-bordered w-36 ${!d.fecha_vencimiento ? 'input-warning' : ''}`}
                                    value={d.fecha_vencimiento}
                                    onChange={(e) => updateLine(d.id, { fecha_vencimiento: e.target.value })}
                                  />
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5 shrink-0 text-base-content/30" />
                                  <select
                                    className={`select select-sm select-bordered max-w-[180px] ${!d.area_destino_id ? 'select-warning' : ''}`}
                                    value={d.area_destino_id ?? ''}
                                    onChange={(e) => updateLine(d.id, { area_destino_id: e.target.value ? Number(e.target.value) : null })}
                                  >
                                    <option value="">Área destino…</option>
                                    {areas?.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                  </select>
                                </div>

                                <div className="flex items-center gap-2 ml-auto">
                                  <button
                                    className="btn btn-ghost btn-sm gap-1.5 text-base-content/50 hover:text-base-content"
                                    disabled={d.cantidad_presentacion <= 1}
                                    title="Separa 1 unidad en una nueva línea para asignarle un lote diferente"
                                    onClick={() => handleSplit(d.id)}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Separar lote
                                  </button>
                                  {!multiLot && (
                                    <button
                                      className="btn btn-success btn-sm gap-1.5"
                                      onClick={() => toggleGroup(group.producto_id)}
                                      title="Marcar como recibido y colapsar"
                                    >
                                      <CheckCircle className="h-3.5 w-3.5" />
                                      Listo
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center opacity-30">
              <Package className="h-14 w-14" />
              <p className="text-base font-semibold">Sin productos agregados</p>
              <p className="text-sm">Busca un reactivo o escanea un código de barras para comenzar</p>
            </div>
          )}
        </div>
      )}

      {/* ── Acciones ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {step === 2 && (
            <button className="btn btn-ghost gap-2" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" /> Atrás
            </button>
          )}
        </div>
        {step === 2 && (
          <div className="flex gap-2">
            <button className="btn btn-outline gap-2" onClick={handleBorrador} disabled={isBusy}>
              {borradorMutation.isPending && <span className="loading loading-spinner loading-sm" />}
              <Save className="h-4 w-4" />
              {borradorMutation.isPending ? 'Guardando…' : 'Guardar Borrador'}
            </button>
            <button className="btn btn-primary gap-2" onClick={handleConfirmar} disabled={isBusy}>
              {confirmarMutation.isPending && <span className="loading loading-spinner loading-sm" />}
              <CheckCircle className="h-4 w-4" />
              {confirmarMutation.isPending ? 'Confirmando…' : 'Confirmar Recepción'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

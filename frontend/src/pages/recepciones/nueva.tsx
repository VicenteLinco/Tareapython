// frontend/src/pages/recepciones/nueva.tsx
import { useState, useCallback, useRef } from 'react'
import { useLocalStorageBoolean } from '@/hooks/useLocalStorage'
import { useDialogState } from '@/hooks/useDialogState'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { ArrowLeft, ShoppingCart, X, Package, CheckCircle2, Layers } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import { toast } from 'sonner'
import { ReceptionItemCard, type DetalleLineUI, type LoteLineUI } from './components/item-card'
import { isCardComplete, isLoteComplete } from './components/item-card-utils'
import { ProductoAutocomplete } from './components/producto-autocomplete'
import { LabelsSection } from './components/labels-section'
import { ScannerPanel } from './components/scanner-panel'
import { LoteBottomSheet } from './components/lote-bottom-sheet'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import type { Proveedor, Producto, Area, SolicitudResumen } from '@/types'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Decision = 'completa' | 'parcial' | 'rechazada'

interface PendingScan {
  productoId: string
  productoNombre: string
  codigoInterno: string
  presentacionId: number | null
  areaId: number | null
  areaNombre: string
}

interface LoteConfirmadoApi {
  lote_id: string
  codigo_interno: string
  numero_lote: string
  fecha_vencimiento: string
  producto_nombre: string
  presentacion_nombre: string | null
  area_nombre: string
  cantidad: number
}

interface ScannedPresentacionData {
  producto_id: string | number
  presentacion_id: number
  presentacion_nombre?: string | null
}

function buildScannedPresentacion(data: ScannedPresentacionData) {
  return {
    id: data.presentacion_id,
    producto_id: String(data.producto_id),
    nombre: data.presentacion_nombre ?? '',
    nombre_plural: data.presentacion_nombre ? `${data.presentacion_nombre}s` : '',
    factor_conversion: '1',
    codigo_barras: null,
    activa: true,
    version: 1,
    created_at: '',
  }
}


const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: 'Cadena de frío rota' },
  { id: 'embalaje', label: 'Embalaje dañado' },
  { id: 'documentos', label: 'Documentos incorrectos' },
  { id: 'cantidad', label: 'Cantidad no coincide' },
  { id: 'no_solicitado', label: 'Producto no solicitado' },
]

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()

  // Wizard
  const [pasoActual, setPasoActual] = useState<1 | 2 | 3>(1)
  const [modoExperto, setModoExpertoAndSave] = useLocalStorageBoolean('rec-modo-experto', true)

  // Estado cabecera
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [proveedorError, setProveedorError] = useState(false)
  const proveedorRef = useRef<HTMLDivElement>(null)
  const [guiaDespacho, setGuiaDespacho] = useState('')
  const [guiaProvisoria, setGuiaProvisoria] = useState(false)
  const [fechaRecepcion, setFechaRecepcion] = useState(() => new Date().toISOString().slice(0, 16))
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [solicitudNumero, setSolicitudNumero] = useState<string | null>(null)
  const solicitudModal = useDialogState()
  const [fechaExpanded, setFechaExpanded] = useState(false)

  // Estado ítems
  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])

  const handleSetProveedor = useCallback((id: number | null) => {
    if (id === proveedorId) return
    if (detalles.length > 0 || solicitudId) {
      if (!confirm('Cambiar el proveedor limpiará los ítems y la solicitud vinculada. ¿Continuar?')) return
      setDetalles([])
      setSolicitudId(null)
      setSolicitudNumero(null)
    }
    setProveedorId(id)
  }, [proveedorId, detalles.length, solicitudId])
  const [scannerPaused, setScannerPaused] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null)

  // Estado decisión
  const [decision, setDecision] = useState<Decision>('completa')
  const [motivosSeleccionados, setMotivosSeleccionados] = useState<string[]>([])
  const [motivoOtro, setMotivoOtro] = useState('')
  const [nota, setNota] = useState('')

  // Estado post-confirmación (para imprimir etiquetas)
  const [lotesConfirmados, setLotesConfirmados] = useState<LoteParaEtiqueta[] | null>(null)
  const printModal = useDialogState()

  // Reconciliación post-recepción
  interface SolicitudItemSimple { producto_id: string; producto_nombre: string; cantidad_base: number; unidad: string }
  const [solicitudItemsRef, setSolicitudItemsRef] = useState<SolicitudItemSimple[]>([])
  const reconciliacionModal = useDialogState()
  const [pendingConfirmarPayload, setPendingConfirmarPayload] = useState<Record<string, unknown> | null>(null)

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then(r => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data),
  })

  const { data: productos } = useQuery({
    queryKey: ['productos-recepcion', proveedorId],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', {
      params: {
        per_page: 500,
        ...(proveedorId ? { proveedor_id: proveedorId } : {}),
      },
    }).then(r => r.data.data),
  })

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ moneda_simbolo: string }>('/configuracion').then(r => r.data),
  })
  const monedaSimbolo = configuracion?.moneda_simbolo ?? '$'

  const validarProveedorEscaneado = useCallback((productoNombre: string, productoProveedorId: number | null | undefined) => {
    if (!proveedorId || productoProveedorId === proveedorId) return true
    if (productoProveedorId) {
      const nombreProv = proveedores?.find(p => p.id === productoProveedorId)?.nombre ?? 'otro proveedor'
      toast.error(`"${productoNombre}" pertenece a ${nombreProv}`)
    } else {
      toast.error(`"${productoNombre}" no tiene proveedor asignado`)
    }
    return false
  }, [proveedorId, proveedores])

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ['solicitudes-activas', proveedorId],
    queryFn: () => api.get<{ data: SolicitudResumen[] }>('/solicitudes-compra', {
      params: {
        per_page: 100,
        ...(proveedorId ? { proveedor_id: proveedorId } : {}),
      }
    }).then(r =>
      (r.data.data ?? []).filter(s => ['aprobada', 'enviada'].includes(s.estado))
    ),
  })

  // ─── Agregar ítem ──────────────────────────────────────────────────────────

  const addProducto = useCallback(async (prod: Producto, overridePresentacionId?: number, overrideQuantity?: number) => {
    if (proveedorId && prod.proveedor_id !== proveedorId) {
      if (prod.proveedor_id) {
        const nombreProv = proveedores?.find(p => p.id === prod.proveedor_id)?.nombre ?? 'otro proveedor'
        toast.error(`"${prod.nombre}" pertenece a ${nombreProv}`)
      } else {
        toast.error(`"${prod.nombre}" no tiene proveedor asignado`)
      }
      return
    }
    try {
      const res = await api.get(`/productos/${prod.id}`)
      const full = res.data
      const presentaciones = full.presentaciones || []
      const pres = (overridePresentacionId
        ? presentaciones.find((p: { id: number }) => p.id === overridePresentacionId)
        : null) ?? presentaciones[0] ?? null

      const catalogoArea = full.areas?.[0]
      const initialCantidad = overrideQuantity ?? 1
      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        codigo_interno: prod.codigo_interno ?? '',
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_solicitada: overrideQuantity ?? null,
        factor_conversion: Number(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        area_destino_id: catalogoArea?.id ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? '',
        presentaciones,
        precio_unitario: full.precio_unidad ? String(Math.round(full.precio_unidad * Number(pres?.factor_conversion || 1))) : '',
        imagen_url: full.imagen_url,
        lotes: [{
          id: uuidv4(),
          codigo_lote: '',
          fecha_vencimiento: '',
          cantidad_presentacion: initialCantidad,
          incluir_etiqueta: false,
          cantidad_etiquetas: initialCantidad,
        }],
        collapsed: false,
      }
      setDetalles(prev => [line, ...prev])
      toast.success(`${prod.nombre} añadido`)
    } catch {
      toast.error('Error al cargar producto')
    }
  }, [proveedorId, proveedores])

  // ─── Búsqueda / Scan ───────────────────────────────────────────────────────

  const handleSearch = useCallback(async (valor: string) => {
    const q = valor.trim()
    if (q.length < 2) return

    try {
      const res = await api.get('/productos/scan', { params: { codigo: q } })
      const data = res.data

      if (!data.encontrado) {
        // Fallback a búsqueda por nombre
        const found = productos?.find(p =>
          p.nombre.toLowerCase().includes(q.toLowerCase()) ||
          p.codigo_interno.toLowerCase() === q.toLowerCase()
        )
        if (found) { await addProducto(found); return }
        toast.error('Producto no encontrado')
        return
      }

      if (!validarProveedorEscaneado(data.producto_nombre, data.proveedor_id)) return

      if (data.tipo === 'lote') {
        const nuevoLote: LoteLineUI = {
          id: uuidv4(),
          codigo_lote: data.numero_lote,
          fecha_vencimiento: data.fecha_vencimiento || '',
          cantidad_presentacion: 1,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }

        // Si el producto ya tiene card, agregar lote ahí en vez de crear una nueva
        const existingDetalle = detalles.find(d => String(d.producto_id) === String(data.producto_id))
        if (existingDetalle) {
          setDetalles(prev => prev.map(d =>
            d.id === existingDetalle.id
              ? { ...d, collapsed: false, lotes: [...d.lotes, nuevoLote] }
              : d
          ))
          toast.success(`Lote ${data.numero_lote} añadido a ${data.producto_nombre}`)
          return
        }

        // Producto nuevo — crear card
        const pres = data.presentacion_id
          ? [buildScannedPresentacion(data)]
          : []

        const line: DetalleLineUI = {
          id: uuidv4(),
          producto_id: String(data.producto_id),
          producto_nombre: data.producto_nombre,
          codigo_interno: data.codigo_interno_lote || '',
          presentacion_id: data.presentacion_id || null,
          presentacion_nombre: data.presentacion_nombre || '',
          presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
          factor_conversion: 1,
          unidad_base_nombre: data.unidad_base_nombre || '',
          unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
          area_destino_id: data.area_id || null,
          area_destino_nombre: data.area_nombre || '',
          presentaciones: pres,
          precio_unitario: '',
          imagen_url: data.imagen_url || null,
          lotes: [nuevoLote],
          collapsed: false,
        }
        setDetalles(prev => [line, ...prev])
        toast.success(`Lote ${data.numero_lote} añadido`)
      } else if (data.tipo === 'presentacion') {
        // Producto escaneado por código de barras de presentación específica
        const prod = productos?.find(p => p.id === data.producto_id || String(p.id) === String(data.producto_id))
        if (prod) await addProducto(prod, data.presentacion_id)
      } else {
        // Producto por código interno o código de barras
        const prod = productos?.find(p => p.id === data.producto_id || String(p.id) === String(data.producto_id))
        if (prod) await addProducto(prod)
      }
    } catch {
      toast.error('Error en la búsqueda')
    }
  }, [detalles, productos, validarProveedorEscaneado, addProducto])

  // ─── Scanner inline ───────────────────────────────────────────────────────

  const handleScanDetected = useCallback(async (code: string) => {
    const q = code.trim()
    if (!q) return

    try {
      const res = await api.get('/productos/scan', { params: { codigo: q } })
      const data = res.data

      if (!data.encontrado) {
        navigator.vibrate?.([80, 40, 80])
        toast.error('Producto no encontrado')
        return
      }

      const productoId = String(data.producto_id)
      if (!validarProveedorEscaneado(data.producto_nombre, data.proveedor_id)) return

      // Producto ya en la lista → +1 en el lote más reciente
      const existingDetalle = detalles.find(d => d.producto_id === productoId)
      if (existingDetalle) {
        setDetalles(prev => prev.map(d => {
          if (d.producto_id !== productoId) return d
          const lotes = d.lotes.map((l, i) =>
            i === d.lotes.length - 1
              ? { ...l, cantidad_presentacion: l.cantidad_presentacion + 1, cantidad_etiquetas: l.cantidad_presentacion + 1 }
              : l
          )
          return { ...d, lotes }
        }))
        setScanCount(prev => prev + 1)
        navigator.vibrate?.(50)
        toast.success(`+1 ${existingDetalle.producto_nombre}`, { duration: 1500 })
        return
      }

      // Tipo lote: el código ya contiene información del lote, agregar directo
      if (data.tipo === 'lote' && data.numero_lote && data.fecha_vencimiento) {
        const nuevoLote: LoteLineUI = {
          id: uuidv4(),
          codigo_lote: data.numero_lote,
          fecha_vencimiento: data.fecha_vencimiento,
          cantidad_presentacion: 1,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }
        const pres = data.presentacion_id
          ? [buildScannedPresentacion(data)]
          : []
        const line: DetalleLineUI = {
          id: uuidv4(),
          producto_id: productoId,
          producto_nombre: data.producto_nombre,
          codigo_interno: data.codigo_interno_lote || '',
          presentacion_id: data.presentacion_id || null,
          presentacion_nombre: data.presentacion_nombre || '',
          presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
          cantidad_solicitada: null,
          factor_conversion: 1,
          unidad_base_nombre: data.unidad_base_nombre || '',
          unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
          area_destino_id: data.area_id || null,
          area_destino_nombre: data.area_nombre || '',
          presentaciones: pres,
          precio_unitario: '',
          imagen_url: data.imagen_url || null,
          lotes: [nuevoLote],
          collapsed: false,
        }
        setDetalles(prev => [line, ...prev])
        setScanCount(prev => prev + 1)
        navigator.vibrate?.(50)
        toast.success(`${data.producto_nombre} agregado`)
        return
      }

      // Producto nuevo sin datos de lote → mostrar bottom sheet
      setScannerPaused(true)
      setPendingScan({
        productoId,
        productoNombre: data.producto_nombre,
        codigoInterno: data.codigo_interno_lote || '',
        presentacionId: data.presentacion_id || null,
        areaId: data.area_id || null,
        areaNombre: data.area_nombre || '',
      })
    } catch {
      toast.error('Error al buscar producto')
    }
  }, [detalles, validarProveedorEscaneado])

  const handleConfirmLote = useCallback(async (loteData: { numero_lote: string; fecha_vencimiento: string; cantidad: number }) => {
    if (!pendingScan) return
    try {
      const res = await api.get(`/productos/${pendingScan.productoId}`)
      const full = res.data
      const presentaciones = full.presentaciones || []
      const pres = (pendingScan.presentacionId
        ? presentaciones.find((p: { id: number }) => p.id === pendingScan.presentacionId)
        : null) ?? presentaciones[0] ?? null

      const catalogoArea = full.areas?.[0]

      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: pendingScan.productoId,
        producto_nombre: pendingScan.productoNombre,
        codigo_interno: pendingScan.codigoInterno,
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_solicitada: null,
        factor_conversion: Number(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        area_destino_id: catalogoArea?.id ?? pendingScan.areaId ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? pendingScan.areaNombre ?? '',
        presentaciones,
        precio_unitario: full.precio_unidad
          ? String(Math.round(full.precio_unidad * Number(pres?.factor_conversion || 1)))
          : '',
        imagen_url: full.imagen_url,
        lotes: [{
          id: uuidv4(),
          codigo_lote: loteData.numero_lote,
          fecha_vencimiento: loteData.fecha_vencimiento,
          cantidad_presentacion: loteData.cantidad,
          incluir_etiqueta: false,
          cantidad_etiquetas: loteData.cantidad,
        }],
        collapsed: false,
      }
      setDetalles(prev => [line, ...prev])
      setScanCount(prev => prev + 1)
      navigator.vibrate?.(50)
    } catch {
      toast.error('Error al cargar producto')
    } finally {
      setPendingScan(null)
      setScannerPaused(false)
    }
  }, [pendingScan])

  const handleCancelLote = useCallback(() => {
    setPendingScan(null)
    setScannerPaused(false)
  }, [])

  // ─── Cambiar ítem ──────────────────────────────────────────────────────────

  const handleChange = useCallback((id: string, patch: Partial<Omit<DetalleLineUI, 'lotes'>>) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== id) return d
      const updated = { ...d, ...patch }
      const wasComplete = isCardComplete(d)
      const nowComplete = isCardComplete(updated)
      const collapsed =
        !wasComplete && nowComplete ? true :
        wasComplete && !nowComplete ? false :
        updated.collapsed
      return { ...updated, collapsed }
    }))
  }, [])

  const handleChangeLote = useCallback((detalleId: string, loteId: string, patch: Partial<LoteLineUI>) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== detalleId) return d
      const lotes = d.lotes.map(l => l.id === loteId ? { ...l, ...patch } : l)
      const wasComplete = isCardComplete(d)
      const nowComplete = !!d.area_destino_id && lotes.length > 0 && lotes.every(isLoteComplete)
      const collapsed =
        !wasComplete && nowComplete ? true :
        wasComplete && !nowComplete ? false :
        d.collapsed
      return { ...d, lotes, collapsed }
    }))
  }, [])

  const handleAddLote = useCallback((detalleId: string) => {
    setDetalles(prev => prev.map(d =>
      d.id !== detalleId ? d : {
        ...d,
        collapsed: false,
        lotes: [...d.lotes, {
          id: uuidv4(),
          codigo_lote: '',
          fecha_vencimiento: '',
          cantidad_presentacion: 1,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }],
      }
    ))
  }, [])

  const handleRemoveLote = useCallback((detalleId: string, loteId: string) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== detalleId) return d
      if (d.lotes.length <= 1) return d  // nunca eliminar el último lote
      const lotes = d.lotes.filter(l => l.id !== loteId)
      const wasComplete = isCardComplete(d)
      const nowComplete = !!d.area_destino_id && lotes.every(isLoteComplete)
      const collapsed = !wasComplete && nowComplete ? true : d.collapsed
      return { ...d, lotes, collapsed }
    }))
  }, [])

  const handleRemove = useCallback((id: string) => {
    setDetalles(prev => prev.filter(d => d.id !== id))
  }, [])

  // ─── Confirmar ─────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: (payload: object) => api.post('/recepciones', payload, {
      headers: { 'x-idempotency-key': uuidv4() }
    }),
    onSuccess: (res) => {
      const lotes: LoteConfirmadoApi[] = res.data.lotes ?? []
      // Filtrar solo los lotes que el usuario marcó para imprimir
      const paraImprimir: LoteParaEtiqueta[] = lotes
        .map<LoteParaEtiqueta | null>(l => {
          for (const d of detalles) {
            const lote = d.lotes.find(lo =>
              lo.codigo_lote === l.numero_lote && d.producto_nombre === l.producto_nombre
            )
            if (lote?.incluir_etiqueta) {
              return {
                lote_id: l.lote_id,
                codigo_interno: l.codigo_interno,
                numero_lote: l.numero_lote,
                fecha_vencimiento: l.fecha_vencimiento,
                producto_nombre: l.producto_nombre,
                presentacion_nombre: l.presentacion_nombre,
                area_nombre: l.area_nombre,
                cantidad_etiquetas: lote.cantidad_etiquetas,
              } satisfies LoteParaEtiqueta
            }
          }
          return null
        })
        .filter((x): x is LoteParaEtiqueta => x !== null)

      if (paraImprimir.length > 0) {
        setLotesConfirmados(paraImprimir)
        printModal.onOpen()
      } else {
        toast.success('Recepción confirmada')
        navigate('/recepciones')
      }
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data
      const msg = typeof data === 'string'
        ? data
        : typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>).error as string
            || (data as Record<string, unknown>).message as string
            || JSON.stringify(data)
          : 'Error al confirmar recepción'
      toast.error(String(msg))
    },
  })

  const handleConfirmar = () => {
    if (!proveedorId) { toast.error('Selecciona un proveedor'); return }
    if (!guiaDespacho.trim() && !guiaProvisoria) { toast.error('Ingresa el número de guía de despacho o marca como provisoria'); return }

    if (decision === 'rechazada') {
      if (motivosSeleccionados.length === 0 && !motivoOtro.trim()) {
        toast.error('Indica al menos un motivo de rechazo')
        return
      }
      const motivos = [
        ...motivosSeleccionados.map(id => MOTIVOS_RECHAZO.find(m => m.id === id)?.label ?? id),
        ...(motivoOtro.trim() ? [`Otro: ${motivoOtro.trim()}`] : []),
      ].join(' | ')

      const guiaFinal = guiaProvisoria ? `PROV-${Date.now()}` : guiaDespacho
      mutation.mutate({
        proveedor_id: proveedorId,
        guia_despacho: guiaFinal || undefined,
        fecha_recepcion: new Date(fechaRecepcion).toISOString(),
        estado: 'rechazada',
        motivo_rechazo: motivos,
        solicitud_id: solicitudId || undefined,
        detalle: [],
      })
      return
    }

    const validos = detalles.filter(d =>
      d.area_destino_id && d.lotes.some(l => l.codigo_lote && l.fecha_vencimiento)
    )
    if (validos.length === 0) { toast.error('Completa al menos un ítem con lote, vencimiento y área'); return }

    if (decision === 'parcial' && !nota.trim()) {
      toast.error('Indica en la nota qué faltó por recibir')
      return
    }

    const guiaFinal = guiaProvisoria ? `PROV-${Date.now()}` : guiaDespacho
    const payload = {
      proveedor_id: proveedorId,
      guia_despacho: guiaFinal || undefined,
      fecha_recepcion: new Date(fechaRecepcion).toISOString(),
      estado: decision,
      nota: nota || undefined,
      solicitud_id: solicitudId || undefined,
      detalle: validos.flatMap(d =>
        d.lotes
          .filter(l => l.codigo_lote && l.fecha_vencimiento)
          .map(l => ({
            producto_id: d.producto_id,
            numero_lote: l.codigo_lote,
            fecha_vencimiento: l.fecha_vencimiento,
            presentacion_id: d.presentacion_id,
            cantidad_presentaciones: l.cantidad_presentacion,
            area_destino_id: d.area_destino_id!,
            precio_unitario: d.precio_unitario ? parseFloat(d.precio_unitario) : undefined,
          }))
      ),
    } as const

    // Si hay solicitud vinculada, mostrar diff de reconciliación
    if (solicitudId && solicitudItemsRef.length > 0) {
      setPendingConfirmarPayload(payload as unknown as Record<string, unknown>)
      reconciliacionModal.onOpen()
      return
    }

    mutation.mutate({
      ...payload,
    })
  }

  // ─── Helpers UI ────────────────────────────────────────────────────────────

  const toggleMotivo = useCallback((id: string) =>
    setMotivosSeleccionados(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    ), [])

  const estadoBadge = {
    completa:  { label: 'Conforme', cls: 'badge-success' },
    parcial:   { label: 'Parcial', cls: 'badge-info' },
    rechazada: { label: 'Rechazada', cls: 'badge-error' },
  }[decision]

  const btnLabel = {
    completa:  'Confirmar recepción',
    parcial:   'Confirmar recepción parcial',
    rechazada: 'Registrar rechazo',
  }[decision]

  const itemsCompletos = detalles.filter(isCardComplete).length

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4">
      {/* Header + Wizard */}
      <div className="flex flex-col gap-4 mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold">Nueva Recepción</h1>
          </div>
          <button
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all',
              modoExperto ? 'bg-primary/10 text-primary border-primary/30' : 'border-base-300 opacity-60 hover:opacity-90'
            )}
            title="Modo experto: todos los paneles visibles a la vez, sin asistente paso a paso"
            onClick={() => setModoExpertoAndSave(!modoExperto)}
          >
            <Layers className="h-3.5 w-3.5" />
            {modoExperto ? 'Modo experto activo' : 'Modo experto'}
          </button>
        </div>

        {/* Steps */}
        {!modoExperto && (
          <div className="flex items-center gap-0 bg-base-100 rounded-2xl border border-base-200 p-3">
            {([
              { n: 1 as const, label: 'Proveedor', ok: !!proveedorId },
              { n: 2 as const, label: 'Ítems y lotes', ok: detalles.length > 0 && itemsCompletos === detalles.length },
              { n: 3 as const, label: 'Confirmar', ok: false },
            ]).map((step, idx) => (
              <div key={step.n} className="flex items-center flex-1 min-w-0">
                <button
                  className={cn(
                    'flex items-center gap-2 min-w-0 flex-1',
                    pasoActual === step.n ? 'opacity-100' : step.ok ? 'opacity-70' : 'opacity-30'
                  )}
                  onClick={() => {
                    if (step.n <= pasoActual || step.ok) setPasoActual(step.n)
                  }}
                >
                  <div className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all',
                    pasoActual === step.n ? 'bg-primary text-primary-content shadow-lg shadow-primary/30' :
                    step.ok ? 'bg-success text-success-content' : 'bg-base-200 text-base-content/40'
                  )}>
                    {step.ok && pasoActual !== step.n ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.n}
                  </div>
                  <span className={cn('text-xs font-bold hidden sm:block truncate', pasoActual === step.n ? 'text-primary' : 'text-base-content/50')}>
                    {step.label}
                  </span>
                </button>
                {idx < 2 && <div className="h-px flex-1 bg-base-200 mx-2 shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Layout B+C */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Panel izquierdo ── */}
        <div className={cn('w-full lg:w-72 lg:sticky lg:top-4 space-y-4', !modoExperto && pasoActual === 2 && 'hidden lg:hidden')}>

          {/* Datos guía */}
          <div className={cn('card bg-base-100 border p-4 space-y-3', !modoExperto && pasoActual === 3 && 'hidden')}>
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Guía de Despacho</h2>

            <div ref={proveedorRef}>
              <label className="label py-0.5">
                <span className={cn('label-text text-xs transition-colors', proveedorError && 'text-error font-semibold')}>
                  {proveedorError ? '⚠ Selecciona un proveedor primero' : 'Proveedor *'}
                </span>
              </label>
              <div className={proveedorError ? 'animate-shake ring-2 ring-error rounded-lg' : ''}>
                <ProveedorSelect
                  value={proveedorId || ''}
                  onChange={v => { handleSetProveedor(v ? Number(v) : null); setProveedorError(false) }}
                  proveedores={proveedores || []}
                  searchable
                />
              </div>
            </div>

            <div>
              <label className="label py-0.5">
                <span className="label-text text-xs">Nº Guía de Despacho *</span>
              </label>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={guiaProvisoria}
                  onChange={e => {
                    setGuiaProvisoria(e.target.checked)
                    if (e.target.checked) setGuiaDespacho('')
                  }}
                />
                <span className="text-xs opacity-60">Sin guía — usar número provisorio</span>
              </label>
              {!guiaProvisoria && (
                <input
                  className="input input-sm input-bordered w-full"
                  placeholder="GD-00000"
                  value={guiaDespacho}
                  onChange={e => setGuiaDespacho(e.target.value)}
                />
              )}
            </div>

            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs opacity-50 hover:opacity-70 transition-opacity mb-1 w-full text-left"
                onClick={() => setFechaExpanded(v => !v)}
              >
                <span>{new Date(fechaRecepcion).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="underline underline-offset-2 text-[10px]">{fechaExpanded ? 'Cerrar' : 'Cambiar'}</span>
              </button>
              {fechaExpanded && (
                <input
                  type="datetime-local"
                  className="input input-bordered input-sm w-full"
                  value={fechaRecepcion}
                  onChange={e => setFechaRecepcion(e.target.value)}
                />
              )}
            </div>

            {solicitudId ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-success font-medium flex items-center gap-1">
                  <ShoppingCart className="h-3 w-3" /> {solicitudNumero ?? 'Solicitud'} vinculada ✓
                </span>
                <button
                  className="btn btn-xs btn-ghost btn-circle text-error"
                  title="Desvincular solicitud"
                  onClick={() => { setSolicitudId(null); setSolicitudNumero(null) }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                className="btn btn-sm btn-ghost btn-outline w-full border-dashed"
                onClick={() => {
                  if (!proveedorId) {
                    setProveedorError(true)
                    setTimeout(() => setProveedorError(false), 1500)
                    proveedorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    return
                  }
                  solicitudModal.onOpen()
                }}
              >
                <ShoppingCart className="h-4 w-4 mr-1" />
                Vincular solicitud (opcional)
              </button>
            )}
          </div>

          {/* Estado */}
          <div className={cn('card bg-base-100 border p-4 space-y-2', !modoExperto && pasoActual !== 3 && 'hidden')}>
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Estado</h2>
            <span className={`badge ${estadoBadge.cls}`}>{estadoBadge.label}</span>
            {detalles.length > 0 && (
              <p className="text-xs opacity-50">
                {itemsCompletos}/{detalles.length} ítems completos
              </p>
            )}
          </div>

          {/* Decisión */}
          <div className={cn('card bg-base-100 border p-4 space-y-3', !modoExperto && pasoActual !== 3 && 'hidden')}>
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Decisión de recepción</h2>

            {(['completa', 'parcial', 'rechazada'] as Decision[]).map(dec => (
              <label key={dec} className={cn(
                'flex items-start gap-2 cursor-pointer rounded-lg p-2 border transition-colors',
                decision === dec
                  ? dec === 'completa' ? 'border-success bg-success/10'
                  : dec === 'parcial'  ? 'border-info bg-info/10'
                  : 'border-error bg-error/10'
                  : 'border-transparent hover:border-base-300'
              )}>
                <input
                  type="radio"
                  className="radio radio-sm mt-0.5"
                  checked={decision === dec}
                  onChange={() => setDecision(dec)}
                />
                <div>
                  <p className="text-sm font-medium">
                    {dec === 'completa' ? 'Conforme'
                      : dec === 'parcial' ? 'Recepción parcial'
                      : 'Rechazar guía'}
                  </p>
                  <p className="text-xs opacity-50">
                    {dec === 'completa' ? 'Todo llegó según lo esperado'
                      : dec === 'parcial' ? 'Solo parte del pedido recibido'
                      : 'No se recepciona ningún ítem'}
                  </p>
                </div>
              </label>
            ))}

            {/* Motivos de rechazo */}
            {decision === 'rechazada' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs opacity-50">Motivo(s):</p>
                {MOTIVOS_RECHAZO.map(m => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-error"
                      checked={motivosSeleccionados.includes(m.id)}
                      onChange={() => toggleMotivo(m.id)}
                    />
                    {m.label}
                  </label>
                ))}
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full text-xs"
                  placeholder="Otro motivo (opcional)…"
                  value={motivoOtro}
                  onChange={e => setMotivoOtro(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            {/* Nota para parcial */}
            {decision === 'parcial' && (
              <textarea
                className="textarea textarea-bordered textarea-sm w-full text-xs"
                placeholder="Describe qué faltó por recibir…"
                value={nota}
                onChange={e => setNota(e.target.value)}
                rows={2}
              />
            )}

            {!modoExperto && pasoActual === 3 && (
              <button className="btn btn-ghost btn-sm rounded-xl w-full mb-1" onClick={() => setPasoActual(2)}>
                ← Volver a ítems
              </button>
            )}
            <Button
              className="w-full"
              variant={decision === 'rechazada' ? 'destructive' : 'default'}
              onClick={handleConfirmar}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? <span className="loading loading-spinner loading-sm" />
                : btnLabel}
            </Button>
          </div>

          {/* Botón siguiente paso 1 */}
          {!modoExperto && pasoActual === 1 && (
            <button
              className="btn btn-primary w-full rounded-xl"
              disabled={!proveedorId}
              onClick={() => {
                if (!proveedorId) { setProveedorError(true); setTimeout(() => setProveedorError(false), 1500); return }
                setPasoActual(2)
              }}
            >
              Siguiente: Agregar ítems →
            </button>
          )}
        </div>

        {/* ── Panel derecho ── */}
        <div className={cn('flex-1 min-w-0 space-y-4', !modoExperto && pasoActual === 1 && 'hidden', !modoExperto && pasoActual === 3 && 'hidden')}>

          {/* Búsqueda / scan */}
          <ProductoAutocomplete
            productos={productos ?? []}
            excluidos={detalles.map(d => d.producto_id)}
            proveedorId={proveedorId}
            onSelect={prod => { addProducto(prod) }}
            onScan={handleSearch}
          />

          <ScannerPanel
            onScan={handleScanDetected}
            scanCount={scanCount}
            paused={scannerPaused}
          />

          {/* Lista de ítems */}
          {detalles.length === 0 ? (
            <div className="card bg-base-100 border border-dashed p-12 text-center">
              <Package className="mx-auto mb-3 size-10 text-base-content/30" />
              <p className="opacity-50 text-sm">Escanea o busca productos para agregar ítems a la recepción</p>
            </div>
          ) : (
            <div className="space-y-3">
              {detalles.map(d => (
                <ReceptionItemCard
                  key={d.id}
                  detalle={d}
                  areas={areas ?? []}
                  onChange={handleChange}
                  onChangeLote={handleChangeLote}
                  onAddLote={handleAddLote}
                  onRemoveLote={handleRemoveLote}
                  onRemove={handleRemove}
                  monedaSimbolo={monedaSimbolo}
                />
              ))}
            </div>
          )}

          {/* Botón siguiente paso 2 */}
          {!modoExperto && pasoActual === 2 && detalles.length > 0 && (
            <div className="flex items-center gap-3">
              <button className="btn btn-ghost btn-sm rounded-xl" onClick={() => setPasoActual(1)}>
                ← Volver
              </button>
              <button
                className="btn btn-primary flex-1 rounded-xl"
                disabled={itemsCompletos < detalles.length}
                title={itemsCompletos < detalles.length ? `${detalles.length - itemsCompletos} ítem(s) incompletos` : undefined}
                onClick={() => setPasoActual(3)}
              >
                {itemsCompletos < detalles.length
                  ? `${detalles.length - itemsCompletos} ítem(s) incompleto(s)`
                  : 'Siguiente: Confirmar →'}
              </button>
            </div>
          )}

          {/* Sección etiquetas */}
          {decision !== 'rechazada' && (
            <LabelsSection
              detalles={detalles}
              onToggleEtiqueta={(detalleId, loteId, val) => handleChangeLote(detalleId, loteId, { incluir_etiqueta: val })}
              onCantidadEtiqueta={(detalleId, loteId, val) => handleChangeLote(detalleId, loteId, { cantidad_etiquetas: val })}
            />
          )}
        </div>
      </div>

      {/* Bottom sheet datos de lote */}
      <LoteBottomSheet
        open={pendingScan !== null}
        productoNombre={pendingScan?.productoNombre ?? ''}
        onConfirm={handleConfirmLote}
        onCancel={handleCancelLote}
      />

      {/* Modal vincular solicitud */}
      <Dialog open={solicitudModal.open} onClose={solicitudModal.onClose} title="Vincular Solicitud">
        <div className="space-y-2">
          {solicitudesPendientes?.map(s => (
            <button
              key={s.id}
              className="w-full p-4 border rounded-xl hover:bg-base-200 text-left"
              onClick={async () => {
                try {
                  const res = await api.get(`/solicitudes-compra/${s.id}`)
                  setSolicitudId(s.id)
                  setSolicitudNumero(s.numero_documento)
                  solicitudModal.onClose()
                  toast.success('Solicitud vinculada')
                  setSolicitudItemsRef((res.data.items ?? []).map((it: { producto_id: string; producto_nombre: string; cantidad_sugerida: string; unidad: string }) => ({
                    producto_id: it.producto_id,
                    producto_nombre: it.producto_nombre,
                    cantidad_base: parseFloat(it.cantidad_sugerida) || 0,
                    unidad: it.unidad,
                  })))
                  for (const item of res.data.items) {
                    try {
                      const p = productos?.find(x => String(x.id) === String(item.producto_id))
                      if (p) {
                        // Preferir cantidad_presentaciones; si es null usar cantidad_sugerida (unidades base)
                        const qty = item.cantidad_presentaciones
                          ? Number(item.cantidad_presentaciones)
                          : item.cantidad_sugerida
                            ? Number(item.cantidad_sugerida)
                            : undefined
                        await addProducto(p, item.presentacion_id ?? undefined, qty)
                      }
                    } catch (e) {
                      toast.error('Error cargando producto: ' + (e instanceof Error ? e.message : String(e)))
                    }
                  }
                } catch (e) {
                  toast.error('Error al vincular solicitud: ' + (e instanceof Error ? e.message : String(e)))
                }
              }}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-sm">{s.numero_documento}</p>
                  <p className="text-xs opacity-50">{formatDate(s.fecha_creacion)}</p>
                </div>
                <Badge variant="outline">{s.items_count} ítems</Badge>
              </div>
            </button>
          ))}
          {solicitudesPendientes?.length === 0 && (
            <p className="text-center py-8 opacity-40 text-sm">No hay solicitudes aprobadas para este proveedor.</p>
          )}
        </div>
      </Dialog>

      {/* Modal reconciliación post-recepción */}
      {reconciliacionModal.open && pendingConfirmarPayload && (() => {
        // Calcular recibido por producto_id
        const recibidoMap: Record<string, number> = {}
        detalles.forEach(d => {
          const total = d.lotes.reduce((s, l) => s + (l.cantidad_presentacion * d.factor_conversion), 0)
          recibidoMap[d.producto_id] = (recibidoMap[d.producto_id] ?? 0) + total
        })
        const filas = solicitudItemsRef.map(si => {
          const recibido = recibidoMap[si.producto_id] ?? 0
          const diff = si.cantidad_base > 0 ? Math.abs(recibido - si.cantidad_base) / si.cantidad_base : 0
          return { ...si, recibido, diff, critico: diff > 0.10 }
        })
        const hayCriticos = filas.some(f => f.critico)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-base-100 rounded-3xl shadow-2xl w-full max-w-lg border border-base-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-base-200">
                <h2 className="font-bold text-base">Comparar con solicitud vinculada</h2>
                <p className="text-xs opacity-50 mt-0.5">Revisa las diferencias antes de confirmar la recepción.</p>
              </div>
              <div className="px-6 py-4 space-y-2 max-h-72 overflow-y-auto">
                {filas.map(f => (
                  <div key={f.producto_id} className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-xl border',
                    f.critico ? 'bg-warning/5 border-warning/30' : 'bg-base-200/30 border-transparent'
                  )}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{f.producto_nombre}</p>
                      <p className="text-[10px] opacity-40">{f.unidad}</p>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <span className="opacity-50">Pedido: {Math.round(f.cantidad_base)}</span>
                      <span className="mx-1.5 opacity-30">·</span>
                      <span className="font-bold">Llegó: {Math.round(f.recibido)}</span>
                    </div>
                    {f.critico && (
                      <span className="text-[9px] font-black text-warning bg-warning/15 px-1.5 py-0.5 rounded-full shrink-0">
                        {Math.round(f.diff * 100)}% dif.
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {hayCriticos && (
                <div className="px-6 pb-2">
                  <p className="text-xs font-bold text-warning mb-1">Discrepancia &gt;10% — explica el motivo:</p>
                  <textarea
                    className="textarea textarea-bordered textarea-sm w-full text-xs rounded-xl"
                    placeholder="Ej: Proveedor entregó menos unidades por quiebre de stock…"
                    rows={2}
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                  />
                </div>
              )}
              <div className="px-6 py-4 border-t border-base-200 flex gap-2">
                <button className="btn btn-ghost btn-sm flex-1 rounded-xl" onClick={() => { reconciliacionModal.onClose(); setPendingConfirmarPayload(null) }}>
                  Cancelar
                </button>
                <button
                  className="btn btn-primary btn-sm flex-1 rounded-xl"
                  disabled={hayCriticos && !nota.trim()}
                  onClick={() => {
                    reconciliacionModal.onClose()
                    mutation.mutate({ ...pendingConfirmarPayload, nota: nota || undefined })
                    setPendingConfirmarPayload(null)
                  }}
                >
                  Confirmar recepción
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal imprimir etiquetas post-confirmación */}
      <Dialog
        open={printModal.open}
        onClose={() => { printModal.onClose(); navigate('/recepciones') }}
        title="¿Imprimir etiquetas?"
      >
        {lotesConfirmados && (
          <LabelsSection lotesConfirmados={lotesConfirmados} />
        )}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { printModal.onClose(); navigate('/recepciones') }}
          >
            Saltar
          </Button>
          <Button
            className="flex-1"
            onClick={async () => {
              if (lotesConfirmados) await imprimirEtiquetas(lotesConfirmados)
              printModal.onClose()
              navigate('/recepciones')
            }}
          >
            Imprimir y finalizar
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

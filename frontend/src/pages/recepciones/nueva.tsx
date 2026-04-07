// frontend/src/pages/recepciones/nueva.tsx
import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { ArrowLeft, ShoppingCart, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import { toast } from 'sonner'
import { ReceptionItemCard, type DetalleLineUI } from './components/item-card'
import { ProductoAutocomplete } from './components/producto-autocomplete'
import { LabelsSection } from './components/labels-section'
import { QrScanner } from '@/components/shared/qr-scanner'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import type { Proveedor, Producto, Area, SolicitudResumen } from '@/types'

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Decision = 'completa' | 'parcial' | 'rechazada'

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


const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: '🌡️ Cadena de frío rota' },
  { id: 'embalaje', label: '📦 Embalaje dañado' },
  { id: 'documentos', label: '📄 Documentos incorrectos' },
  { id: 'cantidad', label: '🔢 Cantidad no coincide' },
  { id: 'no_solicitado', label: '⚗️ Producto no solicitado' },
]

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()

  // Estado cabecera
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [guiaDespacho, setGuiaDespacho] = useState('')
  const [fechaRecepcion, setFechaRecepcion] = useState(() => new Date().toISOString().slice(0, 16))
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [solicitudModalOpen, setSolicitudModalOpen] = useState(false)

  // Estado ítems
  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)

  // Estado decisión
  const [decision, setDecision] = useState<Decision>('completa')
  const [motivosSeleccionados, setMotivosSeleccionados] = useState<string[]>([])
  const [motivoOtro, setMotivoOtro] = useState('')
  const [nota, setNota] = useState('')

  // Estado post-confirmación (para imprimir etiquetas)
  const [lotesConfirmados, setLotesConfirmados] = useState<LoteParaEtiqueta[] | null>(null)
  const [showPrintModal, setShowPrintModal] = useState(false)

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
    queryKey: ['productos-all'],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', { params: { per_page: 500 } }).then(r => r.data.data),
  })

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ moneda_simbolo: string }>('/configuracion').then(r => r.data),
  })
  const monedaSimbolo = configuracion?.moneda_simbolo ?? '$'

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ['solicitudes-activas'],
    queryFn: () => api.get<{ data: SolicitudResumen[] }>('/solicitudes-compra').then(r =>
      (r.data.data ?? []).filter(s => ['aprobada', 'enviada'].includes(s.estado))
    ),
  })

  // ─── Agregar ítem ──────────────────────────────────────────────────────────

  const addProducto = useCallback(async (prod: Producto, overridePresentacionId?: number, overrideQuantity?: number) => {
    try {
      const res = await api.get(`/productos/${prod.id}`)
      const full = res.data
      const presentaciones = full.presentaciones || []
      const pres = (overridePresentacionId
        ? presentaciones.find((p: { id: number }) => p.id === overridePresentacionId)
        : null) ?? presentaciones[0] ?? null

      const catalogoArea = full.areas?.[0]
      const initialCantidadPresentacion = overrideQuantity ?? 1
      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        codigo_interno: prod.codigo_interno ?? '',
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_presentacion: initialCantidadPresentacion,
        cantidad_solicitada: overrideQuantity ?? null,
        factor_conversion: Number(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        codigo_lote: '',
        fecha_vencimiento: '',
        area_destino_id: catalogoArea?.id ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? '',
        presentaciones,
        precio_unitario: full.precio_unidad ? String(Math.round(full.precio_unidad * Number(pres?.factor_conversion || 1))) : '',
        imagen_url: full.imagen_url,
        incluir_etiqueta: false,
        cantidad_etiquetas: initialCantidadPresentacion,
      }
      setDetalles(prev => [line, ...prev])
      toast.success(`${prod.nombre} añadido`)
    } catch {
      toast.error('Error al cargar producto')
    }
  }, [])

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

      if (data.tipo === 'lote') {
        // Escaneo de etiqueta existente: pre-rellenar lote y vencimiento
        const pres = data.presentacion_id
          ? [{ id: data.presentacion_id, nombre: data.presentacion_nombre, nombre_plural: data.presentacion_nombre + 's', factor_conversion: 1, activa: true, version: 1 }]
          : []

        const initialCantidadPresentacion = 1
        const line: DetalleLineUI = {
          id: uuidv4(),
          producto_id: String(data.producto_id),
          producto_nombre: data.producto_nombre,
          codigo_interno: data.codigo_interno_lote || '',
          presentacion_id: data.presentacion_id || null,
          presentacion_nombre: data.presentacion_nombre || '',
          presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
          cantidad_presentacion: initialCantidadPresentacion,
          factor_conversion: 1,
          unidad_base_nombre: data.unidad_base_nombre || '',
          unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
          codigo_lote: data.numero_lote,
          fecha_vencimiento: data.fecha_vencimiento || '',
          area_destino_id: data.area_id || null,
          area_destino_nombre: data.area_nombre || '',
          presentaciones: pres,
          precio_unitario: '',
          imagen_url: data.imagen_url || null,
          incluir_etiqueta: false,
          cantidad_etiquetas: initialCantidadPresentacion,
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
  }, [productos, addProducto])

  // ─── Cambiar ítem ──────────────────────────────────────────────────────────

  const handleChange = useCallback((id: string, patch: Partial<DetalleLineUI>) => {
    setDetalles(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
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
      // Filtrar solo los que el usuario marcó para imprimir
      const paraImprimir: LoteParaEtiqueta[] = lotes
        .map(l => {
          const detalle = detalles.find(d => d.codigo_lote === l.numero_lote && d.producto_nombre === l.producto_nombre)
          if (!detalle?.incluir_etiqueta) return null
          return {
            lote_id: l.lote_id,
            codigo_interno: l.codigo_interno,
            numero_lote: l.numero_lote,
            fecha_vencimiento: l.fecha_vencimiento,
            producto_nombre: l.producto_nombre,
            presentacion_nombre: l.presentacion_nombre,
            area_nombre: l.area_nombre,
            cantidad_etiquetas: detalle.cantidad_etiquetas,
          } satisfies LoteParaEtiqueta
        })
        .filter((x): x is LoteParaEtiqueta => x !== null)

      if (paraImprimir.length > 0) {
        setLotesConfirmados(paraImprimir)
        setShowPrintModal(true)
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

    if (decision === 'rechazada') {
      if (motivosSeleccionados.length === 0 && !motivoOtro.trim()) {
        toast.error('Indica al menos un motivo de rechazo')
        return
      }
      const motivos = [
        ...motivosSeleccionados.map(id => MOTIVOS_RECHAZO.find(m => m.id === id)?.label ?? id),
        ...(motivoOtro.trim() ? [`Otro: ${motivoOtro.trim()}`] : []),
      ].join(' | ')

      mutation.mutate({
        proveedor_id: proveedorId,
        guia_despacho: guiaDespacho || undefined,
        fecha_recepcion: new Date(fechaRecepcion).toISOString(),
        estado: 'rechazada',
        motivo_rechazo: motivos,
        solicitud_id: solicitudId || undefined,
        detalle: [],
      })
      return
    }

    const validos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
    if (validos.length === 0) { toast.error('Completa al menos un ítem con lote, vencimiento y área'); return }

    if (decision === 'parcial' && !nota.trim()) {
      toast.error('Indica en la nota qué faltó por recibir')
      return
    }

    mutation.mutate({
      proveedor_id: proveedorId,
      guia_despacho: guiaDespacho || undefined,
      fecha_recepcion: new Date(fechaRecepcion).toISOString(),
      estado: decision,
      nota: nota || undefined,
      solicitud_id: solicitudId || undefined,
      detalle: validos.map(d => ({
        producto_id: d.producto_id,
        numero_lote: d.codigo_lote,
        fecha_vencimiento: d.fecha_vencimiento,
        presentacion_id: d.presentacion_id,
        cantidad_presentaciones: d.cantidad_presentacion,
        area_destino_id: d.area_destino_id!,
        precio_unitario: d.precio_unitario ? parseFloat(d.precio_unitario) : undefined,
      })),
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

  const itemsCompletos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id).length

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4">
      {/* Título */}
      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Nueva Recepción</h1>
      </div>

      {/* Layout B+C */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Panel izquierdo ── */}
        <div className="w-full lg:w-72 lg:sticky lg:top-4 space-y-4">

          {/* Datos guía */}
          <div className="card bg-base-100 border p-4 space-y-3">
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Guía de Despacho</h2>

            <div>
              <label className="label py-0.5"><span className="label-text text-xs">Proveedor *</span></label>
              <ProveedorSelect
                value={proveedorId || ''}
                onChange={v => setProveedorId(Number(v))}
                proveedores={proveedores || []}
              />
            </div>

            <div>
              <label className="label py-0.5"><span className="label-text text-xs">Nº Guía de Despacho</span></label>
              <input
                className="input input-sm input-bordered w-full"
                placeholder="GD-00000"
                value={guiaDespacho}
                onChange={e => setGuiaDespacho(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs opacity-50 block mb-1">Fecha y hora</label>
              <input
                type="datetime-local"
                className="input input-bordered input-sm w-full"
                value={fechaRecepcion}
                onChange={e => setFechaRecepcion(e.target.value)}
              />
            </div>

            {solicitudId ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-success font-medium flex items-center gap-1">
                  <ShoppingCart className="h-3 w-3" /> Solicitud vinculada ✓
                </span>
                <button
                  className="btn btn-xs btn-ghost btn-circle text-error"
                  title="Desvincular solicitud"
                  onClick={() => setSolicitudId(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                className="btn btn-sm btn-ghost btn-outline w-full border-dashed"
                onClick={() => setSolicitudModalOpen(true)}
              >
                <ShoppingCart className="h-4 w-4 mr-1" />
                Vincular solicitud (opcional)
              </button>
            )}
          </div>

          {/* Estado */}
          <div className="card bg-base-100 border p-4 space-y-2">
            <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Estado</h2>
            <span className={`badge ${estadoBadge.cls}`}>{estadoBadge.label}</span>
            {detalles.length > 0 && (
              <p className="text-xs opacity-50">
                {itemsCompletos}/{detalles.length} ítems completos
              </p>
            )}
          </div>

          {/* Decisión */}
          <div className="card bg-base-100 border p-4 space-y-3">
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
                    {dec === 'completa' ? '✅ Conforme'
                      : dec === 'parcial' ? '⚠️ Recepción parcial'
                      : '🚫 Rechazar guía'}
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
        </div>

        {/* ── Panel derecho ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Búsqueda / scan */}
          <ProductoAutocomplete
            productos={productos ?? []}
            excluidos={detalles.map(d => d.producto_id)}
            onSelect={prod => { addProducto(prod) }}
            onScan={handleSearch}
            onScannerOpen={() => setScannerOpen(true)}
          />

          {/* Lista de ítems */}
          {detalles.length === 0 ? (
            <div className="card bg-base-100 border border-dashed p-12 text-center">
              <p className="text-4xl mb-3">📦</p>
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
                  onRemove={handleRemove}
                  monedaSimbolo={monedaSimbolo}
                />
              ))}
            </div>
          )}

          {/* Sección etiquetas */}
          {decision !== 'rechazada' && (
            <LabelsSection
              detalles={detalles}
              onToggleEtiqueta={(id, val) => handleChange(id, { incluir_etiqueta: val })}
              onCantidadEtiqueta={(id, val) => handleChange(id, { cantidad_etiquetas: val })}
            />
          )}
        </div>
      </div>

      {/* Cámara escáner */}
      {scannerOpen && (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">Escanear producto</h3>
              <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setScannerOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <QrScanner
              active={scannerOpen}
              onScan={async (code) => {
                await handleSearch(code)
                setScannerOpen(false)
              }}
            />
            <p className="text-xs opacity-40 text-center mt-2">Apunta al código QR o de barras del producto</p>
          </div>
          <div className="modal-backdrop" onClick={() => setScannerOpen(false)} />
        </div>
      )}

      {/* Modal vincular solicitud */}
      <Dialog open={solicitudModalOpen} onClose={() => setSolicitudModalOpen(false)} title="Vincular Solicitud">
        <div className="space-y-2">
          {solicitudesPendientes?.map(s => (
            <button
              key={s.id}
              className="w-full p-4 border rounded-xl hover:bg-base-200 text-left"
              onClick={async () => {
                try {
                  const res = await api.get(`/solicitudes-compra/${s.id}`)
                  setSolicitudId(s.id)
                  setSolicitudModalOpen(false)
                  toast.success('Solicitud vinculada')
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
            <p className="text-center py-8 opacity-40 text-sm">No hay solicitudes aprobadas.</p>
          )}
        </div>
      </Dialog>

      {/* Modal imprimir etiquetas post-confirmación */}
      <Dialog
        open={showPrintModal}
        onClose={() => { setShowPrintModal(false); navigate('/recepciones') }}
        title="¿Imprimir etiquetas?"
      >
        {lotesConfirmados && (
          <LabelsSection lotesConfirmados={lotesConfirmados} />
        )}
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { setShowPrintModal(false); navigate('/recepciones') }}
          >
            Saltar
          </Button>
          <Button
            className="flex-1"
            onClick={async () => {
              if (lotesConfirmados) await imprimirEtiquetas(lotesConfirmados)
              setShowPrintModal(false)
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

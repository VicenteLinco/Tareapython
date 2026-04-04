import { useState, useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Plus, Trash2, ArrowLeft, ArrowRight,
  X, Search, ShoppingCart
} from 'lucide-react'
import api from '@/lib/api'
import { autoPlural, cn, formatDate } from '@/lib/utils'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import type { Proveedor, Producto, Presentacion, Area, SolicitudResumen } from '@/types'

interface RecepcionPayload {
  proveedor_id: number
  guia_despacho?: string
  fecha_recepcion: string
  nota?: string
  estado?: string
  solicitud_id?: string
  detalle: {
    producto_id: string
    numero_lote: string
    fecha_vencimiento: string
    presentacion_id?: number | null
    cantidad_presentaciones: number
    area_destino_id: number
    costo_unitario?: number
    precio_unitario?: number
  }[]
}

interface DetalleLineUI {
  id: string
  producto_id: string
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
  costo_unitario: string
  precio_unitario: string
  imagen_url?: string | null
}

const TODAY = new Date().toISOString().split('T')[0]
const NOW_TIME = new Date().toTimeString().slice(0, 5)

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [solicitudModalOpen, setSolicitudModalOpen] = useState(false)
  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])

  const [guiaDespacho, setGuiaFactura] = useState('')
  const [proveedorId, setProveedorId] = useState<number | null>(null)
  const [fechaRecepcion] = useState(TODAY)
  const [horaRecepcion] = useState(NOW_TIME)

  const { data: areas } = useQuery({ queryKey: ['areas'], queryFn: () => api.get<Area[]>('/areas').then(r => r.data) })
  const { data: proveedores } = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data) })
  const { data: productos } = useQuery({ queryKey: ['productos-all'], queryFn: () => api.get<{ data: Producto[] }>('/productos', { params: { per_page: 500 } }).then(r => r.data.data) })

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ['solicitudes-activas'],
    queryFn: () => api.get<{ data: SolicitudResumen[] }>('/solicitudes-compra').then(r =>
      (r.data.data ?? []).filter(s => ['aprobada', 'enviada'].includes(s.estado))
    ),
    enabled: step === 1,
  })

  const addProductoDirecto = useCallback(async (prod: Producto) => {
    try {
      const res = await api.get(`/productos/${prod.id}`)
      const fullProd = res.data

      const presentaciones = fullProd.presentaciones || []
      const pres = presentaciones[0] || null
      const factor = Number(pres?.factor_conversion || 1)

      const catalogoArea = fullProd.areas?.[0]
      const finalAreaId = catalogoArea?.id ?? null
      const finalAreaNombre = catalogoArea?.nombre ?? ''

      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || (pres ? autoPlural(pres.nombre) : ''),
        cantidad_presentacion: 1,
        factor_conversion: factor,
        unidad_base_nombre: fullProd.unidad_base?.nombre || '',
        unidad_base_nombre_plural: fullProd.unidad_base?.nombre_plural || '',
        codigo_lote: '',
        fecha_vencimiento: '',
        area_destino_id: finalAreaId,
        area_destino_nombre: finalAreaNombre,
        presentaciones,
        costo_unitario: fullProd.precio_unidad ? String(fullProd.precio_unidad) : '',
        precio_unitario: fullProd.precio_unidad ? (fullProd.precio_unidad * factor).toFixed(2) : '',
        imagen_url: fullProd.imagen_url,
      }
      setDetalles(prev => [line, ...prev])
      toast.success(`${prod.nombre} añadido`)
    } catch {
      toast.error('Error al cargar producto')
    }
  }, [areas])

  const handleConfirmar = () => {
    if (!proveedorId) { toast.error('Selecciona proveedor'); return }
    const valid = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
    if (valid.length === 0) { toast.error('Completa al menos un ítem con lote y área'); return }
    
    confirmarMutation.mutate({
      proveedor_id: proveedorId,
      guia_despacho: guiaDespacho || undefined,
      fecha_recepcion: new Date(`${fechaRecepcion}T${horaRecepcion}`).toISOString(),
      solicitud_id: solicitudId || undefined,
      detalle: valid.map(d => ({
        producto_id: d.producto_id,
        numero_lote: d.codigo_lote,
        fecha_vencimiento: d.fecha_vencimiento,
        presentacion_id: d.presentacion_id,
        cantidad_presentaciones: d.cantidad_presentacion,
        area_destino_id: d.area_destino_id!,
        precio_unitario: d.precio_unitario ? parseFloat(d.precio_unitario) : undefined
      }))
    })
  }

  const confirmarMutation = useMutation({
    mutationFn: (data: RecepcionPayload) => api.post('/recepciones', data),
    onSuccess: () => { toast.success('Recepción confirmada'); navigate('/recepciones') }
  })

  return (
    <div className="space-y-6 p-2">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/recepciones')}><ArrowLeft /></Button>
        <h1 className="text-2xl font-bold">Nueva Recepción</h1>
      </div>

      <div className="steps w-full">
        <div className={`step ${step >= 1 ? 'step-primary' : ''}`} onClick={() => setStep(1)}>General</div>
        <div className={`step ${step >= 2 ? 'step-primary' : ''}`} onClick={() => setStep(2)}>Ítems</div>
      </div>

      {step === 1 && (
        <div className="card bg-base-100 border p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <fieldset className="fieldset">
              <legend className="fieldset-legend font-bold">Proveedor</legend>
              <ProveedorSelect value={proveedorId || ''} onChange={v => setProveedorId(Number(v))} proveedores={proveedores || []} />
            </fieldset>
            <fieldset className="fieldset">
              <legend className="fieldset-legend font-bold">Guía de Despacho</legend>
              <input className="input input-bordered w-full" value={guiaDespacho} onChange={e => setGuiaFactura(e.target.value)} />
            </fieldset>
            <Button variant="outline" className="h-full border-dashed" onClick={() => setSolicitudModalOpen(true)}>
              <ShoppingCart className="mr-2" /> Cargar Solicitud
            </Button>
          </div>
          <Button className="w-full" onClick={() => setStep(2)}>Continuar <ArrowRight /></Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
              <input 
                className="input input-bordered w-full pl-10" 
                placeholder="Escanear o buscar producto..." 
                onChange={e => {
                  const q = e.target.value.toLowerCase()
                  if (q.length > 2) {
                    const found = productos?.find(p => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase() === q)
                    if (found) { addProductoDirecto(found); e.target.value = '' }
                  }
                }} 
              />
            </div>
          </div>

          <div className="space-y-2">
            {detalles.map(d => (
              <div key={d.id} className="card bg-base-100 border p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex gap-3 min-w-0">
                    <ProductoImage src={d.imagen_url} size="md" className="shrink-0" />
                    <div className="min-w-0">
                      <h3 className="font-bold truncate">{d.producto_nombre}</h3>
                      <div className="flex gap-2 mt-1">
                        {d.area_destino_id ? (
                          <span className="badge badge-sm badge-ghost">{d.area_destino_nombre}</span>
                        ) : (
                          <select
                            className="select select-bordered select-xs select-warning"
                            value=""
                            onChange={e => {
                              const aid = Number(e.target.value)
                              if (!aid) return
                              const areaNombre = areas?.find(a => a.id === aid)?.nombre || ''
                              setDetalles(prev => prev.map(x => x.id === d.id ? { ...x, area_destino_id: aid, area_destino_nombre: areaNombre } : x))
                            }}
                          >
                            <option value="">⚠ Asignar área...</option>
                            {areas?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setDetalles(prev => prev.filter(x => x.id !== d.id))}><Trash2 className="text-error h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  <input className="input input-sm input-bordered" placeholder="Lote" value={d.codigo_lote} onChange={e => setDetalles(prev => prev.map(x => x.id === d.id ? { ...x, codigo_lote: e.target.value } : x))} />
                  <input type="date" className="input input-sm input-bordered" value={d.fecha_vencimiento} onChange={e => setDetalles(prev => prev.map(x => x.id === d.id ? { ...x, fecha_vencimiento: e.target.value } : x))} />
                  <div className="flex items-center gap-1">
                    <input type="number" className="input input-sm input-bordered w-16" value={d.cantidad_presentacion} onChange={e => setDetalles(prev => prev.map(x => x.id === d.id ? { ...x, cantidad_presentacion: Number(e.target.value) } : x))} />
                    <span className="text-xs opacity-50">{d.presentacion_nombre || d.unidad_base_nombre}</span>
                  </div>
                  <input type="number" className="input input-sm input-bordered" placeholder="Precio" value={d.precio_unitario} onChange={e => setDetalles(prev => prev.map(x => x.id === d.id ? { ...x, precio_unitario: e.target.value } : x))} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between gap-4 sticky bottom-0 bg-base-100 p-4 border-t">
            <Button variant="ghost" onClick={() => setStep(1)}>Atrás</Button>
            <Button className="flex-1" onClick={handleConfirmar} disabled={confirmarMutation.isPending}>
              {confirmarMutation.isPending ? <span className="loading loading-spinner"></span> : 'Confirmar Recepción'}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={solicitudModalOpen} onClose={() => setSolicitudModalOpen(false)} title="Cargar Solicitud">
         <div className="space-y-2">
            {solicitudesPendientes?.map(s => (
              <button key={s.id} className="w-full p-4 border rounded-xl hover:bg-base-200 text-left relative group" onClick={async () => {
                const res = await api.get(`/solicitudes-compra/${s.id}`)
                setSolicitudId(s.id)
                toast.success('Cargando ítems...')
                setSolicitudModalOpen(false)
                for (const item of res.data.items) {
                   const p = productos?.find(x => x.id === item.producto_id)
                   if (p) await addProductoDirecto(p)
                }
              }}>
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-bold">{s.numero_documento}</p>
                    <p className="text-[10px] opacity-50 uppercase">{formatDate(s.fecha_creacion)}</p>
                  </div>
                  <Badge variant="outline">{s.items_count} ítems</Badge>
                </div>
                <ArrowRight className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
            {solicitudesPendientes?.length === 0 && <p className="text-center py-10 opacity-40">No hay solicitudes aprobadas para recibir.</p>}
         </div>
      </Dialog>
    </div>
  )
}

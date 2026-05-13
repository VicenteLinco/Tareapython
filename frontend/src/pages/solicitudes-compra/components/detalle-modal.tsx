// frontend/src/pages/solicitudes-compra/components/detalle-modal.tsx
import { useState } from 'react'
import { FileDown, Send, CheckCircle2, XCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDate, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { PageLoading } from '@/components/ui/page-state'
import api from '@/lib/api'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { formatPesos } from '../solicitud-utils'
import type { SolicitudDetalle } from '@/types'

interface DetalleModalProps {
  solicitudId: string | null
  detail: SolicitudDetalle | undefined
  isLoading: boolean
  pdfFirmaLabel: string
  monedaCodigo: string
  monedaSimbolo: string
  nombreLaboratorio: string
  logoBase64?: string | null
  onClose: () => void
  onPdfFirmaChange: (v: string) => void
}

const estadoBadgeClass = (estado: string) =>
  estado === 'completada' ? 'bg-success/10 text-success border-success/30' :
  estado === 'guardada'   ? 'bg-warning/10 text-warning border-warning/30' :
  estado === 'cancelada'  ? 'bg-error/10 text-error border-error/30' :
  estado === 'enviada'    ? 'bg-info/10 text-info border-info/30' :
  'bg-base-200 text-base-content/50 border-base-300'

const estadoLabel = (estado: string) => estado === 'guardada' ? 'pendiente' : estado

export function DetalleModal({
  solicitudId,
  detail,
  isLoading,
  pdfFirmaLabel,
  monedaCodigo,
  monedaSimbolo,
  nombreLaboratorio,
  logoBase64,
  onClose,
  onPdfFirmaChange,
}: DetalleModalProps) {
  const queryClient = useQueryClient()
  const [confirmEnviar, setConfirmEnviar] = useState(false)
  const [confirmCompletar, setConfirmCompletar] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelMotivo, setCancelMotivo] = useState('')
  const [metodoEnvio, setMetodoEnvio] = useState('email')

  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  const calcTotal = (items: SolicitudDetalle['items']) =>
    items.reduce((acc, i) => {
      const qty = parseFloat(i.cantidad_sugerida)
      const fc = i.factor_conversion ? parseFloat(i.factor_conversion) : null
      const pu = i.precio_unitario ? parseFloat(i.precio_unitario) : 0
      return acc + qty * (i.presentacion_id && fc ? pu * fc : pu)
    }, 0)

  const invalidate = () => {
    if (solicitudId) queryClient.invalidateQueries({ queryKey: ['solicitud-detail', solicitudId] })
    queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    queryClient.invalidateQueries({ queryKey: ['solicitudes-guardadas'] })
    queryClient.invalidateQueries({ queryKey: ['solicitudes-recomendaciones'] })
  }

  const enviarMut = useMutation({
    mutationFn: () =>
      api.post(`/solicitudes-compra/${solicitudId}/enviar`, { metodo_envio: metodoEnvio || null }),
    onSuccess: () => {
      toast.success('Solicitud marcada como enviada')
      invalidate()
      setConfirmEnviar(false)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al marcar enviada')
    },
  })

  const completarMut = useMutation({
    mutationFn: () => api.post(`/solicitudes-compra/${solicitudId}/completar`, {}),
    onSuccess: () => {
      toast.success('Solicitud marcada como completada')
      invalidate()
      setConfirmCompletar(false)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al completar solicitud')
    },
  })

  const cancelarMut = useMutation({
    mutationFn: () =>
      api.post(`/solicitudes-compra/${solicitudId}/cancelar`, { motivo: cancelMotivo.trim() }),
    onSuccess: () => {
      toast.success('Solicitud cancelada')
      invalidate()
      setCancelOpen(false)
      setCancelMotivo('')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al cancelar solicitud')
    },
  })

  const handleExportPDF = () => {
    if (!detail) return
    const subtotal = calcTotal(detail.items)
    const iva = subtotal * 0.19
    exportarSolicitudPDF({
      numero_documento: detail.numero_documento,
      fecha_creacion: detail.fecha_creacion,
      usuario_nombre: detail.usuario_nombre,
      nota: detail.nota,
      subtotal_neto: subtotal,
      iva,
      total_con_iva: subtotal + iva,
      nombreLaboratorio,
      logoBase64: logoBase64 ?? null,
      monedaSimbolo,
      firma_solicitante_label: pdfFirmaLabel || null,
      items: detail.items.map(i => ({
        producto_nombre: i.producto_nombre,
        cantidad_sugerida: parseFloat(i.cantidad_sugerida),
        unidad: i.unidad,
        unidad_plural: i.unidad_plural,
        codigo_maestro: i.codigo_maestro,
        codigo_proveedor: i.codigo_proveedor,
        proveedor_nombre: i.proveedor_nombre,
        presentacion_nombre: i.presentacion_nombre,
        presentacion_nombre_plural: i.presentacion_nombre_plural,
        factor_conversion: i.factor_conversion ? parseFloat(i.factor_conversion) : null,
        cantidad_presentaciones: i.cantidad_presentaciones ? parseFloat(i.cantidad_presentaciones) : null,
        precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
      })),
    })
  }

  if (!solicitudId) return null

  const estado = detail?.estado
  const puedeEnviar = estado === 'guardada'
  const puedeCompletar = estado === 'guardada' || estado === 'enviada'
  const puedeCancelar = estado === 'guardada' || estado === 'enviada'

  return (
    <>
      <Dialog
        open={!!solicitudId}
        onClose={onClose}
        title={`Detalle Solicitud ${detail?.numero_documento || ''}`}
        className="max-w-4xl"
        closeOnBackdrop={false}
      >
        {isLoading ? (
          <PageLoading label="Cargando detalle..." />
        ) : detail && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-base-200/50 rounded-2xl">
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Estado</p>
                <span className={cn(
                  'inline-block mt-0.5 px-2.5 py-0.5 rounded-full border text-xs font-bold capitalize',
                  estadoBadgeClass(detail.estado)
                )}>
                  {estadoLabel(detail.estado)}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Solicitado por</p>
                <p className="font-bold">{detail.usuario_nombre}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Fecha</p>
                <p className="font-bold">{formatDate(detail.fecha_creacion)}</p>
              </div>
              {detail.fecha_envio && (
                <div>
                  <p className="text-[10px] font-black uppercase opacity-40">Enviada</p>
                  <p className="font-bold">{formatDate(detail.fecha_envio)}</p>
                  {detail.metodo_envio && (
                    <p className="text-[10px] opacity-50 capitalize">vía {detail.metodo_envio}</p>
                  )}
                </div>
              )}
              {detail.fecha_cierre && (
                <div>
                  <p className="text-[10px] font-black uppercase opacity-40">
                    {detail.estado === 'cancelada' ? 'Cancelada' : 'Completada'}
                  </p>
                  <p className="font-bold">{formatDate(detail.fecha_cierre)}</p>
                </div>
              )}
            </div>

            {detail.estado === 'cancelada' && detail.motivo_cierre && (
              <div className="p-4 bg-error/5 rounded-2xl border border-error/20">
                <p className="text-[10px] font-black uppercase opacity-50 mb-1 text-error">Motivo de cancelación</p>
                <p className="text-sm">{detail.motivo_cierre}</p>
              </div>
            )}

            <div className="overflow-hidden border border-base-300 rounded-2xl">
              <table className="table table-zebra table-sm">
                <thead className="bg-base-200">
                  <tr>
                    <th>Producto</th>
                    <th>Proveedor</th>
                    <th className="text-center">Cant.</th>
                    <th>Unidad</th>
                    <th className="text-right">Precio c/u</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, idx) => {
                    const cant = parseFloat(item.cantidad_sugerida)
                    const fc = item.factor_conversion ? parseFloat(item.factor_conversion) : null
                    const hasPres = !!(item.presentacion_id && fc)
                    const puBase = item.precio_unitario ? parseFloat(item.precio_unitario) : 0
                    const precioUnit = hasPres ? puBase * fc! : puBase
                    return (
                      <tr key={idx}>
                        <td className="font-bold text-xs">{item.producto_nombre}</td>
                        <td className="text-[10px] opacity-60">{item.proveedor_nombre}</td>
                        <td className="text-center font-bold">{cant}</td>
                        <td className="text-[10px] uppercase font-bold opacity-50">
                          {item.presentacion_nombre || item.unidad}
                        </td>
                        <td className="text-right">
                          <p className="font-mono text-[11px] font-bold">
                            {precioUnit > 0 ? fmt(precioUnit) : <span className="opacity-30">—</span>}
                          </p>
                          {precioUnit > 0 && (
                            <p className="text-[9px] opacity-35 font-medium">
                              / {hasPres ? (item.presentacion_nombre ?? 'pres.') : item.unidad}
                            </p>
                          )}
                        </td>
                        <td className="text-right font-bold text-xs">{fmt(cant * precioUnit)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detail.nota && (
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <p className="text-[10px] font-black uppercase opacity-40 mb-1">Nota</p>
                <p className="text-sm italic">"{detail.nota}"</p>
              </div>
            )}

            <div className="p-4 bg-base-200/50 rounded-2xl border border-base-300 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-40 flex items-center gap-1.5">
                <FileDown className="h-3 w-3" /> Configurar firma del PDF
              </p>
              <div className="space-y-1 max-w-xs">
                <label className="text-[10px] font-bold opacity-50">Nombre solicitante</label>
                <Input
                  placeholder={detail.usuario_nombre}
                  value={pdfFirmaLabel}
                  onChange={e => onPdfFirmaChange(e.target.value)}
                  className="h-8 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 pt-2 border-t">
              <div className="space-y-1">
                <div className="flex items-center gap-6 text-xs opacity-50">
                  <span>Subtotal neto: <span className="font-mono font-bold">{fmt(calcTotal(detail.items))}</span></span>
                  <span>IVA 19%: <span className="font-mono font-bold">{fmt(calcTotal(detail.items) * 0.19)}</span></span>
                </div>
                <div className="text-xl font-black flex items-center gap-2">
                  <span className="text-xs opacity-40 font-bold uppercase mr-1">Total c/IVA:</span>
                  {fmt(calcTotal(detail.items) * 1.19)}
                  <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" className="rounded-xl h-10 gap-2" onClick={handleExportPDF}>
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                {puedeCancelar && (
                  <Button
                    variant="outline"
                    className="rounded-xl h-10 gap-2 border-error/40 text-error hover:bg-error/10"
                    onClick={() => setCancelOpen(true)}
                  >
                    <XCircle className="h-4 w-4" /> Cancelar
                  </Button>
                )}
                {puedeEnviar && (
                  <Button
                    className="rounded-xl h-10 gap-2 bg-info hover:bg-info/90 text-info-content"
                    onClick={() => setConfirmEnviar(true)}
                  >
                    <Send className="h-4 w-4" /> Marcar enviada
                  </Button>
                )}
                {puedeCompletar && (
                  <Button
                    className="rounded-xl h-10 gap-2 bg-success hover:bg-success/90 text-success-content"
                    onClick={() => setConfirmCompletar(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Marcar completada
                  </Button>
                )}
                <Button className="rounded-xl h-10" onClick={onClose}>Cerrar</Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmEnviar}
        onClose={() => setConfirmEnviar(false)}
        title="Marcar como enviada"
        closeOnBackdrop={false}
      >
        <div className="space-y-4">
          <p className="text-sm">
            Confirma que esta solicitud fue enviada al proveedor. Pasará al estado <b>enviada</b>.
          </p>
          <div className="space-y-1">
            <label className="text-[10px] font-bold opacity-60 uppercase">Método de envío</label>
            <select
              value={metodoEnvio}
              onChange={e => setMetodoEnvio(e.target.value)}
              className="select select-bordered select-sm rounded-xl w-full"
            >
              <option value="email">Email</option>
              <option value="telefono">Teléfono</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="presencial">Presencial</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div className="modal-action">
            <Button variant="ghost" onClick={() => setConfirmEnviar(false)} disabled={enviarMut.isPending}>
              Cancelar
            </Button>
            <Button
              className="bg-info hover:bg-info/90 text-info-content"
              onClick={() => enviarMut.mutate()}
              disabled={enviarMut.isPending}
            >
              {enviarMut.isPending && <span className="loading loading-spinner loading-xs mr-2" />}
              Marcar enviada
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmCompletar}
        onClose={() => setConfirmCompletar(false)}
        title="Marcar como completada"
        closeOnBackdrop={false}
      >
        <div className="space-y-4">
          <p className="text-sm">
            Confirma que el pedido ya fue recibido. La solicitud pasará al estado <b>completada</b> y se cerrará el ciclo.
          </p>
          <div className="modal-action">
            <Button variant="ghost" onClick={() => setConfirmCompletar(false)} disabled={completarMut.isPending}>
              Cancelar
            </Button>
            <Button
              className="bg-success hover:bg-success/90 text-success-content"
              onClick={() => completarMut.mutate()}
              disabled={completarMut.isPending}
            >
              {completarMut.isPending && <span className="loading loading-spinner loading-xs mr-2" />}
              Marcar completada
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => { setCancelOpen(false); setCancelMotivo('') }}
        title="Cancelar solicitud"
        closeOnBackdrop={false}
      >
        <div className="space-y-4">
          <p className="text-sm">
            Indica el motivo de la cancelación. La solicitud quedará registrada pero ya no podrá editarse.
          </p>
          <textarea
            value={cancelMotivo}
            onChange={e => setCancelMotivo(e.target.value)}
            placeholder="Motivo (obligatorio)"
            rows={3}
            className="textarea textarea-bordered rounded-xl w-full text-sm"
          />
          <div className="modal-action">
            <Button
              variant="ghost"
              onClick={() => { setCancelOpen(false); setCancelMotivo('') }}
              disabled={cancelarMut.isPending}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelarMut.mutate()}
              disabled={cancelarMut.isPending || cancelMotivo.trim().length === 0}
            >
              {cancelarMut.isPending && <span className="loading loading-spinner loading-xs mr-2" />}
              Cancelar solicitud
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

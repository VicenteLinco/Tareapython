// frontend/src/pages/solicitudes-compra/components/detalle-modal.tsx
import { FileDown } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
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
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  const calcTotal = (items: SolicitudDetalle['items']) =>
    items.reduce((acc, i) => {
      const qty = parseFloat(i.cantidad_sugerida)
      const fc = i.factor_conversion ? parseFloat(i.factor_conversion) : null
      const pu = i.precio_unitario ? parseFloat(i.precio_unitario) : 0
      return acc + qty * (i.presentacion_id && fc ? pu * fc : pu)
    }, 0)

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

  return (
    <Dialog
      open={!!solicitudId}
      onClose={onClose}
      title={`Detalle Solicitud ${detail?.numero_documento || ''}`}
      className="max-w-4xl"
    >
      {isLoading ? (
        <div className="py-20 text-center"><span className="loading loading-spinner loading-lg" /></div>
      ) : detail && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-base-200/50 rounded-2xl">
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Estado</p>
              <p className="font-bold capitalize">{detail.estado}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Solicitado por</p>
              <p className="font-bold">{detail.usuario_nombre}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Fecha</p>
              <p className="font-bold">{formatDate(detail.fecha_creacion)}</p>
            </div>
          </div>

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

          <div className="flex justify-between items-center pt-2 border-t">
            <div className="text-xl font-black flex items-center gap-2">
              <span className="text-xs opacity-40 font-bold uppercase mr-1">Total Estimado:</span>
              {fmt(calcTotal(detail.items))}
              <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl h-10 gap-2" onClick={handleExportPDF}>
                <FileDown className="h-4 w-4" /> PDF
              </Button>
              <Button className="rounded-xl h-10" onClick={onClose}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

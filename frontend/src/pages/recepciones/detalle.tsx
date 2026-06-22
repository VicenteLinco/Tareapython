import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Package, FileDown, FileText, X, Upload, Info,
  AlertTriangle, CheckCircle2, Clock, Smartphone, Printer,
} from 'lucide-react'
import { QrScannerSession } from './qr-scanner-session'
import { Badge } from '@/components/ui/badge'
import { PageLoading } from '@/components/ui/page-state'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import { Dialog } from '@/components/ui/dialog'
import { LabelsSection } from './components/labels-section'
import { useCanOperate } from '@/hooks/use-auth-store'
import api from '@/lib/api'
import { formatDate, daysUntil, cn, formatCantidad, APP_LOCALE } from '@/lib/utils'
import { CantidadConUnidad } from '@/components/ui/cantidad'
import { notify } from '@/lib/notify'
import { toDecimal, toNum } from '@/domain/parse'
import { AuthenticatedUploadImage } from '@/components/ui/authenticated-image'

interface RecepcionHeader {
  id: string
  numero_documento: string
  proveedor_id: number
  proveedor_nombre: string
  proveedor_icono: string | null
  guia_despacho: string | null
  estado: string
  fecha_recepcion: string
  usuario_nombre: string
  created_at: string
}

interface DetalleItem {
  id: number
  producto_nombre: string
  numero_lote: string
  fecha_vencimiento: string | null
  presentacion_nombre: string
  cantidad_presentaciones: string
  factor_conversion_usado: string
  cantidad_unidades_base: string
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  area_destino: string
  lote_id: string
}

interface RecepcionDetalleResponse {
  recepcion: RecepcionHeader
  nota: string | null
  foto_documento: string | null
  foto_actualizada_at: string | null
  detalle: DetalleItem[]
}

export default function RecepcionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canOperate = useCanOperate()
  const [fotoOpen, setFotoOpen] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [showQrScanner, setShowQrScanner] = useState(false)
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputFirstRef = useRef<HTMLInputElement>(null)

  const uploadFotoMut = useMutation({
    mutationFn: (dataUrl: string) =>
      api.put(`/recepciones/${id}/foto`, { data_url: dataUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepcion', id] })
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      notify.success('Guía de despacho actualizada')
      setConfirmReplace(false)
    },
    onError: () => notify.error('No se pudo guardar la foto'),
  })

  const confirmarMutation = useMutation({
    mutationFn: () => api.post(`/recepciones/${id}/confirmar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepcion', id] })
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      notify.success('Recepción confirmada')
    },
    onError: () => notify.error('Error al confirmar recepción'),
  })

  function handleFotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      uploadFotoMut.mutate(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recepcion', id],
    queryFn: () =>
      api.get<RecepcionDetalleResponse>(`/recepciones/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  function imprimirPDF() {
    if (!data) return
    const { recepcion, nota, detalle } = data
    const esConfirmada = recepcion.estado === 'completa' || recepcion.estado === 'confirmada'

    const filas = detalle.map((item) => {
      const qty = toNum(item.cantidad_unidades_base)
      const qtyPres = toDecimal(item.cantidad_presentaciones)
      const factor = toDecimal(item.factor_conversion_usado)
      const qtyPresStr = qtyPres.toDecimalPlaces(2).toString()
      const cantidadCell = !factor.eq(1)
        ? `<div style="font-weight:600">${qtyPresStr} ${item.presentacion_nombre}</div>
           <div style="color:#6b7280;font-size:11px;margin-top:1px">= ${formatCantidad(qty, item.unidad_base_nombre, item.unidad_base_nombre_plural)}</div>`
        : `<div style="font-weight:600">${formatCantidad(qty, item.unidad_base_nombre, item.unidad_base_nombre_plural)}</div>`
      return `
        <tr>
          <td>${item.producto_nombre}</td>
          <td style="font-family:monospace">${item.numero_lote}</td>
          <td>${item.fecha_vencimiento ? formatDate(item.fecha_vencimiento) : 'No aplica'}</td>
          <td style="text-align:right">${cantidadCell}</td>
          <td>${item.area_destino}</td>
        </tr>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Recepción ${recepcion.numero_documento}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 32px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
    .header h1 { font-size: 22px; font-weight: 700; color: #1e40af; font-family: monospace; }
    .header .estado { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; background: ${esConfirmada ? '#dcfce7' : '#f3f4f6'}; color: ${esConfirmada ? '#166534' : '#374151'}; border: 1px solid ${esConfirmada ? '#bbf7d0' : '#d1d5db'}; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; padding: 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
    .meta-item label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; display: block; margin-bottom: 2px; }
    .meta-item span { font-size: 12px; font-weight: 600; }
    .nota { margin-bottom: 20px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 12px; color: #78350f; }
    .nota strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
    h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e40af; color: white; font-size: 11px; font-weight: 600; text-align: left; padding: 7px 10px; }
    td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #f9fafb; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
    @page { margin: 20mm; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${recepcion.numero_documento}</h1>
      <div style="margin-top:6px;color:#6b7280;font-size:12px">Recepción de Insumos &mdash; Laboratorio Clínico</div>
    </div>
    <span class="estado">${esConfirmada ? 'Confirmada' : 'Borrador'}</span>
  </div>

  <div class="meta">
    <div class="meta-item"><label>Proveedor</label><span>${recepcion.proveedor_nombre}</span></div>
    <div class="meta-item"><label>Fecha recepción</label><span>${formatDate(recepcion.fecha_recepcion)}</span></div>
    <div class="meta-item"><label>Guía de despacho</label><span>${recepcion.guia_despacho ?? '—'}</span></div>
    <div class="meta-item"><label>Registrado por</label><span>${recepcion.usuario_nombre}</span></div>
  </div>

  ${nota ? `<div class="nota"><strong>Nota</strong>${nota}</div>` : ''}

  <h2>Ítems recibidos (${detalle.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th>N° Lote</th>
        <th>Vencimiento</th>
        <th style="text-align:right">Cantidad recibida</th>
        <th>Área destino</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="footer">
    <span>Generado el ${new Date().toLocaleString(APP_LOCALE)}</span>
    <span>${recepcion.numero_documento}</span>
  </div>

  <script>
    window.onload = () => { setTimeout(() => window.print(), 250); };
    window.onafterprint = () => window.close();
  </script>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  if (isLoading) {
    return (
      <PageLoading label="Cargando recepción..." />
    )
  }

  if (isError || !data) {
    return (
      <div className="text-center py-16 text-error">
        No se pudo cargar la recepción.
      </div>
    )
  }

  const { recepcion, nota, foto_documento, foto_actualizada_at, detalle } = data
  const esConfirmada = recepcion.estado !== 'borrador'

  const fotoEsPosterior = (() => {
    if (!foto_actualizada_at || !recepcion.created_at) return false
    return new Date(foto_actualizada_at).getTime() - new Date(recepcion.created_at).getTime() > 10 * 60 * 1000
  })()

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Cabecera ── */}
      <div className="flex flex-col gap-3">
        {/* Fila 1: volver + título + estado */}
        <div className="flex items-center gap-3">
          <button
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={() => navigate('/recepciones')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-mono leading-tight">{recepcion.numero_documento}</h1>
            <p className="text-xs opacity-45">{formatDate(recepcion.fecha_recepcion)}</p>
          </div>
          <div className="ml-auto shrink-0">
            <Badge
              variant={
                recepcion.estado === 'borrador' ? 'secondary' :
                recepcion.estado === 'rechazada' ? 'destructive' :
                recepcion.estado === 'parcial' ? 'warning' :
                'success'
              }
              className="text-sm px-3 py-1"
            >
              {recepcion.estado === 'borrador' && <><Clock className="inline h-3.5 w-3.5 mr-1" />Borrador</>}
              {recepcion.estado === 'completa' && <><CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />Confirmada</>}
              {recepcion.estado === 'confirmada' && <><CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />Confirmada</>}
              {recepcion.estado === 'parcial' && <><CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />Parcial</>}
              {recepcion.estado === 'rechazada' && <><AlertTriangle className="inline h-3.5 w-3.5 mr-1" />Rechazada</>}
            </Badge>
          </div>
        </div>

        {/* Fila 2: acciones */}
        <div className="flex flex-wrap items-center gap-2 pl-10">
          {foto_documento && (
            <button
              className="btn btn-sm btn-primary shadow-md gap-2 font-bold px-4 hover:scale-[1.02] transition-all"
              onClick={() => setFotoOpen(true)}
            >
              <FileText className="h-4 w-4" />
              Ver Guía de despacho
            </button>
          )}

          {/* inputs ocultos */}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFotoFile} />
          <input ref={fileInputFirstRef} type="file" accept="image/*" className="hidden" onChange={handleFotoFile} />

          {canOperate && !foto_documento && (
            <button
              className={cn('btn btn-sm btn-primary shadow-md gap-2 font-bold px-5 hover:scale-[1.02] transition-all animate-pulse', uploadFotoMut.isPending && 'loading')}
              onClick={() => fileInputFirstRef.current?.click()}
              disabled={uploadFotoMut.isPending}
            >
              {!uploadFotoMut.isPending && <Upload className="h-4 w-4" />}
              Adjuntar foto de la guía
            </button>
          )}

          {canOperate && foto_documento && !confirmReplace && (
            <button
              className="btn btn-sm btn-outline gap-2 hover:scale-[1.02] transition-all"
              onClick={() => setConfirmReplace(true)}
              disabled={uploadFotoMut.isPending}
            >
              <Upload className="h-4 w-4" />
              Reemplazar foto de la guía
            </button>
          )}

          <button className="btn btn-sm btn-outline gap-2" onClick={imprimirPDF}>
            <FileDown className="h-4 w-4" />
            Exportar PDF
          </button>

          <button
            className="btn btn-sm btn-outline gap-2"
            onClick={() => setPrintModalOpen(true)}
          >
            <Printer className="h-4 w-4" />
            Imprimir etiquetas
          </button>

          {canOperate && !esConfirmada && (
            <>
              <button
                className="btn btn-outline btn-sm gap-2"
                onClick={() => setShowQrScanner(true)}
              >
                <Smartphone className="h-4 w-4" /> Escanear con celular
              </button>
              <button
                className="btn btn-success btn-sm gap-2"
                disabled={confirmarMutation.isPending}
                onClick={() => confirmarMutation.mutate()}
              >
                {confirmarMutation.isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : <><CheckCircle2 className="h-4 w-4" />Confirmar recepción</>
                }
              </button>
            </>
          )}
        </div>

        {/* Confirmación reemplazo: alerta separada */}
        {confirmReplace && (
          <div className="ml-10 flex items-center gap-3 rounded-lg border border-warning bg-warning/10 px-4 py-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <span className="flex-1 text-warning-content font-medium">
              La foto actual será reemplazada permanentemente. ¿Confirmar?
            </span>
            <button
              className={cn('btn btn-sm btn-warning gap-1.5', uploadFotoMut.isPending && 'loading')}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadFotoMut.isPending}
            >
              {!uploadFotoMut.isPending && <Upload className="h-3.5 w-3.5" />}
              Sí, reemplazar
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setConfirmReplace(false)}
              disabled={uploadFotoMut.isPending}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* ── Tarjeta de info ── */}
      <div className="rounded-xl border border-base-200 bg-base-100 divide-y divide-base-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-base-200">
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Proveedor</p>
            <div className="flex items-center gap-1.5 font-medium text-sm">
              <ProveedorIcon
                proveedor={{ nombre: recepcion.proveedor_nombre, icono: recepcion.proveedor_icono }}
                className="h-4 w-4 shrink-0"
              />
              {recepcion.proveedor_nombre}
            </div>
          </div>
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Guía de despacho</p>
            <p className="font-mono font-semibold text-sm">{recepcion.guia_despacho ?? '—'}</p>
          </div>
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Registrado por</p>
            <p className="font-medium text-sm">{recepcion.usuario_nombre}</p>
          </div>
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Ítems</p>
            <p className="font-semibold text-sm">{detalle.length}</p>
          </div>
        </div>
        {nota && (
          <div className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-1">Nota</p>
            <p className="text-sm opacity-70">{nota}</p>
          </div>
        )}
      </div>

      {/* Aviso foto posterior */}
      {fotoEsPosterior && (
        <div role="alert" className="alert alert-info py-2 text-sm gap-2">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            Guía de despacho adjuntada después de la confirmación
            {foto_actualizada_at && (
              <span className="opacity-60 ml-1">· {formatDate(foto_actualizada_at)}</span>
            )}
          </span>
        </div>
      )}

      {/* Lightbox foto */}
      {fotoOpen && foto_documento && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setFotoOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -right-3 -top-3 btn btn-circle btn-sm btn-error z-10"
              onClick={() => setFotoOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <AuthenticatedUploadImage
              path={foto_documento}
              alt="Guía de despacho"
              className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
            />
          </div>
        </div>
      )}

      {/* ── Tabla de ítems ── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest opacity-35 mb-3 flex items-center gap-2">
          <Package className="h-3.5 w-3.5" />
          Ítems recibidos ({detalle.length})
        </h2>

        {detalle.length === 0 ? (
          <p className="text-sm opacity-40 text-center py-8">Sin ítems</p>
        ) : (
          <div className="rounded-xl border border-base-200 overflow-hidden">
            <table className="table table-sm w-full">
              <thead className="bg-base-200/60 text-xs uppercase tracking-wider">
                <tr>
                  <th className="font-semibold opacity-60">Producto</th>
                  <th className="font-semibold opacity-60">Lote</th>
                  <th className="font-semibold opacity-60">Vencimiento</th>
                  <th className="font-semibold opacity-60 text-right">Cantidad recibida</th>
                  <th className="font-semibold opacity-60">Área destino</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((item) => {
                  const days = daysUntil(item.fecha_vencimiento)
                  const isExpired = days !== null && days <= 0
                  const isSoon = days !== null && days > 0 && days <= 30
                  const qty = toNum(item.cantidad_unidades_base)
                  const qtyPres = toDecimal(item.cantidad_presentaciones)
                  const factor = toDecimal(item.factor_conversion_usado)
                  const qtyPresStr = qtyPres.toDecimalPlaces(2).toString()
                  const tienePresent = !factor.eq(1)

                  return (
                    <tr key={item.id} className="hover:bg-base-200/30 border-base-200/60">
                      <td className="font-medium text-sm">{item.producto_nombre}</td>
                      <td className="font-mono text-xs text-base-content/60">{item.numero_lote}</td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <span className={cn('text-xs font-medium', isExpired ? 'text-error' : isSoon ? 'text-warning' : '')}>
                            {item.fecha_vencimiento ? formatDate(item.fecha_vencimiento) : 'No aplica'}
                          </span>
                          {isExpired && <Badge variant="destructive" className="text-[10px] w-fit">Vencido</Badge>}
                          {isSoon && !isExpired && <Badge variant="warning" className="text-[10px] w-fit">{days}d</Badge>}
                        </div>
                      </td>
                      <td className="text-right">
                        {tienePresent ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-mono font-semibold text-sm">
                              {qtyPresStr} {item.presentacion_nombre}
                            </span>
                            <span className="text-xs text-base-content/40 font-mono">
                              = <CantidadConUnidad qty={qty} unidad={item.unidad_base_nombre} pluralUnidad={item.unidad_base_nombre_plural} />
                            </span>
                          </div>
                        ) : (
                          <span className="font-mono font-semibold text-sm">
                            <CantidadConUnidad qty={qty} unidad={item.unidad_base_nombre} pluralUnidad={item.unidad_base_nombre_plural} />
                          </span>
                        )}
                      </td>
                      <td className="text-sm text-base-content/60">{item.area_destino}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showQrScanner && (
        <QrScannerSession
          onItemsScanned={(items) => {
            notify.success(`${items.length} producto(s) escaneados`)
          }}
          onClose={() => setShowQrScanner(false)}
        />
      )}

      {printModalOpen && (
        <Dialog
          open={printModalOpen}
          onClose={() => setPrintModalOpen(false)}
          title="Reimprimir etiquetas"
        >
          <div className="mt-1 text-xs text-base-content/60 mb-4 font-medium">
            Configura el formato y cantidad de etiquetas para imprimir los lotes de esta recepción.
          </div>
          <LabelsSection
            lotesConfirmados={detalle.map(item => ({
              lote_id: item.lote_id,
              numero_lote: item.numero_lote,
              fecha_vencimiento: item.fecha_vencimiento ?? "",
              producto_nombre: item.producto_nombre,
              presentacion_nombre: item.presentacion_nombre,
              area_nombre: item.area_destino,
              // Preset = cantidad recibida (paquetes/ítems), editable antes de imprimir.
              cantidad_etiquetas: Math.max(1, Math.round(toNum(item.cantidad_presentaciones))),
            }))}
          />
          <div className="mt-4 border-t border-base-200 pt-3">
            <button
              className="btn btn-outline btn-sm w-full text-xs font-semibold py-2"
              onClick={() => setPrintModalOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

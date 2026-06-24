// frontend/src/pages/recepciones/nueva.tsx
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import { cn, APP_LOCALE } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { toNum } from '@/domain/parse'
import type { DecimalInput } from '@/domain/parse'
import { useAreas, useProveedores, useConfiguracion } from '@/hooks/dominio'
import { LabelsSection } from './components/labels-section'
import { LoteBottomSheet } from './components/lote-bottom-sheet'
import { ReconciliacionModal } from './components/ReconciliacionModal'
import { VincularSolicitudModal } from './components/VincularSolicitudModal'
import { DecisionSection } from './components/decision-section'
import { useRecepcionWizard } from './hooks/useRecepcionWizard'
import { useRecepcionItems } from './hooks/useRecepcionItems'
import { ProveedorStep } from './steps/ProveedorStep'
import { ItemsStep } from './steps/ItemsStep'
import { isCardComplete } from './components/item-card-utils'
import type { Producto } from '@/types'
import ImportadorGuiaModal from '@/components/shared/ImportadorGuiaModal'

interface SolicitudItemVinculada {
  proveedor_id?: number | null
  factor_conversion?: DecimalInput | null
  cantidad_presentaciones?: DecimalInput | null
  cantidad_sugerida: DecimalInput
  presentacion_id?: number | null
  producto_id: string
  producto_nombre: string
  unidad: string
  unidad_plural?: string | null
  presentacion_nombre?: string | null
  presentacion_nombre_plural?: string | null
}

function SectionTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        done ? 'bg-success text-success-content' : 'bg-primary text-primary-content'
      )}>
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <h2 className="text-base font-bold">{title}</h2>
    </div>
  )
}

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoLinkedRef = useRef(false)
  const wizard = useRecepcionWizard()

  const {
    proveedorId,
    guiaDespacho, guiaProvisoria,
    fechaRecepcion,
    decision, motivosSeleccionados, motivoOtro,
    nota, setNota,
    solicitudId, setSolicitudId, setSolicitudNumero,
    solicitudModal,
    solicitudesPendientes,
  } = wizard

  // ─── Queries ─────────────────────────────────────────────────────────────────

  const { data: areas } = useAreas()
  const { data: proveedores } = useProveedores()
  const { data: configuracion } = useConfiguracion()
  const monedaSimbolo = configuracion?.moneda_simbolo ?? '$'

  const { data: productos } = useQuery({
    queryKey: ['productos-recepcion', proveedorId],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', {
      params: { per_page: 500, ...(proveedorId ? { proveedor_id: proveedorId } : {}) },
    }).then(r => r.data.data),
  })

  // ─── Items hook ───────────────────────────────────────────────────────────────

  const [importModalOpen, setImportModalOpen] = useState(false)

  const items = useRecepcionItems({
    proveedorId,
    proveedores,
    productos,
    areas,
    monedaSimbolo,
    solicitudId,
    setSolicitudId,
    solicitudNumero: wizard.solicitudNumero,
    guiaDespacho,
    guiaProvisoria,
    fechaRecepcion,
    decision,
    motivosSeleccionados,
    motivoOtro,
    nota,
    fotoGuia: wizard.fotoGuia,
  })

  const {
    detalles,
    setDetalles,
    pendingScan,
    handleConfirmLote,
    handleCancelLote,
    lotesConfirmados,
    printModal,
    reconciliacionModal,
    solicitudItemsRef,
    setSolicitudItemsRef,
    pendingConfirmarPayload,
    setPendingConfirmarPayload,
    confirmarMutation,
    addProducto,
  } = items

  const itemsCompletos = detalles.filter(isCardComplete).length

  // Drives the soft pulse on the primary CTA.
  const ctaReady = !confirmarMutation.isPending && (
    decision === 'rechazada'
      ? !!proveedorId
      : !!proveedorId && detalles.length > 0 && itemsCompletos === detalles.length
  )

  const confirmLabel =
    decision === 'rechazada' ? 'Registrar rechazo' :
    decision === 'parcial' ? 'Confirmar recepción parcial' :
    'Confirmar recepción'

  const estadoInfo = {
    completa:  { label: 'Conforme', cls: 'badge-success' },
    parcial:   { label: 'Parcial', cls: 'badge-info' },
    rechazada: { label: 'Rechazada', cls: 'badge-error' },
  }[decision]

  const proveedorNombre = proveedores?.find(p => p.id === proveedorId)?.nombre ?? null
  const guiaResumen = guiaDespacho || (guiaProvisoria ? 'Provisorio' : 'Sin guía')

  // ─── Vincular solicitud ───────────────────────────────────────────────────────

  const handleVincularSolicitud = async (id: string, numero: string, silent = false) => {
    try {
      const res = await api.get(`/solicitudes-compra/${id}`)
      setSolicitudId(id)
      setSolicitudNumero(numero || res.data.numero_documento || id)
      solicitudModal.onClose()
      if (!silent) notify.success('Solicitud vinculada')
      const itemsProveedor = ((res.data.items ?? []) as SolicitudItemVinculada[]).filter((it) =>
        !proveedorId || it.proveedor_id === proveedorId
      )
      setSolicitudItemsRef(
        itemsProveedor.map((it) => {
          const factor = it.factor_conversion ? toNum(it.factor_conversion) : 1
          const cantPres = it.cantidad_presentaciones ? toNum(it.cantidad_presentaciones) : null
          const cantSugerida = toNum(it.cantidad_sugerida)
          const hasPres = !!(it.presentacion_id && factor > 1)
          const qtyBase = hasPres
            ? (cantPres ?? cantSugerida) * factor
            : cantSugerida
          return {
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre,
            cantidad_base: qtyBase,
            unidad: it.unidad,
            unidad_plural: it.unidad_plural,
            presentacion_id: it.presentacion_id,
            presentacion_nombre: it.presentacion_nombre,
            presentacion_nombre_plural: it.presentacion_nombre_plural,
            factor_conversion: factor,
            cantidad_presentaciones: cantPres ?? (hasPres ? cantSugerida : null),
          }
        })
      )
      for (const item of itemsProveedor) {
        try {
          const p = productos?.find((x: Producto) => String(x.id) === String(item.producto_id))
          if (p) {
            const qty = item.cantidad_presentaciones
              ? toNum(item.cantidad_presentaciones)
              : item.cantidad_sugerida
                ? toNum(item.cantidad_sugerida)
                : undefined
            await addProducto(p, item.presentacion_id ?? undefined, qty)
          }
        } catch (e) {
          notify.error('Error cargando producto: ' + (e instanceof Error ? e.message : String(e)))
        }
      }
    } catch (e) {
      notify.error('Error al vincular solicitud: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // ─── Auto-vincular desde URL params ──────────────────────────────────────────

  const sqIdParam = searchParams.get('solicitud_id')
  const pIdParam = searchParams.get('proveedor_id')
  const prodIdParam = searchParams.get('producto_id')
  const autoAddProductoRef = useRef(false)

  useEffect(() => {
    if (pIdParam) wizard.setProveedorId(parseInt(pIdParam))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sqIdParam || autoLinkedRef.current || !productos) return
    if (pIdParam && wizard.proveedorId !== parseInt(pIdParam)) return
    autoLinkedRef.current = true
    void handleVincularSolicitud(sqIdParam, '', true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, wizard.proveedorId])

  useEffect(() => {
    if (!prodIdParam || autoAddProductoRef.current || !productos) return
    if (pIdParam && wizard.proveedorId !== parseInt(pIdParam)) return
    const prod = productos.find((p) => String(p.id) === prodIdParam)
    if (!prod) return
    autoAddProductoRef.current = true
    void addProducto(prod)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, wizard.proveedorId])

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* ── Header sticky / statusbar del documento ── */}
      <header className="sticky top-0 z-30 bg-base-100/95 backdrop-blur border-b border-base-200">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="t-h1 truncate">Nueva recepción</h1>
            <span className={cn('badge badge-sm shrink-0', estadoInfo.cls)}>{estadoInfo.label}</span>
          </div>
        </div>
        {/* Contexto compacto del documento */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-2 text-xs text-base-content/60">
          <span><span className="opacity-50">Proveedor:</span> <strong className="text-base-content">{proveedorNombre ?? '—'}</strong></span>
          <span><span className="opacity-50">Guía:</span> <strong className="text-base-content">{guiaResumen}</strong></span>
          <span>{new Date(fechaRecepcion).toLocaleDateString(APP_LOCALE, { dateStyle: 'short' })}</span>
          {detalles.length > 0 && (
            <span className={cn('font-semibold ml-auto', itemsCompletos === detalles.length ? 'text-success' : 'text-warning')}>
              {itemsCompletos}/{detalles.length} ítems listos
            </span>
          )}
        </div>
      </header>

      {/* ── Layout de documento: lectura natural 1 → 2 → 3 ── */}
      <div className="max-w-3xl mx-auto p-4 space-y-6">
        <section className="space-y-3">
          <SectionTitle n={1} title="Proveedor y guía" done={!!proveedorId && (!!guiaDespacho || guiaProvisoria)} />
          <ProveedorStep wizard={wizard} proveedores={proveedores} onVincularClick={solicitudModal.onOpen} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle n={2} title="Ítems y lotes" done={detalles.length > 0 && itemsCompletos === detalles.length} />
            {proveedorId && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs font-semibold"
                onClick={() => setImportModalOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Importar Guía (PDF)
              </Button>
            )}
          </div>
          <ItemsStep wizard={wizard} items={items} productos={productos} areas={areas} monedaSimbolo={monedaSimbolo} />
        </section>

        <section className="space-y-3">
          <SectionTitle n={3} title="Decisión de recepción" />
          <div className="card bg-base-100 border p-4">
            <DecisionSection wizard={wizard} />
          </div>
        </section>
      </div>

      {/* Acción primaria — siempre visible */}
      <div className="sticky bottom-0 z-20 mt-4 px-4 py-3 bg-base-100/95 backdrop-blur border-t border-base-200 flex sm:justify-end">
        <button
          onClick={items.handleConfirmar}
          disabled={items.confirmarMutation.isPending}
          className={cn(
            'btn flex-1 sm:flex-none sm:min-w-60',
            decision === 'rechazada' ? 'btn-error' : 'btn-primary',
            ctaReady && 'pulse-cta',
          )}
        >
          {items.confirmarMutation.isPending
            ? <span className="loading loading-spinner loading-sm" />
            : confirmLabel}
        </button>
      </div>

      {/* Bottom sheet datos de lote */}
      <LoteBottomSheet
        open={pendingScan !== null}
        productoNombre={pendingScan?.productoNombre ?? ''}
        prefillNumeroLote={pendingScan?.prefillNumeroLote}
        onConfirm={handleConfirmLote}
        onCancel={handleCancelLote}
      />

      {/* Modal vincular solicitud */}
      <VincularSolicitudModal
        open={solicitudModal.open}
        onClose={solicitudModal.onClose}
        solicitudes={solicitudesPendientes}
        solicitudIdActual={solicitudId}
        onVincular={handleVincularSolicitud}
        onDesvincular={() => { setSolicitudId(null); setSolicitudNumero(null) }}
      />

      {/* Modal reconciliación post-recepción */}
      <ReconciliacionModal
        open={reconciliacionModal.open}
        onClose={() => { reconciliacionModal.onClose(); setPendingConfirmarPayload(null) }}
        solicitudItems={solicitudItemsRef}
        detalles={detalles}
        onConfirmar={(payload) => {
          reconciliacionModal.onClose()
          confirmarMutation.mutate({ ...(payload as Record<string, unknown>), nota: nota || undefined })
          setPendingConfirmarPayload(null)
        }}
        pendingPayload={pendingConfirmarPayload}
        nota={nota}
        onNotaChange={setNota}
      />

      {/* Modal imprimir etiquetas post-confirmación */}
      <Dialog
        open={printModal.open}
        onClose={() => { printModal.onClose(); navigate('/recepciones') }}
        title="Imprimir etiquetas de insumos"
      >
        {lotesConfirmados && (
          <LabelsSection lotesConfirmados={lotesConfirmados} />
        )}
        <div className="mt-4 border-t border-base-200 pt-3">
          <Button
            variant="outline"
            className="w-full font-semibold text-xs py-2"
            onClick={() => { printModal.onClose(); navigate('/recepciones') }}
          >
            Finalizar y volver a Recepciones
          </Button>
        </div>
      </Dialog>

      <ImportadorGuiaModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        proveedorId={proveedorId}
        onImport={(importedItems) => {
          setDetalles(prev => [...importedItems, ...prev])
        }}
      />
    </div>
  )
}

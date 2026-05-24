// frontend/src/pages/recepciones/nueva.tsx
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useRef, useEffect } from 'react'
import { ArrowLeft, Layers } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { toNum } from '@/domain/parse'
import { imprimirEtiquetas } from '@/lib/label-print'
import { useAreas, useProveedores, useConfiguracion } from '@/hooks/dominio'
import { LabelsSection } from './components/labels-section'
import { LoteBottomSheet } from './components/lote-bottom-sheet'
import { ReconciliacionModal } from './components/ReconciliacionModal'
import { VincularSolicitudModal } from './components/VincularSolicitudModal'
import { WizardSteps } from './components/wizard-steps'
import { useRecepcionWizard } from './hooks/useRecepcionWizard'
import { useRecepcionItems } from './hooks/useRecepcionItems'
import { ProveedorStep } from './steps/ProveedorStep'
import { ItemsStep } from './steps/ItemsStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { isCardComplete } from './components/item-card-utils'
import type { Producto } from '@/types'

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoLinkedRef = useRef(false)
  const wizard = useRecepcionWizard()

  const {
    pasoActual, setPasoActual,
    modoExperto, setModoExperto,
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
    setPasoActual,
  })

  const {
    detalles,
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

  // ─── Vincular solicitud ───────────────────────────────────────────────────────

  const handleVincularSolicitud = async (id: string, numero: string, silent = false) => {
    try {
      const res = await api.get(`/solicitudes-compra/${id}`)
      setSolicitudId(id)
      setSolicitudNumero(numero || res.data.numero_documento || id)
      solicitudModal.onClose()
      if (!silent) notify.success('Solicitud vinculada')
      const itemsProveedor = (res.data.items ?? []).filter((it: { proveedor_id?: number | null }) =>
        !proveedorId || it.proveedor_id === proveedorId
      )
      setSolicitudItemsRef(
        itemsProveedor.map((it: any) => {
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

  useEffect(() => {
    if (pIdParam) wizard.setProveedorId(parseInt(pIdParam))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!sqIdParam || autoLinkedRef.current || !productos) return
    if (pIdParam && wizard.proveedorId !== parseInt(pIdParam)) return
    autoLinkedRef.current = true
    handleVincularSolicitud(sqIdParam, '', true).then(() => {
      setPasoActual(2)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, wizard.proveedorId])

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4 pb-20 lg:pb-4">
      {/* Header + Wizard */}
      <div className="flex flex-col gap-4 mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="t-h1">Nueva Recepción</h1>
          </div>
          <button
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all',
              modoExperto ? 'bg-primary/10 text-primary border-primary/30' : 'border-base-300 opacity-60 hover:opacity-90'
            )}
            title="Modo experto: todos los paneles visibles a la vez, sin asistente paso a paso"
            onClick={() => setModoExperto(!modoExperto)}
          >
            <Layers className="h-3.5 w-3.5" />
            {modoExperto ? 'Modo experto activo' : 'Modo experto'}
          </button>
        </div>

        {!modoExperto && (
          <WizardSteps
            pasoActual={pasoActual}
            proveedorId={proveedorId}
            detallesCount={detalles.length}
            itemsCompletos={itemsCompletos}
            onStepClick={setPasoActual}
          />
        )}
      </div>

      {/* Layout B+C */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Panel izquierdo ── */}
        <div className={cn('w-full lg:w-72 lg:sticky lg:top-4 space-y-4', !modoExperto && pasoActual === 2 && 'hidden lg:hidden')}>
          {(modoExperto || pasoActual === 1) && (
            <ProveedorStep
              wizard={wizard}
              proveedores={proveedores}
              onVincularClick={solicitudModal.onOpen}
            />
          )}
          {(modoExperto || pasoActual === 3) && (
            <ConfirmStep wizard={wizard} items={items} />
          )}
        </div>

        {/* ── Panel derecho ── */}
        <div className={cn('flex-1 min-w-0 space-y-4', !modoExperto && pasoActual === 1 && 'hidden', !modoExperto && pasoActual === 3 && 'hidden')}>
          <ItemsStep
            wizard={wizard}
            items={items}
            productos={productos}
            areas={areas}
            monedaSimbolo={monedaSimbolo}
          />
        </div>
      </div>

      {/* Barra de navegación sticky — solo mobile, solo modo wizard */}
      {!modoExperto && (
        <div className="fixed bottom-0 left-0 right-0 lg:hidden z-20 bg-base-100 border-t border-base-200 px-4 py-3 flex gap-3">
          <button
            disabled={pasoActual === 1}
            onClick={() => setPasoActual(p => (p - 1) as 1 | 2 | 3)}
            className="btn btn-ghost flex-1"
          >
            ← Anterior
          </button>
          {pasoActual < 3 ? (
            <button
              disabled={pasoActual === 1 && !proveedorId}
              onClick={() => setPasoActual(p => (p + 1) as 1 | 2 | 3)}
              className="btn btn-primary flex-1"
            >
              Siguiente →
            </button>
          ) : (
            <button
              onClick={items.handleConfirmar}
              disabled={items.confirmarMutation.isPending}
              className="btn btn-primary flex-1"
            >
              {items.confirmarMutation.isPending
                ? <span className="loading loading-spinner loading-sm" />
                : 'Confirmar recepción'}
            </button>
          )}
        </div>
      )}

      {/* Bottom sheet datos de lote */}
      <LoteBottomSheet
        open={pendingScan !== null}
        productoNombre={pendingScan?.productoNombre ?? ''}
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

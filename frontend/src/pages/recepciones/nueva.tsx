// frontend/src/pages/recepciones/nueva.tsx
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Layers } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { imprimirEtiquetas } from '@/lib/label-print'
import { LabelsSection } from './components/labels-section'
import { LoteBottomSheet } from './components/lote-bottom-sheet'
import { ReconciliacionModal } from './components/ReconciliacionModal'
import { VincularSolicitudModal } from './components/VincularSolicitudModal'
import { useRecepcionWizard } from './hooks/useRecepcionWizard'
import { useRecepcionItems } from './hooks/useRecepcionItems'
import { ProveedorStep } from './steps/ProveedorStep'
import { ItemsStep } from './steps/ItemsStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { isCardComplete } from './components/item-card-utils'
import type { Area, Proveedor, Producto } from '@/types'

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
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
      params: { per_page: 500, ...(proveedorId ? { proveedor_id: proveedorId } : {}) },
    }).then(r => r.data.data),
  })

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ moneda_simbolo: string }>('/configuracion').then(r => r.data),
  })
  const monedaSimbolo = configuracion?.moneda_simbolo ?? '$'

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

  const handleVincularSolicitud = async (id: string, numero: string) => {
    try {
      const res = await api.get(`/solicitudes-compra/${id}`)
      setSolicitudId(id)
      setSolicitudNumero(numero)
      solicitudModal.onClose()
      notify.success('Solicitud vinculada')
      const itemsProveedor = (res.data.items ?? []).filter((it: { proveedor_id?: number | null }) =>
        !proveedorId || it.proveedor_id === proveedorId
      )
      setSolicitudItemsRef(
        itemsProveedor.map((it: { producto_id: string; producto_nombre: string; cantidad_sugerida: string; unidad: string }) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          cantidad_base: parseFloat(it.cantidad_sugerida) || 0,
          unidad: it.unidad,
        }))
      )
      for (const item of itemsProveedor) {
        try {
          const p = productos?.find((x: Producto) => String(x.id) === String(item.producto_id))
          if (p) {
            const qty = item.cantidad_presentaciones
              ? Number(item.cantidad_presentaciones)
              : item.cantidad_sugerida
                ? Number(item.cantidad_sugerida)
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

  // ─── Render ───────────────────────────────────────────────────────────────────

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
            onClick={() => setModoExperto(!modoExperto)}
          >
            <Layers className="h-3.5 w-3.5" />
            {modoExperto ? 'Modo experto activo' : 'Modo experto'}
          </button>
        </div>

        {/* Steps indicator */}
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

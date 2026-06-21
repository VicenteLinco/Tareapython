// frontend/src/pages/solicitudes-compra/index.tsx
import { useState } from 'react'
import { ShoppingCart, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSolicitudState } from './hooks/useSolicitudState'
import { SolicitudStepper } from './components/solicitud-stepper'
import { ProveedorGallery } from './components/proveedor-gallery'
import { QuiebresPanelIzquierdo } from './components/quiebres-panel'
import { PedidoPanel } from './components/pedido-panel'
import { HistorialView } from './components/historial-view'
import { DetalleModal } from './components/detalle-modal'
import { RevisionView } from './components/revision-view'
import { ProveedorBanner } from './components/proveedor-banner'

export default function SolicitudesCompraPage() {
  const s = useSolicitudState()
  const [proveedoresPreseleccionados, setProveedoresPreseleccionados] = useState<number[]>([])

  const toggleProveedorPreseleccionado = (id: number) => {
    setProveedoresPreseleccionados(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const continuarConProveedores = () => {
    for (const id of proveedoresPreseleccionados) {
      const proveedor = s.proveedores?.find(p => p.id === id)
      if (proveedor) s.handleAgregarProveedorFiltro(proveedor)
    }
    setProveedoresPreseleccionados([])
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-6 p-2">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="t-h1 flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Solicitudes de Compra
          </h1>
          <p className="text-sm opacity-50">Gestiona tus pedidos y revisa recomendaciones basadas en stock</p>
        </div>
        <button
          className={cn(
            "btn btn-sm gap-2 rounded-xl self-start",
            s.view === 'historial' ? "btn-primary" : "btn-ghost border border-base-300",
          )}
          onClick={() => s.setView(s.view === 'historial' ? 'crear' : 'historial')}
        >
          <History className="h-4 w-4" /> {s.view === 'historial' ? 'Volver a crear' : 'Historial'}
        </button>
      </div>

      {/* Stepper — guía visual del flujo de creación */}
      {s.view === 'crear' && !s.restaurando && (
        <SolicitudStepper
          modoRevision={s.modoRevision}
          hayProveedorSeleccionado={s.selectedProveedor !== null}
          proveedoresCount={s.proveedoresFiltro?.length ?? 0}
          itemsCount={s.items.length}
          onModoChange={s.setModo}
        />
      )}

      {/* Cuerpo */}
      {s.view === 'crear' && s.restaurando ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
          <div className="bg-base-200/60 rounded-[2rem]" />
          <div className="flex flex-col gap-3">
            <div className="h-16 bg-base-200/60 rounded-2xl" />
            <div className="flex-1 bg-base-200/60 rounded-[2.5rem]" />
          </div>
        </div>
      ) : s.view === 'crear' && s.modoRevision ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-0 overflow-y-auto">
          <div className="overflow-y-auto custom-scrollbar pr-1">
            <RevisionView
              recomendaciones={s.recomendaciones ?? []}
              isLoading={s.isLoadingRecs}
              itemsEnPedido={s.items}
              descartados={s.descartados}
              onAceptarConCantidad={s.handleAddFromRecConCantidad}
              onUpdateQty={s.handleUpdateQty}
              onRemove={s.handleRemove}
              onDescartar={s.handleDescartar}
              onRestaurar={s.handleRestaurar}
              onCambiarAAvanzado={() => s.setModo(false)}
            />
          </div>
          {s.items.length > 0 && (
            <div className="overflow-y-auto custom-scrollbar">
              <PedidoPanel
                proveedor={s.selectedProveedor}
                items={s.items}
                itemsByProveedor={s.itemsByProveedor}
                totalGeneral={s.totalGeneral}
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
                onUpdatePrecio={s.handleUpdatePrecio}
                onRemove={s.handleRemove}
                onGlobalHorizonteChange={s.handleGlobalHorizonteChange}
                onHorizonteChip={s.handleHorizonteChip}
                onResetHorizonteToGlobal={s.handleResetHorizonteToGlobal}
                onPopoverToggle={s.setPopoverOpenId}
                onSaveBorrador={s.handleSaveBorrador}
                onGuardar={() => s.guardarMutation.mutate()}
              />
            </div>
          )}
        </div>
      ) : s.view === 'crear' ? (
        s.selectedProveedor === null ? (
          <ProveedorGallery
            proveedores={s.proveedores}
            isLoading={s.isLoadingProveedores}
            urgenciasByProveedor={s.urgenciasByProveedor}
            vencimientoByProveedor={s.vencimientoByProveedor}
            diasVencimiento={s.diasVencimiento}
            onDiasVencimientoChange={s.setDiasVencimiento}
            logoBase64={s.configuracion?.logo_base64}
            selectedIds={proveedoresPreseleccionados}
            onSelect={p => toggleProveedorPreseleccionado(p.id)}
            onContinue={continuarConProveedores}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <ProveedorBanner
              proveedores={s.proveedoresFiltro}
              disponibles={s.proveedores ?? []}
              quiebresCount={s.recsFiltered.length}
              onQuitar={s.handleQuitarProveedorFiltro}
              onAgregar={s.handleAgregarProveedorFiltro}
              onLimpiar={s.handleLimpiarFiltros}
            />
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4 min-h-0">
              <QuiebresPanelIzquierdo
                selectedProveedor={s.selectedProveedor}
                recsByProveedor={s.recsByProveedor}
                isLoadingRecs={s.isLoadingRecs}
                itemsEnPedido={s.items}
                tab={s.tabIzquierdo}
                monedaCodigo={s.monedaCodigo}
                onTabChange={s.setTabIzquierdo}
                onAddFromRec={s.handleAddFromRec}
                onAddFromSearch={s.handleAddFromSearch}
              />
              <PedidoPanel
                proveedor={s.selectedProveedor}
                items={s.items}
                itemsByProveedor={s.itemsByProveedor}
                totalGeneral={s.totalGeneral}
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
                onUpdatePrecio={s.handleUpdatePrecio}
                onRemove={s.handleRemove}
                onGlobalHorizonteChange={s.handleGlobalHorizonteChange}
                onHorizonteChip={s.handleHorizonteChip}
                onResetHorizonteToGlobal={s.handleResetHorizonteToGlobal}
                onPopoverToggle={s.setPopoverOpenId}
                onSaveBorrador={s.handleSaveBorrador}
                onGuardar={() => s.guardarMutation.mutate()}
              />
            </div>
          </div>
        )
      ) : (
        <HistorialView
          solicitudes={s.historial?.data}
          isLoading={s.isLoadingHistorial}
          search={s.historialSearch}
          onSearchChange={s.setHistorialSearch}
          onSelectSolicitud={s.setSelectedSolicitudId}
          estado={s.historialEstado}
          onEstadoChange={s.setHistorialEstado}
        />
      )}

      <DetalleModal
        solicitudId={s.selectedSolicitudId}
        detail={s.detail}
        isLoading={s.isLoadingDetail}
        pdfFirmaLabel={s.pdfFirmaLabel}
        monedaCodigo={s.monedaCodigo}
        monedaSimbolo={s.configuracion?.moneda_simbolo ?? '$'}
        nombreLaboratorio={s.configuracion?.nombre_laboratorio ?? 'Laboratorio Clínico'}
        logoBase64={s.configuracion?.logo_base64}
        onClose={() => { s.setSelectedSolicitudId(null); s.setPdfFirmaLabel('') }}
        onPdfFirmaChange={s.setPdfFirmaLabel}
      />
    </div>
  )
}

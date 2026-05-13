// frontend/src/pages/solicitudes-compra/index.tsx
import { ShoppingCart, Plus, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSolicitudState } from './hooks/useSolicitudState'
import { ProveedorGallery } from './components/proveedor-gallery'
import { QuiebresPanelIzquierdo } from './components/quiebres-panel'
import { PedidoPanel } from './components/pedido-panel'
import { HistorialView } from './components/historial-view'
import { DetalleModal } from './components/detalle-modal'
import { RevisionView } from './components/revision-view'
import { ProveedorBanner } from './components/proveedor-banner'

export default function SolicitudesCompraPage() {
  const s = useSolicitudState()

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-6 p-2">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Solicitudes de Compra
          </h1>
          <p className="text-sm opacity-50">Gestiona tus pedidos y revisa recomendaciones basadas en stock</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {s.view === 'crear' && (
            <div className="tabs tabs-boxed bg-base-200 p-1 rounded-xl self-start">
              <button
                className={cn("tab gap-1.5 rounded-lg transition-all px-4 h-8 text-xs font-bold", s.modoRevision ? "tab-active bg-base-100 shadow-sm" : "opacity-50 hover:opacity-80")}
                onClick={() => s.setModo(true)}
              >
                Revisión
              </button>
              <button
                className={cn("tab gap-1.5 rounded-lg transition-all px-4 h-8 text-xs font-bold", !s.modoRevision ? "tab-active bg-base-100 shadow-sm" : "opacity-50 hover:opacity-80")}
                onClick={() => s.setModo(false)}
              >
                Avanzado
              </button>
            </div>
          )}
          <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl self-start">
            <button
              className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", s.view === 'crear' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
              onClick={() => s.setView('crear')}
            >
              <Plus className="h-4 w-4" /> Nueva
            </button>
            <button
              className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", s.view === 'historial' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
              onClick={() => s.setView('historial')}
            >
              <History className="h-4 w-4" /> Historial
            </button>
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      {s.view === 'crear' && s.restaurando ? (
        <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
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
              horizonteGlobal={s.horizonteGlobal}
              onAceptar={s.handleAddFromRec}
              onAceptarConCantidad={s.handleAddFromRecConCantidad}
              onDescartar={s.handleDescartar}
              onRestaurar={s.handleRestaurar}
              onCambiarAAvanzado={() => s.setModo(false)}
            />
          </div>
          {s.items.length > 0 && s.selectedProveedor && (
            <div className="overflow-y-auto custom-scrollbar">
              <PedidoPanel
                proveedor={s.selectedProveedor}
                items={s.items}
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
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
            logoBase64={s.configuracion?.logo_base64}
            onSelect={s.handleSelectProveedor}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <ProveedorBanner
              proveedor={s.selectedProveedor}
              quiebresCount={s.recsFiltered.length}
              onCambiar={s.handleCambiarProveedor}
            />
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4 min-h-0">
              <QuiebresPanelIzquierdo
                proveedor={s.selectedProveedor}
                recomendaciones={s.recsFiltered}
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
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
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

// frontend/src/pages/recepciones/steps/ProveedorStep.tsx
import { ShoppingCart, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import type { Proveedor } from '@/types'
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'

interface Props {
  wizard: RecepcionWizardReturn
  proveedores: Proveedor[] | undefined
  onVincularClick: () => void
}

export function ProveedorStep({ wizard, proveedores, onVincularClick }: Props) {
  const {
    proveedorId, setProveedorId, proveedorError, setProveedorError, proveedorRef,
    guiaDespacho, setGuiaDespacho,
    guiaProvisoria, setGuiaProvisoria,
    fechaRecepcion, setFechaRecepcion,
    fechaExpanded, setFechaExpanded,
    solicitudId, setSolicitudId, setSolicitudNumero, solicitudNumero,
    setPasoActual,
  } = wizard

  return (
    <div className="space-y-4">
      {/* Datos guía */}
      <div className="card bg-base-100 border p-4 space-y-3">
        <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">Guía de Despacho</h2>

        <div ref={proveedorRef}>
          <label className="label py-0.5">
            <span className={cn('label-text text-xs transition-colors', proveedorError && 'text-error font-semibold')}>
              {proveedorError ? '⚠ Selecciona un proveedor primero' : 'Proveedor *'}
            </span>
          </label>
          <div className={proveedorError ? 'animate-shake ring-2 ring-error rounded-lg' : ''}>
            <ProveedorSelect
              value={proveedorId || ''}
              onChange={v => { setProveedorId(v ? Number(v) : null); setProveedorError(false) }}
              proveedores={proveedores || []}
              searchable
            />
          </div>
        </div>

        <div>
          <label className="label py-0.5">
            <span className="label-text text-xs">Nº Guía de Despacho *</span>
          </label>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={guiaProvisoria}
              onChange={e => {
                setGuiaProvisoria(e.target.checked)
                if (e.target.checked) setGuiaDespacho('')
              }}
            />
            <span className="text-xs opacity-60">Sin guía — usar número provisorio</span>
          </label>
          {!guiaProvisoria && (
            <input
              className="input input-sm input-bordered w-full"
              placeholder="GD-00000"
              value={guiaDespacho}
              onChange={e => setGuiaDespacho(e.target.value)}
            />
          )}
        </div>

        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs opacity-50 hover:opacity-70 transition-opacity mb-1 w-full text-left"
            onClick={() => setFechaExpanded(v => !v)}
          >
            <span>{new Date(fechaRecepcion).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            <span className="underline underline-offset-2 text-[10px]">{fechaExpanded ? 'Cerrar' : 'Cambiar'}</span>
          </button>
          {fechaExpanded && (
            <input
              type="datetime-local"
              className="input input-bordered input-sm w-full"
              value={fechaRecepcion}
              onChange={e => setFechaRecepcion(e.target.value)}
            />
          )}
        </div>

        {solicitudId ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-success font-medium flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" /> {solicitudNumero ?? 'Solicitud'} vinculada ✓
            </span>
            <button
              className="btn btn-xs btn-ghost btn-circle text-error"
              title="Desvincular solicitud"
              onClick={() => { setSolicitudId(null); setSolicitudNumero(null) }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            className="btn btn-sm btn-ghost btn-outline w-full border-dashed"
            onClick={() => {
              if (!proveedorId) {
                setProveedorError(true)
                setTimeout(() => setProveedorError(false), 1500)
                proveedorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                return
              }
              onVincularClick()
            }}
          >
            <ShoppingCart className="h-4 w-4 mr-1" />
            Vincular solicitud (opcional)
          </button>
        )}
      </div>

      {/* Botón siguiente */}
      <button
        className="btn btn-primary w-full rounded-xl"
        disabled={!proveedorId}
        onClick={() => {
          if (!proveedorId) { setProveedorError(true); setTimeout(() => setProveedorError(false), 1500); return }
          setPasoActual(2)
        }}
      >
        Siguiente: Agregar ítems →
      </button>
    </div>
  )
}

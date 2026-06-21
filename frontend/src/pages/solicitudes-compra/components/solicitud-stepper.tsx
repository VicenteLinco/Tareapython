import { cn } from '@/lib/utils'

type StepState = 'active' | 'done' | 'pending' | 'skip'

interface SolicitudStepperProps {
  modoRevision: boolean
  hayProveedorSeleccionado: boolean
  proveedoresCount: number
  itemsCount: number
  onModoChange: (sugeridos: boolean) => void
}

function StepCircle({ n, state }: { n: number; state: StepState }) {
  return (
    <div
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
        state === 'active' && 'border-primary bg-primary text-primary-content',
        state === 'done' && 'border-success bg-success text-success-content',
        state === 'pending' && 'border-base-300 bg-base-100 text-base-content/40',
        state === 'skip' && 'border-base-200 bg-base-200 text-base-content/30',
      )}
    >
      {state === 'done' ? '✓' : n}
    </div>
  )
}

/**
 * Step indicator for the purchase-request builder. Adapts to both modes:
 * in "Sugeridos" the provider step is marked "no aplica"; in "Por proveedor"
 * it is an actual step (active -> done) before reaching products.
 */
export function SolicitudStepper({
  modoRevision,
  hayProveedorSeleccionado,
  proveedoresCount,
  itemsCount,
  onModoChange,
}: SolicitudStepperProps) {
  const step2: StepState = modoRevision
    ? 'skip'
    : hayProveedorSeleccionado
      ? 'done'
      : 'active'
  const enProductos = modoRevision || hayProveedorSeleccionado
  const step3: StepState = enProductos ? 'active' : 'pending'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-base-200 bg-base-100 p-3 shadow-sm">
      {/* Paso 1 — Modo */}
      <div className="flex items-center gap-2">
        <StepCircle n={1} state="done" />
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
            Paso 1 · Modo
          </span>
          <div className="tabs tabs-boxed mt-0.5 rounded-lg bg-base-200 p-0.5">
            <button
              className={cn(
                'tab tab-xs rounded-md px-3 text-xs font-bold',
                modoRevision ? 'tab-active bg-base-100 shadow-sm' : 'opacity-50 hover:opacity-80',
              )}
              onClick={() => onModoChange(true)}
            >
              Sugeridos
            </button>
            <button
              className={cn(
                'tab tab-xs rounded-md px-3 text-xs font-bold',
                !modoRevision ? 'tab-active bg-base-100 shadow-sm' : 'opacity-50 hover:opacity-80',
              )}
              onClick={() => onModoChange(false)}
            >
              Por proveedor
            </button>
          </div>
        </div>
      </div>

      <div className="hidden h-px w-6 bg-base-300 sm:block" />

      {/* Paso 2 — Proveedores */}
      <div className={cn('flex items-center gap-2', step2 === 'skip' && 'opacity-50')}>
        <StepCircle n={2} state={step2} />
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
            Paso 2 · Proveedores
          </span>
          <span className="text-xs text-base-content/70">
            {step2 === 'skip'
              ? 'No aplica en Sugeridos'
              : step2 === 'done'
                ? `${proveedoresCount} seleccionado${proveedoresCount === 1 ? '' : 's'}`
                : 'Elegí uno o más'}
          </span>
        </div>
      </div>

      <div className="hidden h-px w-6 bg-base-300 sm:block" />

      {/* Paso 3 — Productos */}
      <div className={cn('flex items-center gap-2', step3 === 'pending' && 'opacity-50')}>
        <StepCircle n={3} state={step3} />
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
            Paso 3 · Productos
          </span>
          <span className="text-xs text-base-content/70">
            {itemsCount > 0 ? `${itemsCount} en el pedido` : 'Agregá productos'}
          </span>
        </div>
      </div>
    </div>
  )
}

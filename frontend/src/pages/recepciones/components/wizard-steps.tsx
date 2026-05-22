// frontend/src/pages/recepciones/components/wizard-steps.tsx
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WizardStepsProps {
  pasoActual: 1 | 2 | 3
  proveedorId: number | null
  detallesCount: number
  itemsCompletos: number
  onStepClick: (paso: 1 | 2 | 3) => void
}

export function WizardSteps({ pasoActual, proveedorId, detallesCount, itemsCompletos, onStepClick }: WizardStepsProps) {
  const steps = [
    { n: 1 as const, label: 'Proveedor', ok: !!proveedorId },
    { n: 2 as const, label: 'Ítems y lotes', ok: detallesCount > 0 && itemsCompletos === detallesCount },
    { n: 3 as const, label: 'Confirmar', ok: false },
  ]

  return (
    <div className="flex items-center gap-0 bg-base-100 rounded-2xl border border-base-200 p-3">
      {steps.map((step, idx) => (
        <div key={step.n} className="flex items-center flex-1 min-w-0">
          <button
            className={cn(
              'flex items-center gap-2 min-w-0 flex-1',
              pasoActual === step.n ? 'opacity-100' : step.ok ? 'opacity-70' : 'opacity-30'
            )}
            onClick={() => {
              if (step.n <= pasoActual || step.ok) onStepClick(step.n)
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
  )
}

// frontend/src/pages/recepciones/components/decision-section.tsx
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'

type Decision = 'completa' | 'parcial' | 'rechazada'

const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: 'Cadena de frío rota' },
  { id: 'embalaje', label: 'Embalaje dañado' },
  { id: 'documentos', label: 'Documentos incorrectos' },
  { id: 'cantidad', label: 'Cantidad no coincide' },
  { id: 'no_solicitado', label: 'Producto no solicitado' },
]

interface Props {
  wizard: RecepcionWizardReturn
}

export function DecisionSection({ wizard }: Props) {
  const {
    decision, setDecision,
    motivosSeleccionados, setMotivosSeleccionados,
    motivoOtro, setMotivoOtro,
    nota, setNota,
  } = wizard

  const toggleMotivo = (id: string) =>
    setMotivosSeleccionados(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )

  return (
    <div className="space-y-3">
      {(['completa', 'parcial', 'rechazada'] as Decision[]).map(dec => (
        <label key={dec} className={[
          'flex items-start gap-2 cursor-pointer rounded-lg p-2 border transition-colors',
          decision === dec
            ? dec === 'completa' ? 'border-success bg-success/10'
            : dec === 'parcial'  ? 'border-info bg-info/10'
            : 'border-error bg-error/10'
            : 'border-transparent hover:border-base-300'
        ].join(' ')}>
          <input
            type="radio"
            className="radio radio-sm mt-0.5"
            checked={decision === dec}
            onChange={() => setDecision(dec)}
          />
          <div>
            <p className="text-sm font-medium">
              {dec === 'completa' ? 'Conforme'
                : dec === 'parcial' ? 'Recepción parcial'
                : 'Rechazar guía'}
            </p>
            <p className="text-xs opacity-50">
              {dec === 'completa' ? 'Todo llegó según lo esperado'
                : dec === 'parcial' ? 'Solo parte del pedido recibido'
                : 'No se recepciona ningún ítem'}
            </p>
          </div>
        </label>
      ))}

      {/* Motivos de rechazo */}
      {decision === 'rechazada' && (
        <div className="space-y-2 pt-1">
          <p className="text-xs opacity-50">Motivo(s):</p>
          {MOTIVOS_RECHAZO.map(m => (
            <label key={m.id} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-error"
                checked={motivosSeleccionados.includes(m.id)}
                onChange={() => toggleMotivo(m.id)}
              />
              {m.label}
            </label>
          ))}
          <textarea
            className="textarea textarea-bordered textarea-sm w-full text-xs"
            placeholder="Otro motivo (opcional)…"
            value={motivoOtro}
            onChange={e => setMotivoOtro(e.target.value)}
            rows={2}
          />
        </div>
      )}

      {/* Nota para parcial */}
      {decision === 'parcial' && (
        <textarea
          className="textarea textarea-bordered textarea-sm w-full text-xs"
          placeholder="Describe qué faltó por recibir…"
          value={nota}
          onChange={e => setNota(e.target.value)}
          rows={2}
        />
      )}
    </div>
  )
}

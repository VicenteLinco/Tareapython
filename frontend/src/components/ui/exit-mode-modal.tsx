import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { clearDeviceMode } from '@/lib/device-mode'

interface ExitModeModalProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ExitModeModal({ onConfirm, onCancel }: ExitModeModalProps) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleVerify() {
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ valido: boolean }>('/configuracion/verificar-pin', { pin })
      if (res.data.valido) {
        clearDeviceMode()
        onConfirm()
      } else {
        setError('PIN incorrecto')
        setPin('')
      }
    } catch {
      toast.error('Error al verificar PIN')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-lg">Salir del modo</h3>
          </div>
          <button className="btn btn-ghost btn-xs btn-circle" onClick={onCancel}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm opacity-60 mb-4">
          Ingrese el PIN para salir del modo kiosko/QR
        </p>

        <input
          type="password"
          inputMode="numeric"
          className="input input-bordered w-full text-center text-2xl font-mono tracking-widest h-14"
          placeholder="• • • •"
          maxLength={8}
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          autoFocus
        />

        {error && (
          <p className="text-error text-sm text-center mt-2 font-medium">{error}</p>
        )}

        <div className="modal-action mt-4">
          <button className="btn btn-ghost flex-1" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn btn-primary flex-1"
            onClick={handleVerify}
            disabled={loading}
          >
            {loading ? <span className="loading loading-spinner loading-sm" /> : 'Confirmar'}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onCancel} />
    </div>
  )
}

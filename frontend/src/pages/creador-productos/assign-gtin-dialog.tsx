import { useEffect, useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { Barcode, Camera, CheckCircle2, Sparkles, Trash2, X } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { QrScanner } from '@/components/shared/qr-scanner'
import api from '@/lib/api'
import { notify } from '@/lib/notify'
import { isValidGtin, extractGtinFromScan } from '@/lib/gtin'

export type GtinTarget = {
  id: number
  producto_nombre: string
  nombre: string
  gtin: string | null
}

interface AssignGtinDialogProps {
  target: GtinTarget | null
  onClose: () => void
  onAssigned: () => void
}

export function AssignGtinDialog({ target, onClose, onAssigned }: AssignGtinDialogProps) {
  const [value, setValue] = useState('')
  const [scanning, setScanning] = useState(false)

  // Reset local state whenever a different presentation is opened.
  useEffect(() => {
    setValue(target?.gtin ?? '')
    setScanning(false)
  }, [target])

  const assignMut = useMutation({
    mutationFn: (payload: { gtin?: string; generate_internal?: boolean }) =>
      api.post(`/presentaciones/${target!.id}/assign-gtin`, payload),
    onSuccess: () => {
      notify.success(target?.gtin ? 'GTIN actualizado' : 'GTIN asignado')
      onAssigned()
      onClose()
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 409) {
        notify.error('Ese GTIN ya está asignado a otra presentación activa')
      } else {
        notify.error('No se pudo asignar el GTIN')
      }
    },
  })

  const clearMut = useMutation({
    mutationFn: () => api.delete(`/presentaciones/${target!.id}/gtin`),
    onSuccess: () => {
      notify.success('GTIN quitado')
      onAssigned()
      onClose()
    },
    onError: () => notify.error('No se pudo quitar el GTIN'),
  })

  const handleScan = useCallback((data: string) => {
    const gtin = extractGtinFromScan(data)
    if (!gtin) {
      notify.error('El código escaneado no contiene un GTIN válido')
      return
    }
    setValue(gtin)
    setScanning(false)
    notify.success('GTIN capturado del escaneo')
  }, [])

  const trimmed = value.trim()
  const valid = isValidGtin(trimmed)
  const unchanged = target?.gtin != null && trimmed === target.gtin
  const isEditing = target?.gtin != null

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={isEditing ? 'Editar GTIN' : 'Asignar GTIN'}
    >
      {target && (
        <div className="space-y-4">
          {/* Contexto del item */}
          <div className="rounded-xl bg-base-200/60 px-3 py-2">
            <p className="text-sm font-semibold">{target.producto_nombre}</p>
            <p className="text-xs opacity-60">{target.nombre}</p>
          </div>

          {scanning ? (
            <div className="space-y-3">
              <QrScanner active={scanning} onScan={handleScan} />
              <button
                className="btn btn-ghost btn-sm w-full gap-2"
                onClick={() => setScanning(false)}
              >
                <X className="h-4 w-4" />
                Cancelar escaneo
              </button>
            </div>
          ) : (
            <>
              {/* Entrada manual */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  Código GTIN
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/\s/g, ''))}
                  placeholder="13 o 14 dígitos"
                  className={`input input-bordered w-full font-mono tracking-wide bg-base-100 ${
                    trimmed && !valid ? 'input-error' : trimmed && valid ? 'input-success' : ''
                  }`}
                />
                {trimmed ? (
                  valid ? (
                    <p className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Válido · {trimmed.length} dígitos · dígito verificador OK
                    </p>
                  ) : (
                    <p className="text-xs text-error">
                      Inválido: revisá la longitud (13/14) y el dígito verificador
                    </p>
                  )
                ) : (
                  <p className="text-xs opacity-40">
                    Ingresalo a mano, pegalo o escanealo de la caja
                  </p>
                )}
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary btn-sm flex-1 gap-2"
                  disabled={!valid || unchanged || assignMut.isPending}
                  onClick={() => assignMut.mutate({ gtin: trimmed })}
                >
                  <Barcode className="h-4 w-4" />
                  {isEditing ? 'Guardar' : 'Asignar'}
                </button>
                <button
                  className="btn btn-outline btn-sm gap-2"
                  disabled={assignMut.isPending}
                  onClick={() => setScanning(true)}
                >
                  <Camera className="h-4 w-4" />
                  Escanear
                </button>
              </div>

              {isEditing ? (
                <button
                  className="btn btn-ghost btn-xs w-full gap-1.5 text-error/80 hover:text-error"
                  disabled={clearMut.isPending}
                  onClick={() => clearMut.mutate()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Quitar el GTIN de esta presentación
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-xs w-full gap-1.5 text-base-content/60"
                  disabled={assignMut.isPending}
                  onClick={() => assignMut.mutate({ generate_internal: true })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  No tiene código: generar uno interno automáticamente
                </button>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

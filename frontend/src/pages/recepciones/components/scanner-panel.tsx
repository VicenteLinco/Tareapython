// frontend/src/pages/recepciones/components/scanner-panel.tsx
import { useState } from 'react'
import { Camera, X, CheckCircle2 } from 'lucide-react'
import { QrScanner } from '@/components/shared/qr-scanner'

interface ScannerPanelProps {
  onScan: (code: string) => void
  scanCount: number
  paused: boolean
}

export function ScannerPanel({ onScan, scanCount, paused }: ScannerPanelProps) {
  const [active, setActive] = useState(false)

  if (!active) {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm gap-2 w-full"
        onClick={() => setActive(true)}
      >
        <Camera className="h-4 w-4" />
        Iniciar escaneo con cámara
      </button>
    )
  }

  return (
    <div className="card bg-base-100 border overflow-hidden">
      {/* Header del panel */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {scanCount > 0 ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-semibold text-success">
                {scanCount} {scanCount === 1 ? 'escaneado' : 'escaneados'}
              </span>
            </>
          ) : (
            <span className="text-xs opacity-50 uppercase tracking-wide">
              {paused ? 'En pausa…' : 'Apunta al código'}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-circle"
          onClick={() => setActive(false)}
          title="Cerrar escáner"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Cámara */}
      <div className="px-4 pb-4">
        <QrScanner
          active={active}
          paused={paused}
          onScan={onScan}
        />
        <p className="text-xs opacity-40 text-center mt-2">
          {paused ? 'Completa los datos del lote para continuar' : 'Escáner activo — escanea un código QR o de barras'}
        </p>
      </div>
    </div>
  )
}

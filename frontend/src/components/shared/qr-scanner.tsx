import { useEffect, useRef, useState, useCallback } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { v4 as uuidv4 } from 'uuid'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QrScannerProps {
  onScan: (data: string) => void
  active: boolean
  paused?: boolean
  className?: string
}

export function QrScanner({ onScan, active, paused, className }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const divId = useRef(`qr-reader-${uuidv4().slice(0, 8)}`).current
  const [error, setError] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  
  // Throttle para evitar lecturas duplicadas accidentales
  const lastScan = useRef<string | null>(null)
  const lastScanTime = useRef<number>(0)

  const stopScanner = useCallback(async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop()
        await scannerRef.current.clear()
        setIsReady(false)
      } catch (err) {
        console.error("Error al detener QR:", err)
      }
    }
  }, [])

  useEffect(() => {
    if (!active) {
      stopScanner()
      return
    }

    const startScanner = async () => {
      const scanner = new Html5Qrcode(divId)
      scannerRef.current = scanner

      const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0 
      }

      try {
        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            if (paused) return
            
            const now = Date.now()
            if (decodedText === lastScan.current && now - lastScanTime.current < 2000) {
              return
            }

            lastScan.current = decodedText
            lastScanTime.current = now
            onScan(decodedText)
          },
          () => { /* Ignorar errores de frame vacío */ }
        )
        setIsReady(true)
        setError(null)
      } catch (err) {
        console.error("QR Start Error:", err)
        setError("Error de acceso a cámara. Revisa permisos.")
      }
    }

    startScanner()

    return () => {
      stopScanner()
    }
  }, [active, divId, onScan, paused, stopScanner])

  if (!active) return null

  return (
    <div className={cn(
      "relative w-full aspect-square max-w-sm mx-auto overflow-hidden rounded-[2.5rem] bg-black shadow-2xl transition-all duration-500",
      (isReady || !!error) ? "opacity-100 scale-100" : "opacity-0 scale-95",
      className
    )}>
      {/* El div donde se renderiza el video de html5-qrcode */}
      <div id={divId} className="w-full h-full [&>video]:object-cover" />
      
      {/* Overlay de Guía Visual 2026 */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        {/* Marco de enfoque */}
        <div className="w-56 h-56 border-2 border-primary/40 rounded-[2rem] relative">
          {/* Esquinas resaltadas */}
          <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-2xl" />
          <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-2xl" />
          <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-2xl" />
          <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-2xl" />
          
          {/* Línea de escaneo animada */}
          <div className="absolute inset-x-4 top-1/2 h-0.5 bg-primary/50 shadow-[0_0_15px_rgba(var(--p),0.5)] animate-[scan_2s_ease-in-out_infinite]" />
        </div>
      </div>

      {/* Estado Cargando */}
      {!isReady && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-base-300 gap-4">
          <span className="loading loading-ring loading-lg text-primary"></span>
          <p className="text-xs font-bold opacity-40 uppercase tracking-widest">Iniciando Lente...</p>
        </div>
      )}

      {/* Estado Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-base-100/95 p-8 text-center z-10">
          <div className="p-4 bg-error/10 rounded-full mb-4">
            <AlertCircle className="h-10 w-10 text-error" />
          </div>
          <h3 className="font-bold text-lg mb-2">Cámara Bloqueada</h3>
          <p className="text-sm opacity-60 mb-6">{error}</p>
          <button 
            className="btn btn-primary btn-sm rounded-xl"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      )}

      <style>{`
        @keyframes scan {
          0%, 100% { transform: translateY(-80px); opacity: 0; }
          50% { transform: translateY(80px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

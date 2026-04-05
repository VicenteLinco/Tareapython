import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '@/lib/api'
import { toast } from 'sonner'

export default function ScanPage() {
  const { token } = useParams<{ token: string }>()
  const [scanned, setScanned] = useState<string[]>([])

  useEffect(() => {
    if (!token) return
    let scanner: any = null
    import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      scanner = new Html5QrcodeScanner('reader', { fps: 10, qrbox: 250 }, false)
      scanner.render(
        async (code: string) => {
          if (scanned.includes(code)) return
          try {
            await api.post(`/recepciones/scanner-session/${token}/scan`, { codigo: code })
            setScanned(prev => [...prev, code])
            toast.success(`Escaneado: ${code}`)
          } catch {
            toast.error('Error al enviar escaneo')
          }
        },
        () => {}
      )
    })
    return () => { if (scanner) scanner.clear().catch(() => {}) }
  }, [token])

  return (
    <div className="min-h-screen bg-base-100 p-4 max-w-sm mx-auto">
      <h1 className="text-lg font-bold mb-4 text-center">Escanear productos</h1>
      <div id="reader" className="rounded-xl overflow-hidden border border-base-200" />
      {scanned.length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-xs font-bold opacity-50">Enviados: {scanned.length}</p>
          {scanned.map((c, i) => <p key={i} className="text-sm font-mono">{c}</p>)}
        </div>
      )}
    </div>
  )
}

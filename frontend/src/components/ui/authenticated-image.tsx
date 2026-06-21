import { useEffect, useState } from 'react'
import { ImageOff, RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface AuthenticatedUploadImageProps {
  path: string
  alt: string
  className?: string
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function AuthenticatedUploadImage({ path, alt, className }: AuthenticatedUploadImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (path.startsWith('data:image')) {
      setSrc(path)
      setStatus('ready')
      return
    }

    setSrc(null)
    setStatus('loading')
    let objectUrl: string | null = null
    let cancelled = false

    api.get(`/uploads/${path}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setSrc(objectUrl)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, reloadKey])

  if (status === 'error') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 bg-base-200 text-xs text-base-content/60 rounded-xl p-3 text-center',
          className,
        )}
      >
        <ImageOff className="h-6 w-6 opacity-50" />
        <span>No se pudo cargar la imagen</span>
        <button
          type="button"
          className="btn btn-xs btn-ghost gap-1"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          Reintentar
        </button>
      </div>
    )
  }

  if (!src) {
    return (
      <div className={cn('flex items-center justify-center bg-base-200 text-sm opacity-60 rounded-xl', className)}>
        Cargando foto...
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} />
}

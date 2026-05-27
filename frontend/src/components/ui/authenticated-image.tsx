import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'

interface AuthenticatedUploadImageProps {
  path: string
  alt: string
  className?: string
}

export function AuthenticatedUploadImage({ path, alt, className }: AuthenticatedUploadImageProps) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (path.startsWith('data:image')) {
      setSrc(path)
      return
    }

    setSrc(null)
    let objectUrl: string | null = null
    let cancelled = false

    api.get(`/uploads/${path}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) notify.error('No se pudo cargar la foto')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (!src) {
    return (
      <div className={cn('flex items-center justify-center bg-base-200 text-sm opacity-60 rounded-xl', className)}>
        Cargando foto...
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} />
}

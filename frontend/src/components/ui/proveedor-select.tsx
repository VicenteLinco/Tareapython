import { useState, useRef, useEffect } from 'react'
import { Truck, ChevronDown, Check } from 'lucide-react'
import type { Proveedor } from '@/types'

function isSafeIconUrl(url: string | null | undefined): boolean {
  if (!url) return false
  // Permitir HTTPS y rutas locales (siempre seguras)
  if (url.startsWith('https://') || url.startsWith('/')) return true

  // Permitir solo formatos de imagen estáticos (no ejecutables)
  // Esto bloquea data:image/svg+xml que es el vector de ataque XSS
  const safeDataPrefixes = [
    'data:image/png',
    'data:image/jpeg',
    'data:image/jpg',
    'data:image/webp',
    'data:image/gif',
  ]
  return safeDataPrefixes.some((prefix) => url.startsWith(prefix))
}

// Reusable icon: emoji, logo URL (https only), or truck fallback
export function ProveedorIcon({
  proveedor,
  className = 'h-5 w-5',
}: {
  proveedor: { nombre?: string; icono?: string | null } | null | undefined
  className?: string
}) {
  const [imgError, setImgError] = useState(false)
  const icono = proveedor?.icono
  const safeUrl = isSafeIconUrl(icono)

  // Un emoji es una cadena muy corta (máximo 10 caracteres por seguridad)
  // y que no parece una URL ni un base64.
  const isEmoji =
    !!icono &&
    icono.length <= 10 &&
    !icono.startsWith('http') &&
    !icono.startsWith('/') &&
    !icono.startsWith('data:')

  if (isEmoji) {
    return (
      <span className={`shrink-0 flex items-center justify-center text-base leading-none ${className}`}>
        {icono}
      </span>
    )
  }

  if (safeUrl && !imgError) {
    return (
      <div className={`relative shrink-0 flex items-center justify-center ${className}`}>
        <img
          src={icono!}
          alt=""
          className="h-full w-full rounded object-contain"
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      </div>
    )
  }

  return (
    <div className={`shrink-0 flex items-center justify-center ${className}`}>
      <Truck className="h-full w-full opacity-20" />
    </div>
  )
}

interface ProveedorSelectProps {
  value: string | number
  onChange: (value: string) => void
  proveedores: Proveedor[]
  placeholder?: string
  /** If provided, an "all" option is shown at the top with this label */
  allLabel?: string
  className?: string
  size?: 'sm' | 'md'
}

export function ProveedorSelect({
  value,
  onChange,
  proveedores,
  placeholder = 'Seleccionar proveedor...',
  allLabel,
  className = '',
  size = 'sm',
}: ProveedorSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = proveedores.find((p) => String(p.id) === String(value))

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const height = size === 'sm' ? 'h-9' : 'h-10'
  const textSize = size === 'sm' ? 'text-sm' : 'text-base'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        className={`${height} ${textSize} w-full flex items-center gap-2 px-3 border border-base-300 rounded-lg bg-base-100 hover:bg-base-200 transition-colors`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selected ? (
            <>
              <ProveedorIcon proveedor={selected} className="h-4 w-4" />
              <span className="truncate">{selected.nombre}</span>
            </>
          ) : (
            <span className="text-base-content/40 truncate">
              {allLabel ?? placeholder}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 opacity-40 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-base-100 border border-base-300 rounded-lg shadow-xl ring-1 ring-base-content/10 max-h-60 overflow-y-auto">
          {allLabel !== undefined && (
            <div
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 text-sm text-base-content/40 ${!value ? 'bg-base-200' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(''); setOpen(false) }}
            >
              {allLabel}
            </div>
          )}
          {proveedores.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 ${String(p.id) === String(value) ? 'bg-primary/10' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(String(p.id)); setOpen(false) }}
            >
              <ProveedorIcon proveedor={p} className="h-4 w-4" />
              <span className="text-sm flex-1">{p.nombre}</span>
              {String(p.id) === String(value) && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

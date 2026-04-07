// frontend/src/pages/recepciones/components/producto-autocomplete.tsx
import { useState, useRef, useEffect } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import type { Producto } from '@/types'

interface Props {
  productos: Producto[]
  excluidos: string[]              // producto_id ya presentes en detalles
  onSelect: (p: Producto) => void
  onScan: (valor: string) => void  // Enter sin sugerencia activa → flujo QR/código
  onScannerOpen: () => void        // click en ícono ScanLine → abre modal QrScanner en padre
}

export function ProductoAutocomplete({ productos, excluidos, onSelect, onScan, onScannerOpen }: Props) {
  const [value, setValue] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const suggestions: Producto[] = q.length >= 2
    ? productos
        .filter(p => !excluidos.includes(String(p.id)))
        .filter(p =>
          p.nombre.toLowerCase().includes(q) ||
          p.codigo_interno.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : []

  // Resetear índice activo cada vez que cambia el texto
  useEffect(() => { setActiveIndex(-1) }, [value])

  // Cerrar al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (p: Producto) => {
    onSelect(p)
    setValue('')
    setOpen(false)
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      if (suggestions.length === 0) return
      setActiveIndex(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        select(suggestions[activeIndex])
      } else {
        onScan(value)
        setValue('')
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  const showDropdown = open && q.length >= 2

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none z-10" />
      <input
        className="input input-bordered w-full pl-10 pr-10"
        placeholder="Escanear QR · Código interno · Nombre del producto…"
        value={value}
        onChange={e => { setValue(e.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
      />
      <ScanLine
        className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 cursor-pointer"
        onClick={onScannerOpen}
      />

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-box shadow-lg z-50 overflow-hidden">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm opacity-50">Sin resultados</div>
          ) : (
            suggestions.map((p, i) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                  i === activeIndex ? 'bg-base-200' : 'hover:bg-base-200'
                }`}
                onMouseDown={() => select(p)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <ProductoImage
                  src={(p as Producto & { imagen_url?: string | null }).imagen_url}
                  size="sm"
                />
                <span className="text-sm flex-1 truncate">{p.nombre}</span>
                <span className="text-xs opacity-50 font-mono flex-shrink-0">{p.codigo_interno}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// frontend/src/pages/recepciones/components/producto-autocomplete.tsx
import { useState, useRef, useEffect } from 'react'
import { Search, ScanLine } from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import type { Producto } from '@/types'

interface Props {
  productos: Producto[]
  excluidos: string[]              // producto_id ya presentes en detalles
  proveedorId?: number | null      // si se indica, solo muestra productos de ese proveedor
  onSelect: (p: Producto) => void
  onScan: (valor: string) => void  // Enter sin sugerencia activa → flujo QR/código
  onScannerOpen?: () => void       // click en ícono ScanLine → abre modal QrScanner en padre (opcional)
}

export function ProductoAutocomplete({ productos, excluidos, proveedorId, onSelect, onScan, onScannerOpen }: Props) {
  const [value, setValue] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const q = value.trim().toLowerCase()
  const canShowInitialList = open && q.length === 0
  const canSearch = q.length >= 2
  const suggestions: Producto[] = canShowInitialList || canSearch
    ? productos
        .filter(p => !excluidos.includes(String(p.id)))
        .filter(p => proveedorId == null || p.proveedor_id === proveedorId)
        .filter(p =>
          canShowInitialList ||
          p.nombre.toLowerCase().includes(q) ||
          p.codigo_interno.toLowerCase().includes(q)
        )
        .slice(0, 8)
    : []

  // Resetear índice activo cada vez que cambia el texto
  useEffect(() => { setActiveIndex(-1) }, [value])

  // Scroll automático al ítem activo
  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

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
      if (!open) { setOpen(true) }
      if (suggestions.length === 0) return
      setActiveIndex(i => i < suggestions.length - 1 ? i + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setActiveIndex(i => i > 0 ? i - 1 : suggestions.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
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

  const showDropdown = open && (q.length === 0 || q.length >= 2)

  return (
    <div ref={containerRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none z-10" />
      <input
        className="input w-full border-base-300 bg-base-100 pl-10 pr-10 focus:border-primary focus:outline-primary/25"
        placeholder="Escanear QR · Código interno · Nombre del producto…"
        value={value}
        onChange={e => { setValue(e.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-activedescendant={activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined}
      />
      {onScannerOpen && (
        <ScanLine
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 cursor-pointer"
          onClick={onScannerOpen}
        />
      )}

      {showDropdown && (
        <div
          ref={listRef}
          role="listbox"
          className="app-floating-menu absolute top-full left-0 right-0 mt-1 rounded-box overflow-y-auto max-h-72"
        >
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm opacity-50">Sin resultados</div>
          ) : (
            suggestions.map((p, i) => (
              <div
                key={p.id}
                id={`suggestion-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                ref={el => { itemRefs.current[i] = el }}
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

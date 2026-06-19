import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'

interface AsignarCodigoModalProps {
  codigo: string
  productos: { id: string; nombre: string; codigo_interno: string | null }[]
  onClose: () => void
  onAsignado: () => void
}

export function AsignarCodigoModal({ codigo, productos, onClose, onAsignado }: AsignarCodigoModalProps) {
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [selectedProducto, setSelectedProducto] = useState<{ id: string; nombre: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = productos
    .filter(p =>
      p.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (p.codigo_interno ?? '').toLowerCase().includes(search.toLowerCase())
    )
    .slice(0, 10)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  useEffect(() => { setActiveIndex(-1) }, [search])

  const handleSelect = useCallback((p: { id: string; nombre: string }) => {
    setSelectedProducto(p)
    setSearch(p.nombre)
    setDropdownOpen(false)
    setActiveIndex(-1)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!dropdownOpen) setDropdownOpen(true)
      setActiveIndex(i => i < filtered.length - 1 ? i + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => i > 0 ? i - 1 : filtered.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && filtered[activeIndex]) {
        handleSelect(filtered[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
      setActiveIndex(-1)
    }
  }

  const asignarMut = useMutation({
    mutationFn: () =>
      api.post('/productos/scan/asignar', { codigo, producto_id: selectedProducto!.id }),
    onSuccess: () => {
      notify.success(`Código ${codigo} asignado a ${selectedProducto!.nombre}`)
      onAsignado()
      onClose()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProducto) {
      notify.error('Seleccioná un producto de la lista')
      inputRef.current?.focus()
      return
    }
    asignarMut.mutate()
  }

  return (
    <Dialog open onClose={onClose} title="Asignar código desconocido">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1 p-3 bg-warning/10 border border-warning/30 rounded-xl">
          <span className="text-[10px] font-bold uppercase tracking-widest text-warning/70">Código escaneado</span>
          <span className="font-mono text-lg font-bold text-warning">{codigo}</span>
          <span className="text-xs text-base-content/50">Este código no está registrado en ningún producto.</span>
        </div>

        <div className="form-control">
          <label className="label py-0.5">
            <span className="label-text text-sm font-medium">Producto</span>
            <span className="label-text-alt text-error text-[10px]">requerido</span>
          </label>
          <div ref={containerRef} className="relative">
            <input
              ref={inputRef}
              type="text"
              className="input input-bordered input-sm h-9 w-full"
              placeholder="Buscar producto por nombre o código..."
              value={search}
              autoFocus
              onChange={(e) => {
                setSearch(e.target.value)
                setSelectedProducto(null)
                setDropdownOpen(true)
              }}
              onFocus={() => { if (search) setDropdownOpen(true) }}
              onKeyDown={handleKeyDown}
              aria-autocomplete="list"
              aria-expanded={dropdownOpen && filtered.length > 0}
            />
            {dropdownOpen && filtered.length > 0 && (
              <div
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-60"
                role="listbox"
              >
                {filtered.map((p, idx) => (
                  <div
                    key={p.id}
                    ref={el => { itemRefs.current[idx] = el }}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={cn(
                      'flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors',
                      idx === activeIndex ? 'bg-primary/10 text-primary' : 'hover:bg-base-200/60'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(p)
                    }}
                  >
                    <span className="font-medium truncate">{p.nombre}</span>
                    {p.codigo_interno && (
                      <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">#{p.codigo_interno}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-base-content/40 mt-0.5">
            El código quedará registrado y podrás escanearlo directamente la próxima vez.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-base-300">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-warning btn-sm"
            disabled={!selectedProducto || asignarMut.isPending}
          >
            {asignarMut.isPending
              ? <span className="loading loading-spinner loading-xs" />
              : <><Plus className="h-3.5 w-3.5" />Asignar código</>
            }
          </button>
        </div>
      </form>
    </Dialog>
  )
}

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Proveedor } from '@/types'

interface Props {
  proveedores: Proveedor[]
  disponibles: Proveedor[]
  quiebresCount: number
  onQuitar: (proveedorId: number) => void
  onAgregar: (proveedor: Proveedor) => void
  onLimpiar: () => void
}

export function ProveedorBanner({ proveedores, disponibles, quiebresCount, onQuitar, onAgregar, onLimpiar }: Props) {
  const [proveedorId, setProveedorId] = useState('')
  const candidatos = disponibles.filter(p => !proveedores.some(sel => sel.id === p.id))

  const handleAgregar = (id: string) => {
    setProveedorId('')
    const proveedor = disponibles.find(p => p.id === Number(id))
    if (proveedor) onAgregar(proveedor)
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl shrink-0">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {proveedores.length === 0 ? (
            <span className="text-sm font-bold opacity-60">Sin filtro de proveedor</span>
          ) : proveedores.map(p => (
            <span
              key={p.id}
              className="inline-flex items-center gap-2 max-w-[220px] h-8 px-3 rounded-full bg-primary text-primary-content text-xs font-bold shadow-sm"
            >
              <span className="truncate">{p.nombre}</span>
              <button
                type="button"
                className="opacity-70 hover:opacity-100"
                onClick={() => onQuitar(p.id)}
                aria-label={`Quitar ${p.nombre}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        <p className="text-[10px] opacity-45 font-bold uppercase tracking-wide">
          {quiebresCount} recomendacion{quiebresCount !== 1 ? 'es' : ''} visibles. El carrito se mantiene al cambiar filtros.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={proveedorId}
          onChange={e => handleAgregar(e.target.value)}
          className="select select-bordered select-sm rounded-xl h-8 min-h-8 text-xs w-48"
          aria-label="Agregar proveedor al filtro"
        >
          <option value="">Agregar proveedor...</option>
          {candidatos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {proveedores.length > 0 && (
          <Button variant="ghost" size="sm" className="rounded-xl h-8 text-xs" onClick={onLimpiar}>
            Limpiar
          </Button>
        )}
      </div>
    </div>
  )
}

import type { Categoria, Proveedor } from '@/types'
import type { EstadoFiltro } from '../hooks/useStockFilters'

interface StockSecondaryFiltersProps {
  categorias: Categoria[] | undefined
  proveedores: Proveedor[] | undefined
  categoriaId: number | null
  proveedorId: number | null
  estado: EstadoFiltro
  setCategoriaId: (v: number | null) => void
  setProveedorId: (v: number | null) => void
  setEstado: (v: EstadoFiltro) => void
}

export function StockSecondaryFilters({
  categorias,
  proveedores,
  categoriaId,
  proveedorId,
  estado,
  setCategoriaId,
  setProveedorId,
  setEstado,
}: StockSecondaryFiltersProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">Categoría</label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={categoriaId ?? ''}
          onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Todas las categorías</option>
          {categorias?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">Proveedor</label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={proveedorId ?? ''}
          onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Todos los proveedores</option>
          {proveedores?.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">Estado</label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={estado}
          onChange={e => setEstado(e.target.value as EstadoFiltro)}
        >
          <option value="todos">Todos los estados</option>
          <option value="normal">Normal</option>
          <option value="bajo">Stock bajo</option>
          <option value="critico">Crítico</option>
          <option value="sin_stock">Sin stock</option>
          <option value="vence_pronto">Por vencer</option>
        </select>
      </div>
    </>
  )
}

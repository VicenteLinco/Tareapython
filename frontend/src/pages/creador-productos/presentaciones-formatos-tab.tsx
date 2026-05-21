import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { getPresFormatos, savePresFormatos, type PresFormato } from '@/lib/pres-formatos'
import { notify } from '@/lib/notify'

export default function PresentacionesFormatosTab() {
  const [formatos, setFormatos] = useState<PresFormato[]>(() => getPresFormatos())
  const [nuevo, setNuevo] = useState({ nombre: '', nombre_plural: '' })

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.nombre.trim()
    const nombre_plural = nuevo.nombre_plural.trim() || nombre
    if (!nombre) return
    if (formatos.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase())) {
      notify.error('Ya existe ese formato')
      return
    }
    const updated = [...formatos, { nombre, nombre_plural }].sort((a, b) => a.nombre.localeCompare(b.nombre))
    setFormatos(updated)
    savePresFormatos(updated)
    setNuevo({ nombre: '', nombre_plural: '' })
    notify.success('Formato añadido')
  }

  function handleDelete(nombre: string) {
    if (!confirm(`¿Eliminar el formato "${nombre}"?`)) return
    const updated = formatos.filter((f) => f.nombre !== nombre)
    setFormatos(updated)
    savePresFormatos(updated)
    notify.success('Formato eliminado')
  }

  const columns = [
    {
      key: 'nombre',
      header: 'Singular',
      render: (item: PresFormato) => (
        <span className="font-medium text-sm">{item.nombre}</span>
      ),
    },
    {
      key: 'nombre_plural',
      header: 'Plural',
      render: (item: PresFormato) => (
        <span className="text-sm opacity-50">{item.nombre_plural}</span>
      ),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-16',
      render: (item: PresFormato) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => handleDelete(item.nombre)}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex flex-col gap-2 bg-base-200/50 p-3 rounded-lg border border-base-300">
        <div className="grid grid-cols-2 gap-2">
          <div className="form-control">
            <label className="label py-0.5"><span className="label-text text-[10px] font-semibold uppercase opacity-50">Singular</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              placeholder="Ej: Botella"
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              required
            />
          </div>
          <div className="form-control">
            <label className="label py-0.5"><span className="label-text text-[10px] font-semibold uppercase opacity-50">Plural</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              placeholder="Ej: Botellas"
              value={nuevo.nombre_plural}
              onChange={(e) => setNuevo({ ...nuevo, nombre_plural: e.target.value })}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-sm gap-1.5 w-full mt-1">
          <Plus className="h-4 w-4" />
          Añadir formato
        </button>
      </form>

      <DataTable
        columns={columns}
        data={formatos}
        emptyMessage="No hay formatos registrados"
      />
    </div>
  )
}

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { getPresFormatos, savePresFormatos } from '@/lib/pres-formatos'
import { toast } from 'sonner'

export default function PresentacionesFormatosTab() {
  const [formatos, setFormatos] = useState<string[]>(() => getPresFormatos())
  const [nuevo, setNuevo] = useState('')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.trim()
    if (!nombre) return
    if (formatos.some((f) => f.toLowerCase() === nombre.toLowerCase())) {
      toast.error('Ya existe ese formato')
      return
    }
    const updated = [...formatos, nombre].sort()
    setFormatos(updated)
    savePresFormatos(updated)
    setNuevo('')
    toast.success('Formato añadido')
  }

  function handleDelete(nombre: string) {
    if (!confirm(`¿Eliminar el formato "${nombre}"?`)) return
    const updated = formatos.filter((f) => f !== nombre)
    setFormatos(updated)
    savePresFormatos(updated)
    toast.success('Formato eliminado')
  }

  const columns = [
    {
      key: 'nombre',
      header: 'Nombre',
      render: (item: Record<string, unknown>) => (
        <span className="font-medium text-sm">{item.nombre as string}</span>
      ),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-16',
      render: (item: Record<string, unknown>) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => handleDelete(item.nombre as string)}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          className="input input-bordered input-sm h-9 flex-1"
          placeholder="Ej: Botella"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm gap-1.5">
          <Plus className="h-4 w-4" />
          Añadir
        </button>
      </form>

      <DataTable
        columns={columns}
        data={formatos.map((f) => ({ nombre: f }))}
        emptyMessage="No hay formatos registrados"
      />
    </div>
  )
}

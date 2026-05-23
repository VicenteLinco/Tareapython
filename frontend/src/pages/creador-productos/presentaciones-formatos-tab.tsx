import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { PageLoading } from '@/components/ui/page-state'
import api from '@/lib/api'
import type { PresFormato } from '@/lib/pres-formatos'
import { notify } from '@/lib/notify'

type PresFormatoRow = PresFormato & {
  id: number
  es_predefinido: boolean
}

export default function PresentacionesFormatosTab() {
  const queryClient = useQueryClient()
  const [nuevo, setNuevo] = useState({ nombre: '', nombre_plural: '' })

  const { data: formatos = [], isLoading } = useQuery({
    queryKey: ['presentacion-formatos'],
    queryFn: () => api.get<PresFormatoRow[]>('/presentacion-formatos').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (payload: PresFormato) => api.post('/presentacion-formatos', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentacion-formatos'] })
      setNuevo({ nombre: '', nombre_plural: '' })
      notify.success('Formato anadido')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/presentacion-formatos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentacion-formatos'] })
      notify.success('Formato eliminado')
    },
  })

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const nombre = nuevo.nombre.trim()
    const nombre_plural = nuevo.nombre_plural.trim() || nombre
    if (!nombre) return
    if (formatos.some((f) => f.nombre.toLowerCase() === nombre.toLowerCase())) {
      notify.error('Ya existe ese formato')
      return
    }
    createMut.mutate({ nombre, nombre_plural })
  }

  function handleDelete(item: PresFormatoRow) {
    if (!confirm(`Eliminar el formato "${item.nombre}"?`)) return
    deleteMut.mutate(item.id)
  }

  const columns = [
    {
      key: 'nombre',
      header: 'Singular',
      render: (item: PresFormatoRow) => (
        <span className="font-medium text-sm">{item.nombre}</span>
      ),
    },
    {
      key: 'nombre_plural',
      header: 'Plural',
      render: (item: PresFormatoRow) => (
        <span className="text-sm opacity-50">{item.nombre_plural}</span>
      ),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-16',
      render: (item: PresFormatoRow) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => handleDelete(item)}
            disabled={deleteMut.isPending}
            title="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
          </button>
        </div>
      ),
    },
  ]

  if (isLoading) return <PageLoading label="Cargando formatos..." />

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
        <button type="submit" className="btn btn-primary btn-sm gap-1.5 w-full mt-1" disabled={createMut.isPending}>
          <Plus className="h-4 w-4" />
          Anadir formato
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

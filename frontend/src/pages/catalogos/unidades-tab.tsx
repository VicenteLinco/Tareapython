import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Dialog } from '@/components/ui/dialog'
import api from '@/lib/api'
import { toast } from 'sonner'
import type { UnidadBasica, CreateUnidadBasica, UpdateUnidadBasica } from '@/types'

export default function UnidadesTab() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UnidadBasica | null>(null)
  const [nombre, setNombre] = useState('')
  const [nombrePlural, setNombrePlural] = useState('')

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ['unidades-basicas'],
    queryFn: () => api.get<UnidadBasica[]>('/unidades-basicas').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: CreateUnidadBasica) => api.post('/unidades-basicas', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades-basicas'] })
      toast.success('Unidad creada')
      closeDialog()
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message ?? 'Error al crear unidad'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUnidadBasica }) =>
      api.put(`/unidades-basicas/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades-basicas'] })
      toast.success('Unidad actualizada')
      closeDialog()
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message ?? 'Error al actualizar unidad'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/unidades-basicas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades-basicas'] })
      toast.success('Unidad eliminada')
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message ?? 'No se puede eliminar: tiene productos asociados'),
  })

  function openCreate() {
    setEditing(null)
    setNombre('')
    setNombrePlural('')
    setDialogOpen(true)
  }

  function openEdit(u: UnidadBasica) {
    setEditing(u)
    setNombre(u.nombre)
    setNombrePlural(u.nombre_plural)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || !nombrePlural.trim()) return
    if (editing) {
      updateMut.mutate({ id: editing.id, data: { nombre: nombre.trim(), nombre_plural: nombrePlural.trim() } })
    } else {
      createMut.mutate({ nombre: nombre.trim(), nombre_plural: nombrePlural.trim() })
    }
  }

  function handleDelete(u: UnidadBasica) {
    if (confirm(`¿Eliminar la unidad "${u.nombre}"?`)) deleteMut.mutate(u.id)
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const columns = [
    {
      key: 'nombre',
      header: 'Singular',
      render: (item: UnidadBasica) => <span className="font-medium text-sm">{item.nombre}</span>,
    },
    {
      key: 'nombre_plural',
      header: 'Plural',
      render: (item: UnidadBasica) => <span className="text-sm opacity-70">{item.nombre_plural}</span>,
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-20',
      render: (item: UnidadBasica) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-xs btn-square" onClick={() => openEdit(item)}>
            <Pencil className="h-3.5 w-3.5 opacity-50" />
          </button>
          <button className="btn btn-ghost btn-xs btn-square" onClick={() => handleDelete(item)}>
            <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva unidad
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={unidades as unknown as Record<string, unknown>[]}
          emptyMessage="No hay unidades registradas"
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title={editing ? 'Editar unidad' : 'Nueva unidad básica'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label"><span className="label-text text-sm font-medium">Singular *</span></label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: placa"
                autoFocus
                required
              />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-sm font-medium">Plural *</span></label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={nombrePlural}
                onChange={(e) => setNombrePlural(e.target.value)}
                placeholder="Ej: placas"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>
              {isSaving ? <span className="loading loading-spinner loading-xs" /> : editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

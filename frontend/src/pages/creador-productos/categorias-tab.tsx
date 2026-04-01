import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { toast } from 'sonner'
import type { Categoria, CreateCategoria, UpdateCategoria } from '@/types'

export default function CategoriasTab() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Categoria | null>(null)

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: CreateCategoria) => api.post('/categorias', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      toast.success('Categoría creada')
      closeDialog()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCategoria }) =>
      api.put(`/categorias/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      toast.success('Categoría actualizada')
      closeDialog()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/categorias/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      toast.success('Categoría eliminada')
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  function openCreate() {
    setEditing(null)
    setNombre('')
    setDescripcion('')
    setDialogOpen(true)
  }

  function openEdit(cat: Categoria) {
    setEditing(cat)
    setNombre(cat.nombre)
    setDescripcion(cat.descripcion ?? '')
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    if (editing) {
      updateMut.mutate({ 
        id: editing.id, 
        data: { 
          nombre: nombre.trim(), 
          descripcion: descripcion.trim() || undefined,
          version: editing.version
        } 
      })
    } else {
      createMut.mutate({ nombre: nombre.trim(), descripcion: descripcion.trim() || undefined })
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const columns = [
    {
      key: 'nombre',
      header: 'Nombre',
      render: (item: Categoria) => <span className="font-medium text-sm">{item.nombre}</span>,
    },
    {
      key: 'descripcion',
      header: 'Descripción',
      className: 'hidden md:table-cell',
      render: (item: Categoria) => (
        <span className="text-sm opacity-50">{item.descripcion || '--'}</span>
      ),
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-20',
      render: (item: Categoria) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-xs btn-square" onClick={() => openEdit(item)}>
            <Pencil className="h-3.5 w-3.5 opacity-50" />
          </button>
          <button className="btn btn-ghost btn-xs btn-square" onClick={() => setDeleteTarget(item)}>
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
          Nueva categoría
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={categorias}
          emptyMessage="No hay categorías registradas"
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title={editing ? 'Editar categoría' : 'Nueva categoría'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Nombre *</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Reactivos"
              autoFocus
              required
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Descripción</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>
              {isSaving ? <span className="loading loading-spinner loading-xs" /> : editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar categoría"
        description={`¿Estás seguro de eliminar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer si tiene productos asociados.`}
        confirmLabel="Eliminar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </div>
  )
}

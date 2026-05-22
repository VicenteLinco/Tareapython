import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { PageLoading } from '@/components/ui/page-state'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { Categoria, CreateCategoria, UpdateCategoria } from '@/types'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isDesktop
}

export default function CategoriasTab() {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const [formMode, setFormMode] = useState<'idle' | 'crear' | 'editar'>('idle')
  const [selectedItem, setSelectedItem] = useState<Categoria | null>(null)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Categoria | null>(null)

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Categoria[]>('/categorias').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const createMut = useMutation({
    mutationFn: (data: CreateCategoria) => api.post('/categorias', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      notify.success('Categoría creada')
      closeForm()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateCategoria }) =>
      api.put(`/categorias/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      notify.success('Categoría actualizada')
      closeForm()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/categorias/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] })
      notify.success('Categoría eliminada')
      setDeleteTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  function openCreate() {
    setSelectedItem(null)
    setNombre('')
    setDescripcion('')
    setFormMode('crear')
  }

  function openEdit(cat: Categoria) {
    setSelectedItem(cat)
    setNombre(cat.nombre)
    setDescripcion(cat.descripcion ?? '')
    setFormMode('editar')
  }

  function closeForm() {
    setFormMode('idle')
    setSelectedItem(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    if (selectedItem) {
      updateMut.mutate({
        id: selectedItem.id,
        data: {
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || null,
          version: selectedItem.version,
        },
      })
    } else {
      createMut.mutate({ nombre: nombre.trim(), descripcion: descripcion.trim() || null })
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const formJsx = (
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeForm}>Cancelar</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>
          {isSaving ? <span className="loading loading-spinner loading-xs" /> : selectedItem ? 'Guardar' : 'Crear'}
        </button>
      </div>
    </form>
  )

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

      <div className="flex gap-6 items-start">
        <div className={cn('min-w-0', formMode !== 'idle' ? 'lg:flex-[3]' : 'w-full')}>
          {isLoading ? (
            <PageLoading label="Cargando categorías..." />
          ) : (
            <DataTable
              columns={columns}
              data={categorias}
              emptyMessage="No hay categorías registradas"
              onRowClick={(item) => openEdit(item)}
              selectedId={formMode !== 'idle' ? selectedItem?.id : undefined}
            />
          )}
        </div>

        {formMode !== 'idle' && isDesktop && (
          <div className="hidden lg:flex flex-col min-w-0 lg:flex-[2] lg:sticky lg:top-24">
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">
                  {formMode === 'crear' ? 'Nueva categoría' : 'Editar categoría'}
                </h3>
                <button type="button" onClick={closeForm}
                  className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {formJsx}
            </div>
          </div>
        )}
      </div>

      <Dialog open={formMode !== 'idle' && !isDesktop} onClose={closeForm} title={formMode === 'crear' ? 'Nueva categoría' : 'Editar categoría'}>
        {formJsx}
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

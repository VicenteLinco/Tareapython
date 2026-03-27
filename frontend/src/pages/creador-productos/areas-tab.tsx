import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import api from '@/lib/api'
import { toast } from 'sonner'
import type { Area, CreateArea, UpdateArea } from '@/types'

export default function AreasTab() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Area | null>(null)
  const [nombre, setNombre] = useState('')
  const [esBodega, setEsBodega] = useState(false)
  const [frecuenciaDias, setFrecuenciaDias] = useState(0)

  const { data: areas = [], isLoading } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: CreateArea) => api.post('/areas', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      toast.success('Área creada')
      closeDialog()
    },
    onError: () => toast.error('Error al crear área'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateArea }) =>
      api.put(`/areas/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      toast.success('Área actualizada')
      closeDialog()
    },
    onError: () => toast.error('Error al actualizar área'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/areas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] })
      toast.success('Área eliminada')
    },
    onError: () => toast.error('No se puede eliminar: tiene stock asociado'),
  })

  function openCreate() {
    setEditing(null)
    setNombre('')
    setEsBodega(false)
    setFrecuenciaDias(0)
    setDialogOpen(true)
  }

  function openEdit(area: Area) {
    setEditing(area)
    setNombre(area.nombre)
    setEsBodega(area.es_bodega)
    setFrecuenciaDias(area.conteo_frecuencia_dias ?? 0)
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
      updateMut.mutate({ id: editing.id, data: { nombre: nombre.trim(), es_bodega: esBodega, conteo_frecuencia_dias: frecuenciaDias } })
    } else {
      createMut.mutate({ nombre: nombre.trim(), es_bodega: esBodega })
    }
  }

  function handleDelete(area: Area) {
    if (confirm(`¿Eliminar el área "${area.nombre}"?`)) {
      deleteMut.mutate(area.id)
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const columns = [
    {
      key: 'nombre',
      header: 'Nombre',
      render: (item: Area) => <span className="font-medium text-sm">{item.nombre}</span>,
    },
    {
      key: 'es_bodega',
      header: 'Tipo',
      render: (item: Area) => (
        item.es_bodega
          ? <Badge variant="info">Bodega</Badge>
          : <Badge variant="secondary">Área</Badge>
      ),
    },
    {
      key: 'activa',
      header: 'Estado',
      render: (item: Area) => (
        item.activa
          ? <Badge variant="success">Activa</Badge>
          : <Badge variant="outline">Inactiva</Badge>
      ),
    },
    {
      key: 'conteo_frecuencia_dias',
      header: 'Conteo programado',
      className: 'hidden md:table-cell',
      render: (item: Area) => {
        const f = item.conteo_frecuencia_dias ?? 0
        const labels: Record<number, string> = { 0: '—', 7: 'Semanal', 14: 'Quincenal', 30: 'Mensual', 90: 'Trimestral' }
        return <span className="text-xs opacity-60">{labels[f] ?? `${f} días`}</span>
      },
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-20',
      render: (item: Area) => (
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
          Nueva área
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={areas as unknown as Record<string, unknown>[]}
          emptyMessage="No hay áreas registradas"
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title={editing ? 'Editar área' : 'Nueva área'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Nombre *</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Hematología"
              autoFocus
              required
            />
          </div>
          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={esBodega}
                onChange={(e) => setEsBodega(e.target.checked)}
              />
              <div>
                <span className="label-text text-sm font-medium">Es bodega</span>
                <p className="text-xs opacity-40">Las bodegas son áreas de almacenamiento central</p>
              </div>
            </label>
          </div>
          {editing && (
            <div className="form-control">
              <label className="label"><span className="label-text text-sm font-medium">Frecuencia de conteo</span></label>
              <select
                className="select select-bordered select-sm h-9"
                value={frecuenciaDias}
                onChange={(e) => setFrecuenciaDias(Number(e.target.value))}
              >
                <option value={0}>Sin programación</option>
                <option value={7}>Semanal (7 días)</option>
                <option value={14}>Quincenal (14 días)</option>
                <option value={30}>Mensual (30 días)</option>
                <option value={90}>Trimestral (90 días)</option>
              </select>
            </div>
          )}
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

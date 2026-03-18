import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Plane, Truck } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Dialog } from '@/components/ui/dialog'
import api from '@/lib/api'
import { toast } from 'sonner'
import type { Proveedor, CreateProveedor, UpdateProveedor } from '@/types'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const EMPTY_FORM = {
  nombre: '',
  contacto: '',
  telefono: '',
  email: '',
  icono: '',
  dias_despacho_aereo: '',
  dias_despacho_tierra: '',
}

export default function ProveedoresTab() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Proveedor | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const { data: proveedores = [], isLoading } = useQuery({
    queryKey: ['proveedores', search],
    queryFn: () =>
      api.get<Proveedor[]>('/proveedores', { params: { q: search || undefined } }).then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: CreateProveedor) => api.post('/proveedores', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor creado')
      closeDialog()
    },
    onError: () => toast.error('Error al crear proveedor'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProveedor }) =>
      api.put(`/proveedores/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor actualizado')
      closeDialog()
    },
    onError: (err: any) => {
      if (err.response?.status === 409) {
        toast.error('Conflicto de versión: otro usuario modificó este registro')
      } else {
        toast.error('Error al actualizar proveedor')
      }
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/proveedores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor desactivado')
    },
    onError: () => toast.error('Error al desactivar proveedor'),
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(p: Proveedor) {
    setEditing(p)
    setForm({
      nombre: p.nombre,
      contacto: p.contacto ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      icono: p.icono ?? '',
      dias_despacho_aereo: p.dias_despacho_aereo != null ? String(p.dias_despacho_aereo) : '',
      dias_despacho_tierra: p.dias_despacho_tierra != null ? String(p.dias_despacho_tierra) : '',
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditing(null)
  }

  async function handleIconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024) {
      toast.error('El icono no debe superar 100 KB')
      return
    }
    const b64 = await fileToBase64(file)
    setForm((f) => ({ ...f, icono: b64 }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    const clean: CreateProveedor = {
      nombre: form.nombre.trim(),
      contacto: form.contacto.trim() || undefined,
      telefono: form.telefono.trim() || undefined,
      email: form.email.trim() || undefined,
      icono: form.icono || undefined,
      dias_despacho_aereo: form.dias_despacho_aereo ? Number(form.dias_despacho_aereo) : undefined,
      dias_despacho_tierra: form.dias_despacho_tierra ? Number(form.dias_despacho_tierra) : undefined,
    }
    if (editing) {
      updateMut.mutate({ id: editing.id, data: { ...clean, version: editing.version } })
    } else {
      createMut.mutate(clean)
    }
  }

  function handleDelete(p: Proveedor) {
    if (confirm(`¿Desactivar al proveedor "${p.nombre}"?`)) {
      deleteMut.mutate(p.id)
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const columns = [
    {
      key: 'nombre',
      header: 'Proveedor',
      render: (item: Proveedor) => (
        <div className="flex items-center gap-2">
          <div className="relative h-6 w-6 shrink-0 flex items-center justify-center">
            {!item.icono && <Truck className="h-6 w-6 opacity-25" />}
            {item.icono && (
              <img
                src={item.icono}
                alt=""
                className="absolute inset-0 h-full w-full rounded object-contain"
                style={{ mixBlendMode: 'multiply' }}
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            )}
          </div>
          <span className="font-medium text-sm">{item.nombre}</span>
        </div>
      ),
    },
    {
      key: 'contacto',
      header: 'Contacto',
      className: 'hidden md:table-cell',
      render: (item: Proveedor) => <span className="text-sm opacity-50">{item.contacto || '--'}</span>,
    },
    {
      key: 'despacho',
      header: 'Despacho',
      className: 'hidden lg:table-cell',
      render: (item: Proveedor) => (
        <div className="flex gap-2 text-xs text-base-content/50">
          {item.dias_despacho_aereo != null && (
            <span className="flex items-center gap-0.5">
              <Plane className="h-3 w-3" />{item.dias_despacho_aereo}d
            </span>
          )}
          {item.dias_despacho_tierra != null && (
            <span className="flex items-center gap-0.5">
              <Truck className="h-3 w-3" />{item.dias_despacho_tierra}d
            </span>
          )}
          {item.dias_despacho_aereo == null && item.dias_despacho_tierra == null && '--'}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      className: 'hidden lg:table-cell',
      render: (item: Proveedor) => <span className="text-sm opacity-50">{item.email || '--'}</span>,
    },
    {
      key: 'acciones',
      header: '',
      className: 'w-20',
      render: (item: Proveedor) => (
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
      <div className="flex flex-wrap gap-2.5 justify-between">
        <label className="input input-bordered input-sm flex items-center gap-2 flex-1 min-w-[200px] max-w-sm h-9">
          <Search className="h-3.5 w-3.5 opacity-35" />
          <input
            type="text"
            className="grow text-sm"
            placeholder="Buscar proveedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="btn btn-primary btn-sm gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nuevo proveedor
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={proveedores as unknown as Record<string, unknown>[]}
          emptyMessage="No hay proveedores registrados"
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title={editing ? 'Editar proveedor' : 'Nuevo proveedor'} className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Icono + Nombre */}
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div
                className="h-14 w-14 rounded-lg border border-base-300 bg-base-200 flex items-center justify-center overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => fileRef.current?.click()}
                title="Clic para cambiar icono"
              >
                {form.icono ? (
                  <img src={form.icono} alt="icono" className="h-full w-full object-contain" style={{ mixBlendMode: 'multiply' }} />
                ) : (
                  <Truck className="h-6 w-6 opacity-20" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleIconChange}
              />
              <p className="text-[10px] text-center opacity-40 mt-0.5">Logo</p>
            </div>
            <div className="form-control flex-1">
              <label className="label"><span className="label-text text-sm font-medium">Nombre *</span></label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del proveedor"
                autoFocus
                required
              />
            </div>
          </div>

          {/* Contacto */}
          <div className="form-control">
            <label className="label"><span className="label-text text-sm font-medium">Contacto</span></label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              value={form.contacto}
              onChange={(e) => setForm((f) => ({ ...f, contacto: e.target.value }))}
              placeholder="Nombre de contacto"
            />
          </div>

          {/* Teléfono + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label"><span className="label-text text-sm font-medium">Teléfono</span></label>
              <input
                type="tel"
                className="input input-bordered input-sm h-9"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                placeholder="+58..."
              />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text text-sm font-medium">Email</span></label>
              <input
                type="email"
                className="input input-bordered input-sm h-9"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="correo@ejemplo.com"
              />
            </div>
          </div>

          {/* Tiempos de despacho */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-base-content/40 mb-2">Tiempo de despacho</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-sm font-medium flex items-center gap-1">
                    <Plane className="h-3.5 w-3.5 opacity-60" /> Aéreo (días)
                  </span>
                </label>
                <input
                  type="number"
                  className="input input-bordered input-sm h-9"
                  value={form.dias_despacho_aereo}
                  onChange={(e) => setForm((f) => ({ ...f, dias_despacho_aereo: e.target.value }))}
                  placeholder="Ej: 2"
                  min="1"
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text text-sm font-medium flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5 opacity-60" /> Terrestre (días)
                  </span>
                </label>
                <input
                  type="number"
                  className="input input-bordered input-sm h-9"
                  value={form.dias_despacho_tierra}
                  onChange={(e) => setForm((f) => ({ ...f, dias_despacho_tierra: e.target.value }))}
                  placeholder="Ej: 7"
                  min="1"
                />
              </div>
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

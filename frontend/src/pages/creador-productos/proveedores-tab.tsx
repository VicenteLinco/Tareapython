import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Plane, Truck, RotateCcw } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
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
  const [verInactivos, setVerInactivos] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Proveedor | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<Proveedor | null>(null)
  const [reactivateTarget, setReactivateTarget] = useState<Proveedor | null>(null)

  const { data: proveedores = [], isLoading } = useQuery({
    queryKey: ['proveedores', { search, activo: !verInactivos }],
    queryFn: () =>
      api.get<Proveedor[]>('/proveedores', { 
        params: { 
          q: search || undefined,
          activo: !verInactivos
        } 
      }).then((r) => r.data),
  })

  const createMut = useMutation({
    mutationFn: (data: CreateProveedor) => api.post('/proveedores', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor creado')
      closeDialog()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProveedor }) =>
      api.put(`/proveedores/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor actualizado')
      closeDialog()
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/proveedores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor desactivado')
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const reactivarMut = useMutation({
    mutationFn: (id: number) => api.post(`/proveedores/${id}/reactivar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      toast.success('Proveedor reactivado')
      setReactivateTarget(null)
    },
    onError: (err) => toast.error(parseApiError(err)),
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
    const b64 = await fileToBase64(file)
    setForm((f) => ({ ...f, icono: b64 }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    const clean: any = {
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

  const columns = [
    {
      key: 'nombre',
      header: 'Proveedor',
      width: '280px',
      render: (item: Proveedor) => (
        <div className={`flex items-center gap-3 w-full overflow-hidden ${!item.activo ? 'opacity-50' : ''}`} title={item.nombre}>
          <ProveedorIcon proveedor={item} className="h-8 w-8 shrink-0 bg-base-200 rounded p-0.5" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-semibold text-sm truncate">{item.nombre}</span>
            {item.contacto && (
              <span className="text-[10px] opacity-40 truncate">{item.contacto}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'contacto_info',
      header: 'Contacto',
      width: '180px',
      className: 'hidden md:table-cell',
      render: (item: Proveedor) => (
        <div className={`flex flex-col min-w-0 w-full overflow-hidden ${!item.activo ? 'opacity-50' : ''}`}>
          <span className="text-xs truncate">{item.email || '--'}</span>
          <span className="text-[10px] opacity-50 truncate">{item.telefono || ''}</span>
        </div>
      ),
    },
    {
      key: 'despacho',
      header: 'Tiempos',
      className: 'hidden lg:table-cell',
      width: '120px',
      render: (item: Proveedor) => (
        <div className={`flex gap-2 text-[10px] opacity-60 ${!item.activo ? 'opacity-30' : ''}`}>
          <span className="flex items-center gap-1"><Plane className="h-3 w-3" /> {item.dias_despacho_aereo ?? '-'}d</span>
          <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {item.dias_despacho_tierra ?? '-'}d</span>
        </div>
      ),
    },
    {
      key: 'acciones',
      header: '',
      width: '80px',
      render: (item: Proveedor) => (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {item.activo ? (
            <>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => openEdit(item)}>
                <Pencil className="h-3.5 w-3.5 opacity-40" />
              </button>
              <button className="btn btn-ghost btn-xs btn-square" onClick={() => setDeleteTarget(item)}>
                <Trash2 className="h-3.5 w-3.5 opacity-40 hover:text-error" />
              </button>
            </>
          ) : (
            <button className="btn btn-ghost btn-xs btn-square" title="Reactivar" onClick={() => setReactivateTarget(item)}>
              <RotateCcw className="h-3.5 w-3.5 opacity-60 text-primary" />
            </button>
          )}
        </div>
      ),
    },
  ]

  const isSaving = createMut.isPending || updateMut.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <div className="flex flex-wrap gap-2.5 flex-1 items-center">
          <label className="input input-bordered input-sm flex items-center gap-2 flex-1 max-w-sm h-9">
            <Search className="h-3.5 w-3.5 opacity-35" />
            <input
              type="text"
              className="grow text-sm"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input 
              type="checkbox" 
              className="checkbox checkbox-xs checkbox-primary" 
              checked={verInactivos}
              onChange={(e) => setVerInactivos(e.target.checked)}
            />
            <span className="text-xs opacity-60">Ver inactivos</span>
          </label>
        </div>
        <button className="btn btn-primary btn-sm gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Nuevo
        </button>
      </div>

      {isLoading ? (
        <div className="skeleton h-64 w-full rounded-xl" />
      ) : (
        <DataTable
          columns={columns as any}
          data={proveedores as any}
          emptyMessage="No hay proveedores"
        />
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} title={editing ? 'Editar Proveedor' : 'Nuevo Proveedor'} className="max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-3">
            <div className="shrink-0">
              <div 
                className="h-16 w-16 rounded-xl border-2 border-dashed border-base-300 bg-base-100 flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/40 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                {form.icono ? <img src={form.icono} alt="" className="h-full w-full object-contain" /> : <Truck className="h-6 w-6 opacity-20" />}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleIconChange} />
            </div>
            <div className="form-control flex-1">
              <label className="label py-1"><span className="label-text text-xs font-semibold">Nombre *</span></label>
              <input
                type="text"
                className="input input-bordered input-md w-full"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="form-control col-span-2">
              <label className="label py-1"><span className="label-text text-xs font-semibold">Email</span></label>
              <input type="email" className="input input-bordered input-sm" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs font-semibold">Teléfono</span></label>
              <input type="tel" className="input input-bordered input-sm" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            </div>
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs font-semibold">Ejecutivo</span></label>
              <input type="text" className="input input-bordered input-sm" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm px-6" disabled={isSaving}>
              {isSaving ? <span className="loading loading-spinner loading-xs mr-2" /> : null}
              {isSaving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Desactivar proveedor"
        description={`¿Estás seguro de desactivar "${deleteTarget?.nombre}"?`}
        confirmLabel="Desactivar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        title="Reactivar proveedor"
        description={`¿Quieres volver a activar "${reactivateTarget?.nombre}"?`}
        confirmLabel="Reactivar"
        variant="warning"
        loading={reactivarMut.isPending}
        onClose={() => setReactivateTarget(null)}
        onConfirm={() => reactivateTarget && reactivarMut.mutate(reactivateTarget.id)}
      />
    </div>
  )
}

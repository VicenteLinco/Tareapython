import { useRef, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, Plane, Truck, RotateCcw, X } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { PageLoading } from '@/components/ui/page-state'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProveedorIcon } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
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

export default function ProveedoresTab() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const isDesktop = useIsDesktop()
  const [search, setSearch] = useState('')
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [verInactivos, setVerInactivos] = useState(false)
  const [formMode, setFormMode] = useState<'idle' | 'crear' | 'editar'>('idle')
  const [selectedItem, setSelectedItem] = useState<Proveedor | null>(null)
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
      notify.success('Proveedor creado')
      closeForm()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateProveedor }) =>
      api.put(`/proveedores/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      notify.success('Proveedor actualizado')
      closeForm()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/proveedores/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      notify.success('Proveedor desactivado')
      setDeleteTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const reactivarMut = useMutation({
    mutationFn: (id: number) => api.post(`/proveedores/${id}/reactivar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'] })
      notify.success('Proveedor reactivado')
      setReactivateTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  function openCreate() {
    setSelectedItem(null)
    setForm(EMPTY_FORM)
    setFormMode('crear')
  }

  function openEdit(p: Proveedor) {
    setSelectedItem(p)
    setForm({
      nombre: p.nombre,
      contacto: p.contacto ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      icono: p.icono ?? '',
      dias_despacho_aereo: p.dias_despacho_aereo != null ? String(p.dias_despacho_aereo) : '',
      dias_despacho_tierra: p.dias_despacho_tierra != null ? String(p.dias_despacho_tierra) : '',
    })
    setFormMode('editar')
  }

  function closeForm() {
    setFormMode('idle')
    setSelectedItem(null)
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
    const clean: CreateProveedor = {
      nombre: form.nombre.trim(),
      contacto: form.contacto.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      icono: form.icono || null,
      dias_despacho_aereo: form.dias_despacho_aereo ? Number(form.dias_despacho_aereo) : null,
      dias_despacho_tierra: form.dias_despacho_tierra ? Number(form.dias_despacho_tierra) : null,
    }
    if (selectedItem) {
      updateMut.mutate({ id: selectedItem.id, data: { ...clean, version: selectedItem.version } })
    } else {
      createMut.mutate(clean)
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending

  const formJsx = (
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeForm}>Cancelar</button>
        <button type="submit" className="btn btn-primary btn-sm px-6" disabled={isSaving}>
          {isSaving ? <span className="loading loading-spinner loading-xs mr-2" /> : null}
          {isSaving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )

  const columns = [
    {
      key: 'nombre',
      header: 'Proveedor',
      width: '280px',
      render: (item: Proveedor) => (
        <div className={`flex items-center gap-3 w-full overflow-hidden ${!item.activa ? 'opacity-50' : ''}`} title={item.nombre}>
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
        <div className={`flex flex-col min-w-0 w-full overflow-hidden ${!item.activa ? 'opacity-50' : ''}`}>
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
        <div className={`flex gap-2 text-[10px] opacity-60 ${!item.activa ? 'opacity-30' : ''}`}>
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
          {item.activa ? (
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

  useEffect(() => { setSearchActiveIndex(-1) }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node))
        setSearchDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (searchActiveIndex >= 0)
      searchItemRefs.current[searchActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [searchActiveIndex])

  const searchSuggestions = proveedores.slice(0, 16)
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0

  const groupedSearchItems = (() => {
    const result: ({ type: 'header'; letter: string } | { type: 'item'; item: typeof proveedores[number]; idx: number })[] = []
    let lastL = ''
    searchSuggestions.forEach((item, idx) => {
      const l = item.nombre[0]?.toUpperCase() ?? '#'
      if (l !== lastL) { result.push({ type: 'header', letter: l }); lastL = l }
      result.push({ type: 'item', item, idx })
    })
    return result
  })()

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!searchDropdownOpen) setSearchDropdownOpen(true)
      if (searchSuggestions.length === 0) return
      setSearchActiveIndex(i => i < searchSuggestions.length - 1 ? i + 1 : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (searchSuggestions.length === 0) return
      setSearchActiveIndex(i => i > 0 ? i - 1 : searchSuggestions.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
        setSearch(searchSuggestions[searchActiveIndex].nombre)
        setSearchDropdownOpen(false)
        setSearchActiveIndex(-1)
      }
    } else if (e.key === 'Escape') {
      setSearchDropdownOpen(false)
      setSearchActiveIndex(-1)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <div className="flex flex-wrap gap-2.5 flex-1 items-center">
          <div ref={searchContainerRef} className="relative flex-1 max-w-sm">
            <label className="input input-bordered input-sm flex items-center gap-2 h-9 w-full">
              <Search className="h-3.5 w-3.5 opacity-35 shrink-0" />
              <input
                type="text"
                className="grow text-sm"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSearchDropdownOpen(true) }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setSearchDropdownOpen(true)}
                aria-autocomplete="list"
                aria-expanded={showSearchDropdown}
              />
            </label>
            {showSearchDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-72" role="listbox">
                {groupedSearchItems.map(entry =>
                  entry.type === 'header' ? (
                    <div key={`h-${entry.letter}`} className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-base-content/30 bg-base-200/40 sticky top-0">
                      {entry.letter}
                    </div>
                  ) : (
                    <div
                      key={entry.item.id}
                      ref={el => { searchItemRefs.current[entry.idx] = el }}
                      role="option"
                      aria-selected={entry.idx === searchActiveIndex}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors",
                        entry.idx === searchActiveIndex ? "bg-primary/10 text-primary" : "hover:bg-base-200/60"
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSearch(entry.item.nombre)
                        setSearchDropdownOpen(false)
                        setSearchActiveIndex(-1)
                      }}
                    >
                      {entry.item.icono && <span className="text-base shrink-0">{entry.item.icono}</span>}
                      <span className="font-medium truncate">{entry.item.nombre}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
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

      <div className="flex gap-6 items-start">
        <div className={cn('min-w-0', formMode !== 'idle' ? 'lg:flex-[3]' : 'w-full')}>
          {isLoading ? (
            <PageLoading label="Cargando proveedores..." />
          ) : (
            <DataTable
              columns={columns}
              data={proveedores}
              emptyMessage="No hay proveedores"
              onRowClick={(item) => item.activa ? openEdit(item) : undefined}
              selectedId={formMode !== 'idle' ? selectedItem?.id : undefined}
            />
          )}
        </div>

        {formMode !== 'idle' && isDesktop && (
          <div className="hidden lg:flex flex-col min-w-0 lg:flex-[2] lg:sticky lg:top-24">
            <div className="rounded-xl border border-base-300 bg-base-100 flex flex-col max-h-[calc(100vh-120px)]">
              <div className="flex items-center justify-between p-5 pb-0 mb-4 shrink-0">
                <h3 className="font-semibold text-sm">
                  {formMode === 'crear' ? 'Nuevo Proveedor' : 'Editar Proveedor'}
                </h3>
                <button type="button" onClick={closeForm}
                  className="text-base-content/50 hover:text-base-content">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {formJsx}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={formMode !== 'idle' && !isDesktop} onClose={closeForm} title={formMode === 'crear' ? 'Nuevo Proveedor' : 'Editar Proveedor'} className="max-w-md">
        {formJsx}
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

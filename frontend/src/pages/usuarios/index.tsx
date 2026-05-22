import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, UserX, UserCheck, KeyRound, X, Search, ShieldCheck, FlaskConical, BookOpen } from 'lucide-react'
import { notify } from '@/lib/notify'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageLoading } from '@/components/ui/page-state'
import type { Area } from '@/types'
import type {
  UsuarioResponse,
  AreaSimple,
  CreateUsuario,
  UpdateUsuario
} from '@/types/generated'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROL_CONFIG = {
  admin:     { label: 'Admin',      badgeCls: 'bg-error/10 text-error border border-error/20',         icon: ShieldCheck,    avatarBg: 'bg-error/10',    avatarFg: 'text-error' },
  tecnologo: { label: 'Tecnólogo',  badgeCls: 'bg-primary/10 text-primary border border-primary/20',   icon: FlaskConical,   avatarBg: 'bg-primary/10',  avatarFg: 'text-primary' },
  consulta:  { label: 'Consulta',   badgeCls: 'bg-base-200 text-base-content/60 border border-base-300', icon: BookOpen,     avatarBg: 'bg-base-200',    avatarFg: 'text-base-content/50' },
} as const

function RolBadge({ rol }: { rol: string }) {
  const c = ROL_CONFIG[rol as keyof typeof ROL_CONFIG] ?? { label: rol, badgeCls: 'bg-base-200 text-base-content/60 border border-base-300' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${c.badgeCls}`}>
      {c.label}
    </span>
  )
}

function RolAvatar({ rol }: { rol: string }) {
  const c = ROL_CONFIG[rol as keyof typeof ROL_CONFIG] ?? ROL_CONFIG.consulta
  const Icon = c.icon
  return (
    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${c.avatarBg}`}>
      <Icon className={`w-5 h-5 ${c.avatarFg}`} strokeWidth={1.75} />
    </div>
  )
}

// ─── Modal crear / editar ─────────────────────────────────────────────────────

interface ModalUsuarioProps {
  open: boolean
  onClose: () => void
  usuario?: UsuarioResponse | null
  areas: AreaSimple[]
}

const EMPTY_FORM = {
  nombre: '',
  email: '',
  password: '',
  rol: 'tecnologo' as string,
  area_ids: [] as number[],
}

function ModalUsuario({ open, onClose, usuario, areas }: ModalUsuarioProps) {
  const qc = useQueryClient()
  const isEdit = !!usuario

  const [form, setForm] = useState(() =>
    usuario
      ? {
          nombre: usuario.nombre,
          email: usuario.email,
          password: '',
          rol: usuario.rol,
          area_ids: usuario.areas.map((a) => a.id),
          version: usuario.version,
        }
      : { ...EMPTY_FORM, version: 1 }
  )

  // Reset cuando cambia el usuario a editar
  const [prevUsuario, setPrevUsuario] = useState(usuario)
  if (usuario !== prevUsuario) {
    setPrevUsuario(usuario)
    setForm(
      usuario
        ? { 
            nombre: usuario.nombre, 
            email: usuario.email, 
            password: '', 
            rol: usuario.rol, 
            area_ids: usuario.areas.map((a) => a.id),
            version: usuario.version
          }
        : { ...EMPTY_FORM, version: 1 }
    )
  }

  const createMut = useMutation({
    mutationFn: (data: CreateUsuario) => api.post('/usuarios', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      notify.success('Usuario creado')
      onClose()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const updateMut = useMutation({
    mutationFn: (data: UpdateUsuario) =>
      api.put(`/usuarios/${usuario!.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      notify.success('Usuario actualizado')
      onClose()
    },
    onError: (err: unknown) => {
      const apiErr = err as { response?: { status?: number } }
      if (apiErr.response?.status === 409) {
        notify.error('Conflicto: El usuario fue modificado por otro administrador. Recarga la lista.')
      } else {
        notify.error(parseApiError(err))
      }
    },
  })

  const isPending = createMut.isPending || updateMut.isPending

  const [busquedaArea, setBusquedaArea] = useState('')
  const areasFiltered = areas.filter(a =>
    a.nombre.toLowerCase().includes(busquedaArea.toLowerCase())
  )

  function toggleArea(id: number) {
    setForm((f) => ({
      ...f,
      area_ids: f.area_ids.includes(id)
        ? f.area_ids.filter((a) => a !== id)
        : [...f.area_ids, id],
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nombre.trim() || !form.email.trim()) return
    if (isEdit) {
      updateMut.mutate({
        nombre: form.nombre,
        email: form.email,
        rol: form.rol,
        area_ids: form.area_ids,
        version: form.version,
      })
    } else {
      if (!form.password) { notify.error('La contraseña es obligatoria'); return }
      createMut.mutate(form)
    }
  }

  if (!open) return null
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <button className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3" onClick={onClose}>
          <X className="w-4 h-4" />
        </button>

        <h3 className="font-semibold text-lg mb-5">
          {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
        </h3>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Nombre */}
          <div className="form-control">
            <label className="label"><span className="label-text">Nombre</span></label>
            <input
              type="text"
              className="input input-bordered input-sm"
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              required
            />
          </div>

          {/* Email */}
          <div className="form-control">
            <label className="label"><span className="label-text">Email</span></label>
            <input
              type="email"
              className="input input-bordered input-sm"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>

          {/* Password (solo al crear) */}
          {!isEdit && (
            <div className="form-control">
              <label className="label"><span className="label-text">Contraseña</span></label>
              <input
                type="password"
                className="input input-bordered input-sm"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                minLength={8}
                required
              />
            </div>
          )}

          {/* Rol */}
          <div className="form-control">
            <label className="label"><span className="label-text">Rol</span></label>
            <select
              className="select select-bordered select-sm"
              value={form.rol}
              onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}
            >
              <option value="admin">Admin</option>
              <option value="tecnologo">Tecnólogo</option>
              <option value="consulta">Consulta</option>
            </select>
          </div>

          {/* Áreas */}
          <div className="form-control">
            <label className="label">
              <span className="label-text">Áreas asignadas</span>
              <span className="label-text-alt text-base-content/40">{form.area_ids.length} seleccionadas</span>
            </label>
            <input
              type="text"
              className="input input-xs input-bordered w-full rounded-lg mb-1"
              placeholder="Buscar área…"
              value={busquedaArea}
              onChange={e => setBusquedaArea(e.target.value)}
            />
            <div className="flex flex-wrap gap-2 p-3 border border-base-300 rounded-lg max-h-40 overflow-y-auto">
              {areasFiltered.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs checkbox-primary"
                    checked={form.area_ids.includes(a.id)}
                    onChange={() => toggleArea(a.id)}
                  />
                  <span className="text-sm">{a.nombre}</span>
                </label>
              ))}
              {areasFiltered.length === 0 && (
                <span className="text-sm text-base-content/40">
                  {busquedaArea ? 'Sin áreas que coincidan' : 'No hay áreas disponibles'}
                </span>
              )}
            </div>
          </div>

          <div className="modal-action mt-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={isPending}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary btn-sm gap-2" disabled={isPending}>
              {isPending && <span className="loading loading-spinner loading-xs" />}
              {isEdit ? 'Guardar cambios' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}

// ─── Modal cambiar contraseña ─────────────────────────────────────────────────

function ModalPassword({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')

  const mut = useMutation({
    mutationFn: () => api.post(`/usuarios/${userId}/reset-password`, { password_nueva: password }),
    onSuccess: () => {
      notify.success('Contraseña actualizada')
      onClose()
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmar) { notify.error('Las contraseñas no coinciden'); return }
    if (password.length < 8) { notify.error('Mínimo 8 caracteres'); return }
    mut.mutate()
  }

  if (!userId) return null
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <button className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3" onClick={onClose}>
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-semibold mb-4">Cambiar contraseña</h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="form-control">
            <label className="label"><span className="label-text">Nueva contraseña</span></label>
            <input
              type="password"
              className="input input-bordered input-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Confirmar</span></label>
            <input
              type="password"
              className="input input-bordered input-sm"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
            />
          </div>
          <div className="modal-action mt-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm gap-2" disabled={mut.isPending}>
              {mut.isPending && <span className="loading loading-spinner loading-xs" />}
              Guardar
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function UsuariosPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filtroRol, setFiltroRol] = useState('')
  const [filtroActivo, setFiltroActivo] = useState<'activo' | 'inactivo' | ''>('activo')
  const [editando, setEditando] = useState<UsuarioResponse | null | undefined>(undefined) // undefined = cerrado
  const [passwordId, setPasswordId] = useState<string | null>(null)
  const [toggleTarget, setToggleTarget] = useState<UsuarioResponse | null>(null)

  const { data: usuarios = [], isLoading } = useQuery<UsuarioResponse[]>({
    queryKey: ['usuarios', filtroRol, filtroActivo],
    queryFn: () =>
      api.get('/usuarios', {
        params: {
          rol: filtroRol || undefined,
          activo: filtroActivo === '' ? undefined : filtroActivo === 'activo',
        },
      }).then((r) => r.data),
  })

  const { data: areas = [] } = useQuery<Area[]>({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const toggleActivoMut = useMutation({
    mutationFn: (u: UsuarioResponse) =>
      u.activo
        ? api.delete(`/usuarios/${u.id}`)
        : api.put(`/usuarios/${u.id}`, { 
            nombre: u.nombre, 
            email: u.email, 
            rol: u.rol, 
            area_ids: u.areas.map((a) => a.id),
            version: u.version
          }),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ['usuarios'] })
      notify.success(u.activo ? 'Usuario desactivado' : 'Usuario reactivado')
      setToggleTarget(null)
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const filtrados = usuarios.filter((u) =>
    !search ||
    u.nombre.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            {usuarios.filter((u) => u.activo).length} activos · {usuarios.filter((u) => !u.activo).length} inactivos
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={() => setEditando(null)}
        >
          <Plus className="w-4 h-4" />
          Nuevo usuario
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
          <input
            type="text"
            className="input input-bordered input-sm w-full pl-9"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="select select-bordered select-sm"
          value={filtroRol}
          onChange={(e) => setFiltroRol(e.target.value)}
        >
          <option value="">Todos los roles</option>
          <option value="admin">Admin</option>
          <option value="tecnologo">Tecnólogo</option>
          <option value="consulta">Consulta</option>
        </select>
        <select
          className="select select-bordered select-sm"
          value={filtroActivo}
          onChange={(e) => setFiltroActivo(e.target.value as typeof filtroActivo)}
        >
          <option value="activo">Activos</option>
          <option value="inactivo">Inactivos</option>
          <option value="">Todos</option>
        </select>
      </div>

      {/* Grid de tarjetas */}
      {isLoading ? (
        <PageLoading label="Cargando usuarios..." />
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="p-4 bg-base-200 rounded-full">
            <UserX className="w-8 h-8 text-base-content/30" />
          </div>
          <p className="font-medium text-base-content/70">Sin usuarios</p>
          <p className="text-sm text-base-content/40">
            {search ? 'No hay resultados para esa búsqueda.' : 'No hay usuarios con esos filtros.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtrados.map((u) => (
            <div
              key={u.id}
              className={`group relative bg-base-100 border rounded-2xl shadow-sm transition-all duration-200
                hover:shadow-md hover:border-primary/30
                ${u.activo ? 'border-base-200' : 'border-base-200 grayscale opacity-55'}`}
            >
              <div className="p-4">
                {/* Header tarjeta */}
                <div className="flex items-start gap-3">
                  <RolAvatar rol={u.rol} />
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="font-semibold text-sm leading-tight truncate">{u.nombre}</p>
                    <p className="text-xs text-base-content/45 truncate mt-0.5">{u.email}</p>
                  </div>
                  <RolBadge rol={u.rol} />
                </div>

                {/* Áreas */}
                <div className="flex flex-wrap gap-1 mt-3 min-h-[22px]">
                  {u.areas.slice(0, 3).map((a) => (
                    <span key={a.id} className="inline-flex items-center px-2 py-0.5 rounded-lg bg-base-200 text-[11px] text-base-content/60">{a.nombre}</span>
                  ))}
                  {u.areas.length > 3 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-base-200 text-[11px] text-base-content/60">+{u.areas.length - 3} más</span>
                  )}
                  {u.areas.length === 0 && (
                    <span className="text-[11px] text-base-content/30 italic">Sin áreas asignadas</span>
                  )}
                </div>

                {/* Separador + Acciones */}
                <div className="flex items-center justify-end gap-0.5 mt-3 pt-3 border-t border-base-200">
                  <button
                    className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content"
                    onClick={() => setPasswordId(u.id)}
                    title="Cambiar contraseña"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Contraseña</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-xs gap-1 text-base-content/50 hover:text-base-content"
                    onClick={() => setEditando(u)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    className={`btn btn-ghost btn-xs gap-1 ${u.activo ? 'text-error/60 hover:text-error hover:bg-error/5' : 'text-success/70 hover:text-success hover:bg-success/5'}`}
                    onClick={() => setToggleTarget(u)}
                  >
                    {u.activo
                      ? <><UserX className="w-3.5 h-3.5" />Desactivar</>
                      : <><UserCheck className="w-3.5 h-3.5" />Activar</>
                    }
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal crear/editar */}
      <ModalUsuario
        open={editando !== undefined}
        onClose={() => setEditando(undefined)}
        usuario={editando ?? null}
        areas={areas}
      />

      {/* Modal cambiar contraseña */}
      <ModalPassword
        userId={passwordId}
        onClose={() => setPasswordId(null)}
      />

      {/* Confirm desactivar/activar */}
      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => toggleTarget && toggleActivoMut.mutate(toggleTarget)}
        loading={toggleActivoMut.isPending}
        variant={toggleTarget?.activo ? 'danger' : 'warning'}
        title={toggleTarget?.activo ? 'Desactivar usuario' : 'Activar usuario'}
        description={
          toggleTarget?.activo
            ? `${toggleTarget.nombre} no podrá iniciar sesión hasta que lo reactives.`
            : `${toggleTarget?.nombre} podrá volver a iniciar sesión.`
        }
        confirmLabel={toggleTarget?.activo ? 'Sí, desactivar' : 'Sí, activar'}
      />
    </div>
  )
}

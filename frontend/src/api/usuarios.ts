// Dominio: usuarios
import api from '@/lib/api'
import type {
  UsuarioResponse,
  CreateUsuario,
  UpdateUsuario,
  UsuarioQuery,
  ResetPasswordRequest,
} from '@/types/generated'

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /usuarios — Listar usuarios con filtros opcionales */
export async function listarUsuarios(params?: Partial<UsuarioQuery>): Promise<UsuarioResponse[]> {
  const { data } = await api.get<UsuarioResponse[]>('/usuarios', { params })
  return data
}

/** GET /usuarios/:id — Obtener detalle de un usuario */
export async function detalleUsuario(id: string): Promise<UsuarioResponse> {
  const { data } = await api.get<UsuarioResponse>(`/usuarios/${id}`)
  return data
}

/** POST /usuarios — Crear nuevo usuario */
export async function crearUsuario(payload: CreateUsuario): Promise<UsuarioResponse> {
  const { data } = await api.post<UsuarioResponse>('/usuarios', payload)
  return data
}

/** PUT /usuarios/:id — Actualizar usuario */
export async function actualizarUsuario(id: string, payload: UpdateUsuario): Promise<UsuarioResponse> {
  const { data } = await api.put<UsuarioResponse>(`/usuarios/${id}`, payload)
  return data
}

/** DELETE /usuarios/:id — Desactivar usuario (soft delete) */
export async function eliminarUsuario(id: string): Promise<void> {
  await api.delete(`/usuarios/${id}`)
}

/** POST /usuarios/:id/reset-password — Resetear contraseña de un usuario */
export async function resetPassword(id: string, payload: ResetPasswordRequest): Promise<void> {
  await api.post(`/usuarios/${id}/reset-password`, payload)
}

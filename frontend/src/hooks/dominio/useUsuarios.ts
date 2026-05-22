import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listarUsuarios,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  resetPassword,
} from '@/api'
import type { CreateUsuario, UpdateUsuario, UsuarioQuery, ResetPasswordRequest } from '@/types/generated'
import { notify } from '@/lib/notify'
import { parseApiError } from '@/lib/api-error'
import { usuariosKeys } from '@/lib/queryKeys'

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useUsuarios(params?: Partial<UsuarioQuery>) {
  return useQuery({
    queryKey: usuariosKeys.list(params),
    queryFn: () => listarUsuarios(params),
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCrearUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateUsuario) => crearUsuario(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usuariosKeys.all })
      notify.success('Usuario creado')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
}

export function useActualizarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUsuario }) =>
      actualizarUsuario(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usuariosKeys.all })
      notify.success('Usuario actualizado')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
}

export function useEliminarUsuario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => eliminarUsuario(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usuariosKeys.all })
      notify.success('Usuario desactivado')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ResetPasswordRequest }) =>
      resetPassword(id, payload),
    onSuccess: () => {
      notify.success('Contraseña restablecida')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
}

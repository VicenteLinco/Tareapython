import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Usuario } from '@/types'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  usuario: Usuario | null
  setTokens: (access: string, refresh: string) => void
  setUsuario: (usuario: Usuario) => void
  login: (access: string, refresh: string, usuario: Usuario) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      usuario: null,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh }),
      setUsuario: (usuario) => set({ usuario }),
      login: (access, refresh, usuario) =>
        set({ accessToken: access, refreshToken: refresh, usuario }),
      logout: () =>
        set({ accessToken: null, refreshToken: null, usuario: null }),
    }),
    { name: 'lab-auth' }
  )
)

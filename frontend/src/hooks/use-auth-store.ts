import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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

// accessToken → sessionStorage (se borra al cerrar tab)
// refreshToken + usuario → localStorage (persiste para re-login silencioso)
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: sessionStorage.getItem('lab-access-token'),
      refreshToken: null,
      usuario: null,
      setTokens: (access, refresh) => {
        sessionStorage.setItem('lab-access-token', access)
        set({ accessToken: access, refreshToken: refresh })
      },
      setUsuario: (usuario) => set({ usuario }),
      login: (access, refresh, usuario) => {
        sessionStorage.setItem('lab-access-token', access)
        set({ accessToken: access, refreshToken: refresh, usuario })
      },
      logout: () => {
        sessionStorage.removeItem('lab-access-token')
        set({ accessToken: null, refreshToken: null, usuario: null })
      },
    }),
    {
      name: 'lab-auth-v2',
      storage: createJSONStorage(() => localStorage),
      // Solo persistir refreshToken y usuario, NO accessToken
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        usuario: state.usuario,
      }),
      version: 2,
      migrate: (_persistedState: unknown, version: number) => {
        if (version < 2) {
          return { refreshToken: null, usuario: null }
        }
        return _persistedState as Partial<AuthState>
      },
    }
  )
)

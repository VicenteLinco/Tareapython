import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Usuario } from '@/types'
import { clearDeviceMode } from '@/lib/device-mode'

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
      accessToken: null,
      refreshToken: null,
      usuario: null,
      setTokens: (access, refresh) => {
        set({ accessToken: access, refreshToken: refresh })
      },
      setUsuario: (usuario) => set({ usuario }),
      login: (access, refresh, usuario) => {
        set({ accessToken: access, refreshToken: refresh, usuario })
      },
      logout: () => {
        set({ accessToken: null, refreshToken: null, usuario: null })
        clearDeviceMode()
        localStorage.removeItem('lab-auth-v3') // Limpieza extra por seguridad
      },
    }),
    {
      name: 'lab-auth-v3',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      // accessToken NO se persiste — se pierde al cerrar el browser/tab
      // refreshToken + usuario sí persisten para re-login silencioso vía interceptor
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        usuario: state.usuario,
      }),
      migrate: (_persistedState: unknown, version: number) => {
        if (version < 3) {
          return { accessToken: null, refreshToken: null, usuario: null }
        }
        return _persistedState as Partial<AuthState>
      },
    }
  )
)

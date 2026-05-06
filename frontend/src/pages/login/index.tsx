import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, ArrowRight } from 'lucide-react'
import fondoLogin from '@/assets/fondo-login.gif'
import { useAuthStore } from '@/hooks/use-auth-store'
import api from '@/lib/api'
import type { LoginResponse, MeResponse, Usuario } from '@/types'
import { clearDeviceMode } from '@/lib/device-mode'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, logout, accessToken } = useAuthStore()
  const navigate = useNavigate()

  // Si llegamos aquí y hay token, limpiamos para evitar inconsistencias
  useEffect(() => {
    if (accessToken) {
      logout()
      clearDeviceMode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Solo al montar

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await api.post<LoginResponse>('/auth/login', { email, password })
      const { access_token, refresh_token } = res.data

      const meRes = await api.get<MeResponse>('/auth/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      
      const usuarioFull: Usuario = {
        ...meRes.data,
        activo: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      
      login(access_token, refresh_token, usuarioFull)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } }
      if (axiosErr.response?.status === 401) {
        setError('Credenciales inválidas')
      } else {
        setError('Error de conexión. Intente nuevamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center relative overflow-hidden">
        <img src={fondoLogin} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 text-center text-white px-12">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm mb-6">
            <FlaskConical className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-3">Labstock Mini </h1>
          <p className="text-sm text-white/70 max-w-xs mx-auto leading-relaxed">
            
          </p>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center bg-base-100 px-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 text-center">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-xl bg-primary mb-4">
              <FlaskConical className="h-6 w-6 text-primary-content" />
            </div>
            <h1 className="text-xl font-bold">Lab Inventario</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold">Iniciar sesión</h2>
            <p className="text-sm opacity-50 mt-1">Ingrese sus credenciales para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-50">Email</label>
              <input
                type="email"
                className="input input-bordered w-full h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@laboratorio.cl"
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-50">Contraseña</label>
              <input
                type="password"
                className="input input-bordered w-full h-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg bg-error/10 border border-error/20 px-4 py-2.5 text-sm text-error font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full h-11 gap-2"
              disabled={loading}
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <>
                  Ingresar
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

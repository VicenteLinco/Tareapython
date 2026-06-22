import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, ArrowRight } from 'lucide-react'
import fondoLogin from '@/assets/fondo-login.gif'
import { useAuthStore } from '@/hooks/use-auth-store'
import api from '@/lib/api'
import type { LoginResponse, MeResponse, Usuario } from '@/types'
import { clearDeviceMode } from '@/lib/device-mode'

interface Branding {
  nombre_laboratorio: string
  login_imagen_base64: string
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [branding, setBranding] = useState<Branding | null>(null)
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

  // Branding público (sin auth): nombre del laboratorio + imagen del login.
  // fetch directo para evitar el interceptor de auth del cliente Axios.
  useEffect(() => {
    let activo = true
    fetch('/api/v1/branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Branding | null) => {
        if (activo && data) setBranding(data)
      })
      .catch(() => {
        /* sin branding: se usan los valores por defecto */
      })
    return () => {
      activo = false
    }
  }, [])

  const nombreLab = branding?.nombre_laboratorio?.trim() || 'Labstock Mini'
  const loginImagen = branding?.login_imagen_base64?.startsWith('data:image')
    ? branding.login_imagen_base64
    : null

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
        deleted_at: null,
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
        <img
          src={loginImagen ?? fondoLogin}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 text-center text-white px-12">
          <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm mb-6">
            <FlaskConical className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-3">{nombreLab}</h1>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center bg-base-100 px-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 text-center">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-xl bg-primary mb-4">
              <FlaskConical className="h-6 w-6 text-primary-content" />
            </div>
            <h1 className="text-xl font-bold">{nombreLab}</h1>
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

          <div className="mt-8 pt-6 border-t border-base-200/50 text-center">
            <p className="text-xs text-base-content/60">
              Proyecto realizado por <span className="font-semibold text-base-content/80">Vicente Lincoqueo Roa</span>
            </p>
            <a
              href="https://wa.me/56931752970"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-emerald-600 hover:text-emerald-500 transition-colors"
            >
              <svg
                className="w-4 h-4 fill-current text-[#25D366]"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M12.007 0C5.398 0 0 5.396 0 12.004c0 2.112.551 4.165 1.597 5.975L0 24l6.135-1.609a12.005 12.005 0 0 0 5.872 1.512h.005c6.608 0 12-5.397 12-12.004C24.012 5.396 18.615 0 12.007 0zm0 22.002c-1.895 0-3.754-.51-5.378-1.477l-.386-.23-3.66.96.977-3.57-.252-.4c-1.062-1.69-1.62-3.649-1.618-5.659.004-6.065 4.935-11 11.002-11 2.94 0 5.703 1.144 7.784 3.227 2.08 2.081 3.222 4.846 3.22 7.785-.005 6.068-4.937 11-11.005 11zm5.228-7.397c-.287-.144-1.696-.837-1.958-.933-.262-.096-.453-.144-.644.144-.19.287-.739.932-.906 1.123-.166.19-.333.215-.62.072-.286-.144-1.21-.446-2.305-1.424-.852-.76-1.428-1.7-1.595-1.986-.167-.287-.018-.442.126-.584.13-.127.287-.334.43-.502.143-.167.19-.286.286-.478.096-.19.048-.358-.024-.502-.072-.144-.644-1.554-.882-2.128-.232-.559-.467-.483-.64-.492-.166-.008-.358-.01-.55-.01s-.502.072-.764.358c-.262.287-1.002.98-1.002 2.39 0 1.414 1.028 2.779 1.171 2.97.143.19 2.023 3.09 4.901 4.33.684.295 1.218.47 1.634.602.687.218 1.312.187 1.808.114.552-.082 1.696-.693 1.933-1.362.238-.67.238-1.244.167-1.362-.07-.12-.262-.19-.55-.333z" />
              </svg>
              Contacto: +569 3175 2970
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

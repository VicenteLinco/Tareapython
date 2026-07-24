import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, ArrowRight, Lock, Mail } from "lucide-react";

import { useAuthStore } from "@/hooks/use-auth-store";
import api from "@/lib/api";
import type { LoginResponse, MeResponse, Usuario } from "@/types";
import { clearDeviceMode } from "@/lib/device-mode";
import { useBranding } from "@/contexts/BrandingContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, logout, accessToken } = useAuthStore();
  const navigate = useNavigate();
  const branding = useBranding();

  // Si llegamos aquí y hay token, limpiamos para evitar inconsistencias
  useEffect(() => {
    if (accessToken) {
      logout();
      clearDeviceMode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Solo al montar

  const nombreLab = branding.nombre;
  const loginImagen = branding.login_imagen_base64?.startsWith("data:image")
    ? branding.login_imagen_base64
    : null;
  const bgColor = branding.login_bg_color || "#0f172a";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await api.post<LoginResponse>("/auth/login", {
        email,
        password,
      });
      const { access_token, refresh_token } = res.data;

      const meRes = await api.get<MeResponse>("/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const usuarioFull: Usuario = {
        ...meRes.data,
        activo: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      login(access_token, refresh_token, usuarioFull);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 401) {
        setError("Credenciales inválidas");
      } else {
        setError("Error de conexión. Intente nuevamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center relative overflow-hidden font-sans"
      style={{ backgroundColor: bgColor }}
    >
      {/* Background Image / Decor */}
      {loginImagen && (
        <div className="absolute inset-0 z-0">
          <img
            src={loginImagen}
            alt="Background"
            className="w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/60 to-black/90" />
        </div>
      )}
      {!loginImagen && (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-slate-900 via-slate-800 to-black">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
        </div>
      )}

      {/* Decorative Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/20 rounded-full blur-[100px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-secondary/20 rounded-full blur-[100px] pointer-events-none z-0"></div>

      <div className="w-full max-w-md p-8 m-4 relative z-10">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl transition-all duration-500 hover:shadow-primary/20">
          
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary-focus shadow-lg mb-6 ring-4 ring-white/10 transform transition-transform hover:scale-105">
              <FlaskConical className="h-10 w-10 text-white" />
            </div>
            {branding.loading ? (
              <div className="skeleton h-8 w-48 rounded-lg mx-auto bg-white/20" />
            ) : (
              <>
                <h1 className="text-3xl font-extrabold text-white tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                  {nombreLab}
                </h1>
                <p className="text-sm text-white/60 mt-2 font-medium">
                  Portal de Gestión de Laboratorio
                </p>
              </>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-white/70 uppercase tracking-wider ml-1">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-white/40" />
                </div>
                <input
                  type="email"
                  className="w-full pl-11 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all backdrop-blur-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@laboratorio.cl"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-white/70 uppercase tracking-wider ml-1">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-white/40" />
                </div>
                <input
                  type="password"
                  className="w-full pl-11 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all backdrop-blur-sm"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="animate-in fade-in slide-in-from-top-2 rounded-xl bg-error/20 border border-error/50 px-4 py-3 text-sm text-error-content font-medium text-center backdrop-blur-md">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-primary hover:bg-primary-focus text-primary-content font-bold rounded-xl shadow-lg shadow-primary/30 transform transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 group"
              disabled={loading}
            >
              {loading ? (
                <span className="loading loading-spinner loading-md" />
              ) : (
                <>
                  <span>Ingresar al Sistema</span>
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            <p className="text-xs text-white/50 mb-2">
              Proyecto realizado por{" "}
              <span className="font-semibold text-white/80">Vicente Lincoqueo Roa</span>
            </p>
            <a
              href="https://wa.me/56931752970"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 text-xs font-medium text-[#25D366] hover:text-[#1da851] transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full border border-white/5"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.007 0C5.398 0 0 5.396 0 12.004c0 2.112.551 4.165 1.597 5.975L0 24l6.135-1.609a12.005 12.005 0 0 0 5.872 1.512h.005c6.608 0 12-5.397 12-12.004C24.012 5.396 18.615 0 12.007 0zm0 22.002c-1.895 0-3.754-.51-5.378-1.477l-.386-.23-3.66.96.977-3.57-.252-.4c-1.062-1.69-1.62-3.649-1.618-5.659.004-6.065 4.935-11 11.002-11 2.94 0 5.703 1.144 7.784 3.227 2.08 2.081 3.222 4.846 3.22 7.785-.005 6.068-4.937 11-11.005 11zm5.228-7.397c-.287-.144-1.696-.837-1.958-.933-.262-.096-.453-.144-.644.144-.19.287-.739.932-.906 1.123-.166.19-.333.215-.62.072-.286-.144-1.21-.446-2.305-1.424-.852-.76-1.428-1.7-1.595-1.986-.167-.287-.018-.442.126-.584.13-.127.287-.334.43-.502.143-.167.19-.286.286-.478.096-.19.048-.358-.024-.502-.072-.144-.644-1.554-.882-2.128-.232-.559-.467-.483-.64-.492-.166-.008-.358-.01-.55-.01s-.502.072-.764.358c-.262.287-1.002.98-1.002 2.39 0 1.414 1.028 2.779 1.171 2.97.143.19 2.023 3.09 4.901 4.33.684.295 1.218.47 1.634.602.687.218 1.312.187 1.808.114.552-.082 1.696-.693 1.933-1.362.238-.67.238-1.244.167-1.362-.07-.12-.262-.19-.55-.333z" />
              </svg>
              Contacto: +569 3175 2970
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

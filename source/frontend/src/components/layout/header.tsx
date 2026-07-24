import { LogOut, Menu, Search, Bell, Check, Trash } from "lucide-react";
import axios from "axios";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useNavigate } from "react-router-dom";
import { clearDeviceMode } from "@/lib/device-mode";
import { useState } from "react";
import { ProfileModal } from "@/components/auth/ProfileModal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import type { NotificacionResponse, UnreadCountResponse } from "@/types/generated";

interface HeaderProps {
  onOpenSearch?: () => void;
  onMenuClick?: () => void;
}

export function Header({ onOpenSearch, onMenuClick }: HeaderProps) {
  const { usuario, refreshToken, logout } = useAuthStore();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const queryClient = useQueryClient();

  const esAdmin = usuario?.rol === "admin";

  const { data: countData } = useQuery<UnreadCountResponse>({
    queryKey: ["notificaciones", "conteo"],
    queryFn: () => api.get<UnreadCountResponse>("/notificaciones/conteo").then((r) => r.data),
    refetchInterval: 30000,
    enabled: esAdmin,
  });

  const { data: notificationsData } = useQuery<{ data: NotificacionResponse[] }>({
    queryKey: ["notificaciones"],
    queryFn: () => api.get<{ data: NotificacionResponse[] }>("/notificaciones?per_page=5").then((r) => r.data),
    enabled: esAdmin,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notificaciones/${id}/leer`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificaciones"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post("/notificaciones/leer-todas"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificaciones"] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => api.delete("/notificaciones/clear"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificaciones"] });
    },
  });

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await axios.post("/api/v1/auth/logout", {
          refresh_token: refreshToken,
        });
      }
    } finally {
      logout();
      clearDeviceMode();
      navigate("/login");
    }
  };

  return (
    <header className="glass-header sticky top-0 z-20 flex h-[60px] min-w-0 items-center justify-between border-b border-base-200 bg-base-100/80 px-3 sm:px-4 md:px-6">
      <div className="flex items-center gap-3">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="btn btn-ghost btn-sm btn-square md:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="hidden md:flex items-center gap-2 h-8 px-3 rounded-xl border border-base-300 bg-base-200/50 text-xs text-base-content/40 hover:text-base-content hover:border-base-400 transition-all"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Buscar…</span>
            <div className="flex items-center gap-0.5 ml-1">
              <kbd className="kbd kbd-sm text-[9px]">Ctrl</kbd>
              <kbd className="kbd kbd-sm text-[9px]">K</kbd>
            </div>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {esAdmin && (
          <div className="dropdown">
            <div tabIndex={0} role="button" className="btn btn-ghost btn-sm btn-square relative">
              <Bell className="h-4.5 w-4.5" />
              {countData && countData.conteo > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-error text-[10px] font-bold text-error-content animate-pulse">
                  {countData.conteo}
                </span>
              )}
            </div>
            <div
              tabIndex={0}
              className="dropdown-content menu p-4 shadow-lg bg-base-100 rounded-xl border border-base-200 mt-2 z-30 fixed top-16 left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] max-w-[360px] sm:absolute sm:top-auto sm:left-auto sm:right-0 sm:translate-x-0 sm:w-80"
            >
              <div className="flex items-center justify-between pb-2 border-b border-base-200 mb-2">
                <span className="font-semibold text-xs text-base-content/80">Notificaciones</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => markAllReadMutation.mutate()}
                    className="btn btn-ghost btn-xs text-[10px] p-1 h-auto min-h-0"
                    title="Marcar todas como leídas"
                    disabled={!notificationsData || notificationsData.data.length === 0}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => clearAllMutation.mutate()}
                    className="btn btn-ghost btn-xs text-error text-[10px] p-1 h-auto min-h-0"
                    title="Limpiar todas"
                    disabled={!notificationsData || notificationsData.data.length === 0}
                  >
                    <Trash className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2.5">
                {notificationsData && notificationsData.data.length > 0 ? (
                  notificationsData.data.map((n) => (
                    <div
                      key={n.id}
                      className={`p-2.5 rounded-lg border text-xs relative transition-all ${
                        n.leido
                          ? "bg-base-100 border-base-200 text-base-content/60"
                          : "bg-primary/5 border-primary/10 text-base-content font-medium"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-semibold">{n.titulo}</span>
                        {!n.leido && (
                          <button
                            onClick={() => markReadMutation.mutate(n.id)}
                            className="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 text-primary hover:bg-transparent"
                            title="Marcar como leída"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] leading-snug mt-1">{n.mensaje}</p>
                      <span className="text-[9px] opacity-40 mt-1 block">
                        {new Date(n.created_at).toLocaleString("es-CL", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-4 text-xs text-base-content/40">
                    No hay notificaciones
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="tooltip tooltip-bottom" data-tip="Editar perfil">
          <button
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2.5 hover:bg-base-200/50 p-1 px-2 rounded-xl transition-all text-left"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
              {usuario?.nombre?.charAt(0)?.toUpperCase() ?? "U"}
            </div>
            <div className="hidden sm:flex flex-col">
              <span className="text-xs font-semibold leading-tight">
                {usuario?.nombre}
              </span>
              <span className="text-[10px] opacity-40 capitalize leading-tight">
                {usuario?.rol}
              </span>
            </div>
          </button>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Cerrar sesión">
          <button
            onClick={handleLogout}
            className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
}

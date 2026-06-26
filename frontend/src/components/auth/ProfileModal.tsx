import { useState, useEffect } from "react";
import { useAuthStore } from "@/hooks/use-auth-store";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import type { MeResponse } from "@/types";

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const usuario = useAuthStore((s) => s.usuario);
  const setUsuario = useAuthStore((s) => s.setUsuario);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && usuario) {
      setNombre(usuario.nombre || "");
      setEmail(usuario.email || "");
      setWhatsappPhone(usuario.whatsapp_phone || "");
      setError(null);
    }
  }, [open, usuario]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!nombre.trim()) {
      setError("El nombre es obligatorio");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("El correo electrónico no es válido");
      return;
    }

    let cleanPhone: string | null = whatsappPhone.trim();
    if (cleanPhone) {
      const phoneRegex = /^\+?[0-9\s-]{8,20}$/;
      if (!phoneRegex.test(cleanPhone)) {
        setError(
          "El número de WhatsApp no es válido (use dígitos, espacios o guiones, entre 8 y 20 caracteres)",
        );
        return;
      }
    } else {
      cleanPhone = null;
    }

    setLoading(true);
    try {
      const res = await api.put<MeResponse>("/auth/me", {
        nombre: nombre.trim(),
        email: email.trim(),
        whatsapp_phone: cleanPhone,
      });

      notify.success("Perfil actualizado correctamente");
      if (usuario) {
        setUsuario({
          ...usuario,
          nombre: res.data.nombre,
          email: res.data.email,
          whatsapp_phone: res.data.whatsapp_phone,
        });
      }
      onClose();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Editar mi perfil">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <div className="alert alert-error text-xs py-2 px-3 rounded-lg shadow-sm">
            <span>{error}</span>
          </div>
        )}

        {/* Nombre */}
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold text-xs">Nombre</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* Email */}
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold text-xs">Email</span>
          </label>
          <input
            type="email"
            className="input input-bordered input-sm w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>

        {/* WhatsApp */}
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold text-xs">
              Número de WhatsApp (Opcional)
            </span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            placeholder="+56912345678"
            value={whatsappPhone}
            onChange={(e) => setWhatsappPhone(e.target.value)}
            disabled={loading}
          />
          <span className="label-text-alt text-base-content/40 mt-1">
            Formato: + seguido de código de país y número (ej. +56912345678)
          </span>
        </div>

        <div className="modal-action mt-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm gap-2"
            disabled={loading}
          >
            {loading && <span className="loading loading-spinner loading-xs" />}
            Guardar cambios
          </button>
        </div>
      </form>
    </Dialog>
  );
}

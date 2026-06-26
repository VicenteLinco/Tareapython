// frontend/src/pages/recepciones/steps/ProveedorStep.tsx
import { useRef } from "react";
import { ShoppingCart, X, Upload, Image as ImageIcon } from "lucide-react";
import { cn, APP_LOCALE } from "@/lib/utils";
import { ProveedorSelect } from "@/components/ui/proveedor-select";
import type { Proveedor } from "@/types";
import type { RecepcionWizardReturn } from "../hooks/useRecepcionWizard";

interface Props {
  wizard: RecepcionWizardReturn;
  proveedores: Proveedor[] | undefined;
  onVincularClick: () => void;
}

export function ProveedorStep({ wizard, proveedores, onVincularClick }: Props) {
  const {
    proveedorId,
    setProveedorId,
    proveedorError,
    setProveedorError,
    proveedorRef,
    guiaDespacho,
    setGuiaDespacho,
    guiaProvisoria,
    setGuiaProvisoria,
    fechaRecepcion,
    setFechaRecepcion,
    fechaExpanded,
    setFechaExpanded,
    solicitudId,
    setSolicitudId,
    setSolicitudNumero,
    solicitudNumero,
    fotoGuia,
    setFotoGuia,
  } = wizard;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFotoGuia(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      {/* Datos guía */}
      <div className="card bg-base-100 border p-4 space-y-3">
        <h2 className="text-xs font-bold uppercase opacity-50 tracking-wide">
          Guía de Despacho
        </h2>

        <div ref={proveedorRef}>
          <label className="label py-0.5">
            <span
              className={cn(
                "label-text text-xs transition-colors",
                proveedorError && "text-error font-semibold",
              )}
            >
              {proveedorError
                ? "⚠ Selecciona un proveedor primero"
                : "Proveedor *"}
            </span>
          </label>
          <div
            className={
              proveedorError ? "animate-shake ring-2 ring-error rounded-lg" : ""
            }
          >
            <ProveedorSelect
              value={proveedorId || ""}
              onChange={(v) => {
                setProveedorId(v ? Number(v) : null);
                setProveedorError(false);
              }}
              proveedores={proveedores || []}
              searchable
            />
          </div>
        </div>

        <div>
          <label className="label py-0.5">
            <span className="label-text text-xs">Nº Guía de Despacho *</span>
          </label>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={guiaProvisoria}
              onChange={(e) => {
                setGuiaProvisoria(e.target.checked);
                if (e.target.checked) setGuiaDespacho("");
              }}
            />
            <span className="text-xs opacity-60">
              Sin guía — usar número provisorio
            </span>
          </label>
          {!guiaProvisoria && (
            <input
              className="input input-sm input-bordered w-full"
              placeholder="GD-00000"
              value={guiaDespacho}
              onChange={(e) => setGuiaDespacho(e.target.value)}
            />
          )}
        </div>

        {/* Foto de la guía */}
        <div>
          <label className="label py-0.5">
            <span className="label-text text-xs">
              Foto de la Guía de Despacho
            </span>
          </label>
          {fotoGuia ? (
            <div className="flex items-center gap-2 bg-base-200 p-2 rounded-xl border border-base-300">
              <div className="flex-1 truncate text-xs font-semibold text-primary flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4" /> Imagen cargada
              </div>
              <button
                type="button"
                className="btn btn-xs btn-ghost btn-circle text-error"
                onClick={() => setFotoGuia(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline btn-ghost w-full border-dashed flex items-center justify-center gap-2 rounded-xl"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Adjuntar foto
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFotoFile}
          />
        </div>

        <div>
          <button
            type="button"
            className="flex items-center justify-between gap-2 text-xs mb-1 w-full text-left"
            onClick={() => setFechaExpanded((v) => !v)}
          >
            <span className="opacity-70">
              {new Date(fechaRecepcion).toLocaleString(APP_LOCALE, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
            <span className="text-primary font-semibold underline underline-offset-2 shrink-0">
              {fechaExpanded ? "Cerrar" : "Cambiar"}
            </span>
          </button>
          {fechaExpanded && (
            <input
              type="datetime-local"
              className="input input-bordered input-sm w-full"
              value={fechaRecepcion}
              onChange={(e) => setFechaRecepcion(e.target.value)}
            />
          )}
        </div>

        {solicitudId ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-success font-medium flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" />{" "}
              {solicitudNumero ?? "Solicitud"} vinculada ✓
            </span>
            <button
              className="btn btn-xs btn-ghost btn-circle text-error"
              title="Desvincular solicitud"
              onClick={() => {
                setSolicitudId(null);
                setSolicitudNumero(null);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            className="btn btn-sm btn-ghost btn-outline w-full border-dashed"
            onClick={() => {
              if (!proveedorId) {
                setProveedorError(true);
                setTimeout(() => setProveedorError(false), 1500);
                proveedorRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
                return;
              }
              onVincularClick();
            }}
          >
            <ShoppingCart className="h-4 w-4 mr-1" />
            Vincular solicitud (opcional)
          </button>
        )}
      </div>
    </div>
  );
}

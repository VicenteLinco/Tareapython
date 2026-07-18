import { AlertTriangle } from "lucide-react";

export interface ImpactoItem {
  label: string;
  valor: string;
  destacado?: boolean;
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
  /** Filas de resumen de impacto mostradas antes de los botones */
  impacto?: ImpactoItem[];
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading,
  title,
  description,
  confirmLabel = "Confirmar",
  variant = "danger",
  impacto,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <div className="flex items-start gap-3 mb-4">
          <div
            className={`p-2 rounded-lg ${variant === "danger" ? "bg-error/10" : "bg-warning/10"}`}
          >
            <AlertTriangle
              className={`w-5 h-5 ${variant === "danger" ? "text-error" : "text-warning"}`}
            />
          </div>
          <div>
            <h3 className="font-semibold text-base-content">{title}</h3>
            <p className="text-sm text-base-content/60 mt-1">{description}</p>
          </div>
        </div>

        {impacto && impacto.length > 0 && (
          <div className="mb-4 rounded-xl border border-base-200 bg-base-50 divide-y divide-base-200">
            {impacto.map((item) => (
              <div
                key={item.label}
                className="flex justify-between px-3 py-2 text-sm"
              >
                <span className="text-base-content/60">{item.label}</span>
                <span
                  className={
                    item.destacado
                      ? "font-semibold text-error"
                      : "font-medium text-base-content"
                  }
                >
                  {item.valor}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-action mt-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            className={`btn btn-sm ${variant === "danger" ? "btn-error" : "btn-warning"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="loading loading-spinner loading-xs" />}
            {confirmLabel}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { X, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useQuery } from "@tanstack/react-query";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { AsignarCodigoModal } from "@/components/shared/AsignarCodigoModal";

interface ScannedItem {
  id: string;
  codigo: string;
  producto_id: string | null;
  producto_nombre: string | null;
}

interface QrScannerSessionProps {
  onItemsScanned: (items: ScannedItem[]) => void;
  onClose: () => void;
}

export function QrScannerSession({
  onItemsScanned,
  onClose,
}: QrScannerSessionProps) {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [accumulatedItems, setAccumulatedItems] = useState<ScannedItem[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [asignarCodigo, setAsignarCodigo] = useState<string | null>(null);

  const { data: productos = [] } = useQuery({
    queryKey: ["productos-scan-list"],
    queryFn: () =>
      api
        .get<{
          data: {
            id: string;
            nombre: string;
            codigo_interno: string | null;
            sku: string | null;
          }[];
        }>("/productos", { params: { per_page: 2000, activo: true } })
        .then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    api
      .post<{ token: string; expires_at: string }>(
        "/recepciones/scanner-session",
      )
      .then((r) => {
        setToken(r.data.token);
        setExpiresAt(new Date(r.data.expires_at));
      })
      .catch(() => notify.error("No se pudo crear sesión de escáner"));
  }, []);

  useEffect(() => {
    if (!token) return;
    const scanUrl = `${window.location.origin}/scan/${token}`;
    QRCode.toDataURL(scanUrl, { width: 200, margin: 2 })
      .then((url) => setQrDataUrl(url))
      .catch(() => notify.error("No se pudo generar el QR"));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{ items: ScannedItem[] }>(
          `/recepciones/scanner-session/${token}/items`,
        );
        if (res.data.items.length > 0) {
          setAccumulatedItems((prev) => [...prev, ...res.data.items]);
          notify.success(`${res.data.items.length} ítem(s) escaneado(s)`);
        }
      } catch {
        // El polling puede fallar transitoriamente; se reintenta en el siguiente intervalo.
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [token]);

  const timeLeft = expiresAt
    ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))
    : 0;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" /> Escáner QR
          </h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-center space-y-3">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR escáner"
              className="mx-auto rounded-xl border border-base-200 p-2"
            />
          ) : (
            <div className="w-[200px] h-[200px] mx-auto bg-base-200 rounded-xl animate-pulse" />
          )}
          <div className="space-y-1">
            <p className="text-sm font-semibold">Escanea con tu celular</p>
            <p className="text-xs opacity-50">
              El celular abrirá la cámara en el navegador
            </p>
            <p className="text-xs opacity-50">Expira en {timeLeft}s</p>
          </div>
        </div>

        {accumulatedItems.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-bold uppercase opacity-50">
              Escaneados ({accumulatedItems.length})
            </p>
            {accumulatedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 bg-success/5 rounded-lg border border-success/20 text-sm"
              >
                <span className="font-semibold text-xs flex-1 min-w-0 truncate">
                  {item.producto_nombre || item.codigo}
                </span>
                {!item.producto_id && (
                  <>
                    <span className="badge badge-warning badge-xs">
                      Sin match
                    </span>
                    <button
                      className="btn btn-xs btn-warning"
                      onClick={() => setAsignarCodigo(item.codigo)}
                    >
                      Asignar
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="modal-action mt-4">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary btn-sm gap-2"
            disabled={accumulatedItems.length === 0}
            onClick={() => {
              onItemsScanned(accumulatedItems);
              onClose();
            }}
          >
            Usar {accumulatedItems.length} ítem(s)
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />

      {asignarCodigo && (
        <AsignarCodigoModal
          codigo={asignarCodigo}
          productos={productos}
          onClose={() => setAsignarCodigo(null)}
          onAsignado={() => setAsignarCodigo(null)}
        />
      )}
    </div>
  );
}

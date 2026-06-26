import { useParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
import api from "@/lib/api";
import { notify } from "@/lib/notify";

interface Html5ScannerInstance {
  render: (
    onSuccess: (decodedText: string) => void,
    onError: () => void,
  ) => void;
  clear: () => Promise<void>;
}

export default function ScanPage() {
  const { token } = useParams<{ token: string }>();
  const [scanned, setScanned] = useState<string[]>([]);
  const scannedRef = useRef<string[]>([]);

  useEffect(() => {
    if (!token) return;
    let scanner: Html5ScannerInstance | null = null;
    scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
    scanner.render(
      async (code: string) => {
        if (scannedRef.current.includes(code)) return;
        scannedRef.current = [...scannedRef.current, code];
        try {
          await api.post(`/recepciones/scanner-session/${token}/scan`, {
            codigo: code,
          });
          setScanned([...scannedRef.current]);
          notify.success(`Escaneado: ${code}`);
        } catch {
          scannedRef.current = scannedRef.current.filter((c) => c !== code);
          notify.error("Error al enviar escaneo");
        }
      },
      () => undefined,
    );
    return () => {
      if (scanner) scanner.clear().catch(() => {});
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-base-100 p-4 max-w-sm mx-auto">
      <h1 className="text-lg font-bold mb-4 text-center">Escanear productos</h1>
      <div
        id="reader"
        className="rounded-xl overflow-hidden border border-base-200"
      />
      {scanned.length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-xs font-bold opacity-50">
            Enviados: {scanned.length}
          </p>
          {scanned.map((c, i) => (
            <p key={i} className="text-sm font-mono">
              {c}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useDialogState } from "@/hooks/useDialogState";
import type { SolicitudResumen } from "@/types";

type Decision = "completa" | "parcial" | "rechazada";

export function useRecepcionWizard() {
  // Cabecera
  const [proveedorId, setProveedorIdRaw] = useState<number | null>(null);
  const [proveedorError, setProveedorError] = useState(false);
  const proveedorRef = useRef<HTMLDivElement>(null);
  const [guiaDespacho, setGuiaDespacho] = useState("");
  const [guiaProvisoria, setGuiaProvisoria] = useState(false);
  const [fechaRecepcion, setFechaRecepcion] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [fechaExpanded, setFechaExpanded] = useState(false);
  const [fotoGuia, setFotoGuia] = useState<string | null>(null);

  // Solicitud
  const [solicitudId, setSolicitudId] = useState<string | null>(null);
  const [solicitudNumero, setSolicitudNumero] = useState<string | null>(null);
  const solicitudModal = useDialogState();

  // Decisión (paso 3)
  const [decision, setDecision] = useState<Decision>("completa");
  const [motivosSeleccionados, setMotivosSeleccionados] = useState<string[]>(
    [],
  );
  const [motivoOtro, setMotivoOtro] = useState("");
  const [nota, setNota] = useState("");

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ["solicitudes-activas", proveedorId],
    queryFn: () =>
      api
        .get<{ data: SolicitudResumen[] }>("/solicitudes-compra", {
          params: {
            per_page: 100,
            ...(proveedorId ? { proveedor_id: proveedorId } : {}),
          },
        })
        .then((r) =>
          (r.data.data ?? []).filter((s) =>
            [
              "guardada",
              "parcialmente_enviada",
              "enviada",
              "parcialmente_recibida",
            ].includes(s.estado),
          ),
        ),
  });

  const setProveedorId = (id: number | null) => {
    if (id !== proveedorId) {
      setSolicitudId(null);
      setSolicitudNumero(null);
    }
    setProveedorIdRaw(id);
  };

  return {
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
    fotoGuia,
    setFotoGuia,
    solicitudId,
    setSolicitudId,
    solicitudNumero,
    setSolicitudNumero,
    solicitudModal,
    solicitudesPendientes,
    decision,
    setDecision,
    motivosSeleccionados,
    setMotivosSeleccionados,
    motivoOtro,
    setMotivoOtro,
    nota,
    setNota,
  };
}

export type RecepcionWizardReturn = ReturnType<typeof useRecepcionWizard>;

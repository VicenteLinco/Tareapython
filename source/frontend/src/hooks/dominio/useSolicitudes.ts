import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listarSolicitudes,
  detalleSolicitud,
  borradorSolicitud,
  recomendacionesSolicitud,
  actualizarSolicitud,
  guardarSolicitud,
  cancelarSolicitud,
  registrarEnvio,
  cancelarEnvio,
} from "@/api";
import type {
  SolicitudesQuery,
  RecomendacionesQuery,
  CancelarSolicitudRequest,
} from "@/api";
import type {
  UpdateSolicitudRequest,
  RegistrarEnvioInput,
  CancelarEnvioInput,
} from "@/types";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import { solicitudesKeys } from "@/lib/queryKeys";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useSolicitudes(params?: SolicitudesQuery) {
  return useQuery({
    queryKey: solicitudesKeys.list(params),
    queryFn: () => listarSolicitudes(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useSolicitudDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: solicitudesKeys.detail(id ?? ""),
    queryFn: () => detalleSolicitud(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

export function useSolicitudBorrador() {
  return useQuery({
    queryKey: solicitudesKeys.borrador(),
    queryFn: () => borradorSolicitud(),
    staleTime: 0, // Los borradores son volátiles por sesión — siempre revalidar
  });
}

export function useSolicitudRecomendaciones(params?: RecomendacionesQuery) {
  return useQuery({
    queryKey: solicitudesKeys.recomendaciones(params),
    queryFn: () => recomendacionesSolicitud(params),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useActualizarSolicitud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: UpdateSolicitudRequest;
    }) => actualizarSolicitud(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: solicitudesKeys.detail(id) });
      qc.invalidateQueries({ queryKey: solicitudesKeys.borrador() });
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useGuardarSolicitud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guardarSolicitud(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: solicitudesKeys.all });
      notify.success("Solicitud guardada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useCancelarSolicitud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload?: CancelarSolicitudRequest;
    }) => cancelarSolicitud(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: solicitudesKeys.all });
      notify.success("Solicitud cancelada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useRegistrarEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: RegistrarEnvioInput;
    }) => registrarEnvio(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: solicitudesKeys.all });
      qc.invalidateQueries({ queryKey: solicitudesKeys.detail(id) });
      notify.success("Envío registrado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useCancelarEnvio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      proveedorId,
      payload,
    }: {
      id: string;
      proveedorId: number;
      payload: CancelarEnvioInput;
    }) => cancelarEnvio(id, proveedorId, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: solicitudesKeys.all });
      qc.invalidateQueries({ queryKey: solicitudesKeys.detail(id) });
      notify.success("Envío cancelado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

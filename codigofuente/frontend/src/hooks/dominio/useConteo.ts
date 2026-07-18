import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listarConteoPendientes,
  listarSesionesConteo,
  crearSesionConteo,
  detalleConteoCompleto,
  guardarItemsConteo,
  confirmarConteo,
} from "@/api";
import type {
  ConteoQuery,
  CrearSesionRequest,
  GuardarItemsRequest,
  ConfirmarConteoRequest,
} from "@/api";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import { conteoKeys, stockKeys } from "@/lib/queryKeys";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useConteoPendientes() {
  return useQuery({
    queryKey: conteoKeys.pendientes(),
    queryFn: () => listarConteoPendientes(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSesionesConteo(params?: ConteoQuery) {
  return useQuery({
    queryKey: conteoKeys.list(params),
    queryFn: () => listarSesionesConteo(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useConteoDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: conteoKeys.detail(id ?? ""),
    queryFn: () => detalleConteoCompleto(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCrearSesionConteo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CrearSesionRequest) => crearSesionConteo(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conteoKeys.all });
      qc.invalidateQueries({ queryKey: conteoKeys.pendientes() });
      notify.success("Sesión de conteo creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useGuardarItemsConteo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sesionId,
      payload,
    }: {
      sesionId: string;
      payload: GuardarItemsRequest;
    }) => guardarItemsConteo(sesionId, payload),
    onSuccess: (_data, { sesionId }) => {
      qc.invalidateQueries({ queryKey: conteoKeys.detail(sesionId) });
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useConfirmarConteo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sesionId,
      payload,
    }: {
      sesionId: string;
      payload?: ConfirmarConteoRequest;
    }) => confirmarConteo(sesionId, payload),
    onSuccess: (_data, { sesionId }) => {
      qc.invalidateQueries({ queryKey: conteoKeys.all });
      qc.invalidateQueries({ queryKey: conteoKeys.detail(sesionId) });
      qc.invalidateQueries({ queryKey: stockKeys.all });
      notify.success("Conteo confirmado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

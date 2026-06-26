import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listarRecepciones,
  detalleRecepcion,
  crearRecepcion,
  confirmarRecepcion,
  eliminarBorrador,
} from "@/api";
import type { CreateRecepcion, RecepcionQuery } from "@/types/generated";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import { recepcionKeys, stockKeys } from "@/lib/queryKeys";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useRecepciones(params?: Partial<RecepcionQuery>) {
  return useQuery({
    queryKey: recepcionKeys.list(params),
    queryFn: () => listarRecepciones(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useRecepcionDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: recepcionKeys.detail(id ?? ""),
    queryFn: () => detalleRecepcion(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCrearRecepcion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRecepcion) => crearRecepcion(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recepcionKeys.all });
      notify.success("Recepción creada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useConfirmarRecepcion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => confirmarRecepcion(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: recepcionKeys.all });
      qc.invalidateQueries({ queryKey: recepcionKeys.detail(id) });
      qc.invalidateQueries({ queryKey: stockKeys.all });
      notify.success("Recepción confirmada");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useEliminarBorrador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => eliminarBorrador(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recepcionKeys.all });
      notify.success("Borrador eliminado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

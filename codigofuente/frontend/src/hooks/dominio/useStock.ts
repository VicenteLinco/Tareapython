import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listarStock,
  obtenerAlertas,
  stockPorArea,
  crearConsumo,
  crearConsumoBatch,
  crearDescarte,
  historicoDescartes,
} from "@/api";
import type {
  StockQuery,
  AlertasQuery,
  ConsumoRequest,
  ConsumoBatchRequest,
  DescartesHistorialQuery,
} from "@/api";
import type { DescarteRequest } from "@/types/generated";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import { stockKeys, descartesKeys } from "@/lib/queryKeys";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useStockList(params?: StockQuery) {
  return useQuery({
    queryKey: stockKeys.list(params),
    queryFn: () => listarStock(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useStockAlertas(params?: AlertasQuery) {
  return useQuery({
    queryKey: [...stockKeys.alertas(), params],
    queryFn: () => obtenerAlertas(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useStockPorArea(
  areaId: number | null | undefined,
  params?: { page?: number; per_page?: number; q?: string },
) {
  return useQuery({
    queryKey: stockKeys.area(areaId ?? 0, params),
    queryFn: () => stockPorArea(areaId!, params),
    enabled: !!areaId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDescartesHistorial(params?: DescartesHistorialQuery) {
  return useQuery({
    queryKey: descartesKeys.list(params),
    queryFn: () => historicoDescartes(params),
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCrearConsumo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConsumoRequest) => crearConsumo(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockKeys.all });
      notify.success("Consumo registrado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useCrearConsumoBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConsumoBatchRequest) => crearConsumoBatch(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockKeys.all });
      notify.success("Consumos registrados");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

export function useCrearDescarte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: DescarteRequest) => crearDescarte(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockKeys.all });
      qc.invalidateQueries({ queryKey: descartesKeys.all });
      notify.success("Descarte registrado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
}

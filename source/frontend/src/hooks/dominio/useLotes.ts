import { useQuery } from "@tanstack/react-query";
import { buscarLotes, detalleLote } from "@/api";
import type { LoteQuery } from "@/api";
import { lotesKeys } from "@/lib/queryKeys";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useLotes(params?: LoteQuery) {
  return useQuery({
    queryKey: lotesKeys.list(params),
    queryFn: () => buscarLotes(params),
    staleTime: 2 * 60 * 1000,
  });
}

export function useLoteDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: lotesKeys.detail(id ?? ""),
    queryFn: () => detalleLote(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

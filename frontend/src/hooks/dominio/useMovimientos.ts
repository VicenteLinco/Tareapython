import { useQuery } from '@tanstack/react-query'
import { listarMovimientos, detalleMovimiento, tendenciasMovimientos } from '@/api'
import type { MovimientosQuery, TendenciasQuery } from '@/api'
import { movimientosKeys } from '@/lib/queryKeys'

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useMovimientos(params?: MovimientosQuery) {
  return useQuery({
    queryKey: movimientosKeys.list(params),
    queryFn: () => listarMovimientos(params),
    staleTime: 2 * 60 * 1000,
  })
}

export function useMovimientoDetalle(id: string | null | undefined) {
  return useQuery({
    queryKey: movimientosKeys.detail(id ?? ''),
    queryFn: () => detalleMovimiento(id!),
    enabled: !!id,
    staleTime: 60 * 1000,
  })
}

export function useTendenciasMovimientos(params?: TendenciasQuery) {
  return useQuery({
    queryKey: movimientosKeys.tendencias(params),
    queryFn: () => tendenciasMovimientos(params),
    staleTime: 5 * 60 * 1000,
  })
}

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import type { DescarteSession, PaginatedResponse } from '@/types'

interface DescartesHistorialParams {
  desde?: string | null
  hasta?: string | null
  areaId?: number | null
  page?: number
  perPage?: number
}

export function useDescartesHistorial(params: DescartesHistorialParams) {
  return useQuery({
    queryKey: ['descartes-historial', params.desde, params.hasta, params.areaId, params.page],
    queryFn: () =>
      api
        .get<PaginatedResponse<DescarteSession>>('/descartes', {
          params: {
            desde: params.desde ?? undefined,
            hasta: params.hasta ?? undefined,
            area_id: params.areaId ?? undefined,
            page: params.page ?? 1,
            per_page: params.perPage ?? 20,
          },
        })
        .then((r) => r.data),
    staleTime: 30_000,
  })
}

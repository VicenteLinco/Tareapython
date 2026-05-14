import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import type { DescarteVencidoItem } from '@/types'

interface DescartesStockParams {
  diasAlerta?: number
  areaId?: number | null
  proveedorId?: number | null
}

export function useDescartesStock(params: DescartesStockParams) {
  return useQuery({
    queryKey: ['descartes-stock', params.diasAlerta ?? 0, params.areaId, params.proveedorId],
    queryFn: () =>
      api
        .get<DescarteVencidoItem[]>('/stock/lotes-vencidos', {
          params: {
            dias_alerta: params.diasAlerta ?? 0,
            area_id: params.areaId ?? undefined,
            proveedor_id: params.proveedorId ?? undefined,
          },
        })
        .then((r) => r.data),
    staleTime: 30_000,
  })
}

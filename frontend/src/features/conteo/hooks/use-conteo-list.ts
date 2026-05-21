import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { PaginatedSesiones, Area } from '@/types'
import { useAreaStore } from '@/hooks/use-area-store'

export interface AreaPendiente {
  area_id: number
  area_nombre: string
  frecuencia_dias: number
  ultimo_conteo_confirmado: string | null
  dias_desde_ultimo: number | null
}

export type AreaStockStatus = 'loading' | 'con-stock' | 'sin-stock'

export function useConteoList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId)
  const setSelectedAreaId = useAreaStore((s) => s.setSelectedArea)

  const [filterEstado, setFilterEstado] = useState('')
  const [page, setPage] = useState(1)

  // Query: Lista paginada de sesiones
  const sesionesQuery = useQuery({
    queryKey: ['conteo', { filterEstado, page, areaId: selectedAreaId }],
    queryFn: () =>
      api.get<PaginatedSesiones>('/conteo', {
        params: {
          estado: filterEstado || undefined,
          area_id: selectedAreaId || undefined,
          page,
          per_page: 20,
        },
      }).then((r) => r.data),
  })

  // Query: Áreas para el filtro
  const areasQuery = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const areaIds = (areasQuery.data ?? []).filter((a) => a.activa).map((a) => a.id)

  const areaStockStatusQuery = useQuery({
    queryKey: ['conteo-area-stock-status', areaIds],
    enabled: areaIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        areaIds.map((areaId) =>
          api
            .get<{ productos: unknown[] }>(`/stock/area/${areaId}`, { params: { per_page: 1 } })
            .then((r) => [areaId, r.data.productos.length > 0 ? 'con-stock' : 'sin-stock'] as const)
            .catch(() => [areaId, 'sin-stock'] as const)
        )
      )
      return Object.fromEntries(results) as Record<number, AreaStockStatus>
    },
    staleTime: 60000,
  })

  // Query: Áreas con conteo pendiente
  const pendientesQuery = useQuery({
    queryKey: ['conteo-pendientes'],
    queryFn: () => api.get<AreaPendiente[]>('/conteo/pendientes').then((r) => r.data),
    staleTime: 60000,
  })

  // Mutation: Crear nueva sesión (navegación automática — para botón individual)
  const crearMutation = useMutation({
    mutationFn: (area_id: number) =>
      api.post<{ id: string; total_items: number }>('/conteo', { area_id }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conteo'] })
      queryClient.invalidateQueries({ queryKey: ['conteo-pendientes'] })
      if (data.total_items === 0) {
        toast.warning('Esta área no tiene insumos en stock. El conteo se creó vacío.')
      }
      navigate(`/conteo/${data.id}`)
    },
    onError: (err) => toast.error(parseApiError(err)),
  })

  const handleCrear = (areaId: number) => {
    crearMutation.mutate(areaId)
  }

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ conteo_periodo_dias: number }>('/configuracion').then(r => r.data),
    staleTime: 300_000,
  })
  const periodoGlobalDias = configuracion?.conteo_periodo_dias ?? 30

  // Crear múltiples sesiones (sin navegación automática — para el modal)
  const [isCreatingMultiple, setIsCreatingMultiple] = useState(false)

  const handleCrearMultiple = async (areaIds: number[]) => {
    if (areaIds.length === 0) return
    if (areaIds.length === 1) {
      handleCrear(areaIds[0])
      return
    }
    setIsCreatingMultiple(true)
    let vacias = 0
    try {
      for (const area_id of areaIds) {
        const data = await api.post<{ id: string; total_items: number }>('/conteo', { area_id }).then((r) => r.data)
        if (data.total_items === 0) vacias++
      }
      queryClient.invalidateQueries({ queryKey: ['conteo'] })
      queryClient.invalidateQueries({ queryKey: ['conteo-pendientes'] })
      toast.success(`${areaIds.length} sesiones de conteo creadas`)
      if (vacias > 0) toast.warning(`${vacias} área${vacias > 1 ? 's' : ''} sin stock en sistema`)
    } catch (err) {
      toast.error(parseApiError(err))
    } finally {
      setIsCreatingMultiple(false)
    }
  }

  const handleAreaFilterChange = (areaId: number | null) => {
    setSelectedAreaId(areaId)
    setPage(1)
  }

  const handleEstadoFilterChange = (estado: string) => {
    setFilterEstado(estado)
    setPage(1)
  }

  const areaStockStatus: Record<number, AreaStockStatus> = {
    ...Object.fromEntries(areaIds.map((areaId) => [areaId, 'loading' as AreaStockStatus])),
    ...(areaStockStatusQuery.data ?? {}),
  }

  return {
    sesiones: sesionesQuery.data,
    isLoading: sesionesQuery.isLoading,
    areas: areasQuery.data ?? [],
    areaStockStatus,
    pendientes: pendientesQuery.data ?? [],
    filters: {
      estado: filterEstado,
      areaId: selectedAreaId,
      page,
    },
    actions: {
      setEstado: handleEstadoFilterChange,
      setArea: handleAreaFilterChange,
      setPage,
      crear: handleCrear,
      crearMultiple: handleCrearMultiple,
    },
    isCreating: crearMutation.isPending || isCreatingMultiple,
    periodoGlobalDias,
  }
}

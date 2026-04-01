import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { PaginatedSesiones, Area } from '@/types'
import { useAreaStore } from '@/hooks/use-area-store'

export interface AreaPendiente {
  area_id: number
  area_nombre: string
  frecuencia_dias: number
  ultimo_conteo_confirmado: string | null
  dias_desde_ultimo: number | null
}

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

  // Query: Áreas con conteo pendiente
  const pendientesQuery = useQuery({
    queryKey: ['conteo-pendientes'],
    queryFn: () => api.get<AreaPendiente[]>('/conteo/pendientes').then((r) => r.data),
    staleTime: 60000,
  })

  // Mutation: Crear nueva sesión
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
    onError: () => toast.error('Error al crear sesión de conteo'),
  })

  const handleCrear = (areaId: number) => {
    crearMutation.mutate(areaId)
  }

  const handleAreaFilterChange = (areaId: number | null) => {
    setSelectedAreaId(areaId)
    setPage(1)
  }

  const handleEstadoFilterChange = (estado: string) => {
    setFilterEstado(estado)
    setPage(1)
  }

  return {
    sesiones: sesionesQuery.data,
    isLoading: sesionesQuery.isLoading,
    areas: areasQuery.data ?? [],
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
    },
    isCreating: crearMutation.isPending,
  }
}

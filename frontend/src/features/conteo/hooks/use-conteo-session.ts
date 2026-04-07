import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { ConteoDetalle, ConteoItem } from '@/types'
import { v4 as uuidv4 } from 'uuid'

export function useConteoSession(id: string | undefined) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [localItems, setLocalItems] = useState<Record<string, { cantidad: string; estado: string; version: number }>>({})
  const [nota, setNota] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['conteo-detalle', id],
    queryFn: () => api.get<ConteoDetalle>(`/conteo/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: false,
  })

  const sesion = data?.sesion
  const items = data?.items ?? []
  const editable = sesion?.estado === 'borrador' || sesion?.estado === 'en_progreso'

  // Combina items del servidor con ediciones locales
  const itemsConEdicion = useMemo(() =>
    items.map((item) => {
      const local = localItems[item.id]
      if (!local) return item
      return {
        ...item,
        cantidad_contada: local.estado === 'contado' && local.cantidad !== ''
          ? parseFloat(local.cantidad)
          : item.cantidad_contada,
        estado_item: local.estado as ConteoItem['estado_item'],
      }
    }),
    [items, localItems]
  )

  // Cálculos de progreso y resumen
  const stats = useMemo(() => {
    const contados = itemsConEdicion.filter((i) => i.estado_item === 'contado').length
    const total = itemsConEdicion.length
    const progreso = total > 0 ? Math.round((contados / total) * 100) : 0
    
    const sinDiff = itemsConEdicion.filter((i) => i.estado_item === 'contado' && Number(i.cantidad_contada) === Number(i.stock_sistema)).length
    const negativo = itemsConEdicion.filter((i) => i.estado_item === 'contado' && i.cantidad_contada !== null && Number(i.cantidad_contada) < Number(i.stock_sistema)).length
    const positivo = itemsConEdicion.filter((i) => i.estado_item === 'contado' && i.cantidad_contada !== null && Number(i.cantidad_contada) > Number(i.stock_sistema)).length
    const noContados = itemsConEdicion.filter((i) => i.estado_item === 'no_contado').length

    return { contados, total, progreso, sinDiff, negativo, positivo, noContados }
  }, [itemsConEdicion])

  // Mutation: Guardar cambios parciales
  const guardarMutation = useMutation({
    mutationFn: (payload: any) => api.patch(`/conteo/${id}/items`, { items: payload }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conteo-detalle', id] })
      setLocalItems({})
      toast.success('Cambios guardados')
    },
    onError: (err: any) => {
      if (err?.response?.data?.code === 'VERSION_CONFLICT') {
        toast.error('Conflicto de versión. Recargando datos...')
        queryClient.invalidateQueries({ queryKey: ['conteo-detalle', id] })
        setLocalItems({})
      } else {
        toast.error('Error al guardar')
      }
    },
  })

  // Mutation: Confirmar sesión
  const confirmarMutation = useMutation({
    mutationFn: () =>
      api.post(`/conteo/${id}/confirmar`, { nota: nota || undefined }, {
        headers: { 'x-idempotency-key': uuidv4() }
      }).then((r) => r.data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['conteo'] })
      queryClient.invalidateQueries({ queryKey: ['conteo-pendientes'] })
      toast.success(`Conteo confirmado: ${res.ajustes_generados} ajustes generados`)
      navigate('/conteo')
    },
    onError: () => toast.error('Error al confirmar el conteo'),
  })

  const actions = {
    updateItem: (item: ConteoItem, valor: string) => {
      setLocalItems((prev) => ({
        ...prev,
        [item.id]: { cantidad: valor, estado: 'contado', version: prev[item.id]?.version ?? item.version }
      }))
    },
    toggleNoContado: (item: ConteoItem) => {
      const estaNoContado = (localItems[item.id]?.estado ?? item.estado_item) === 'no_contado'
      setLocalItems((prev) => ({
        ...prev,
        [item.id]: { cantidad: '', estado: estaNoContado ? 'pendiente' : 'no_contado', version: prev[item.id]?.version ?? item.version }
      }))
    },
    save: () => {
      const payload = Object.entries(localItems).map(([item_id, local]) => ({
        item_id,
        cantidad_contada: local.estado === 'contado' && local.cantidad !== '' ? parseFloat(local.cantidad) : null,
        estado_item: local.estado,
        version: local.version,
      }))
      if (payload.length > 0) guardarMutation.mutate(payload)
    },
    confirm: () => confirmarMutation.mutate(),
    setNota,
  }

  return {
    sesion,
    items: itemsConEdicion,
    presentaciones: data?.presentaciones ?? [],
    isLoading,
    isError,
    stats,
    editable,
    actions,
    nota,
    isSaving: guardarMutation.isPending,
    isConfirming: confirmarMutation.isPending,
    hasChanges: Object.keys(localItems).length > 0,
  }
}

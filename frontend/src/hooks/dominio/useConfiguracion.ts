import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { obtenerConfiguracion, actualizarConfiguracion } from '@/api'
import type { UpdateConfiguracion } from '@/api'
import { notify } from '@/lib/notify'
import { parseApiError } from '@/lib/api-error'
import { configuracionKeys } from '@/lib/queryKeys'

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useConfiguracion() {
  return useQuery({
    queryKey: configuracionKeys.all,
    queryFn: () => obtenerConfiguracion(),
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useActualizarConfiguracion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: UpdateConfiguracion) => actualizarConfiguracion(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configuracionKeys.all })
      notify.success('Configuración actualizada')
    },
    onError: (err) => notify.error(parseApiError(err)),
  })
}

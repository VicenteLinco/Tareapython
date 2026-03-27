interface ApiErrorBody {
  error?: string
  message?: string
  details?: string
}

export function parseApiError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Error inesperado'
  const e = err as { response?: { status?: number; data?: ApiErrorBody }; message?: string }

  const data = e.response?.data
  const status = e.response?.status

  if (data?.message) return data.message
  if (data?.error) return data.error

  switch (status) {
    case 400: return 'Datos inválidos. Revisa el formulario.'
    case 401: return 'Credenciales inválidas o sesión expirada.'
    case 403: return 'No tienes permisos para esta acción.'
    case 404: return 'El recurso no fue encontrado.'
    case 409: return 'Conflicto: el registro fue modificado por otro usuario.'
    case 422: return data?.details ?? 'Error de validación.'
    case 500: return 'Error del servidor. Intenta en unos minutos.'
    default:
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Sin conexión a internet.'
      return e.message ?? 'Error de conexión.'
  }
}

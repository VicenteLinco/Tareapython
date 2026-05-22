interface ApiErrorBody {
  error?: string | { code?: string; message?: string }
  message?: string
  details?: Record<string, unknown>
}

export function parseApiError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Error inesperado'
  const e = err as { response?: { status?: number; data?: ApiErrorBody }; message?: string }

  const data = e.response?.data
  const status = e.response?.status

  // Prioridad: mensaje explícito del backend
  if (data?.message) return data.message
  
  // Si el backend devuelve { error: { code, message } }
  if (data?.error) {
    if (typeof data.error === 'string') return data.error
    if (typeof data.error === 'object' && data.error.message) return data.error.message
  }

  switch (status) {
    case 400: return 'Datos inválidos. Revisa el formulario.'
    case 401: return 'Credenciales inválidas o sesión expirada.'
    case 403: return 'No tienes permisos para esta acción.'
    case 404: return 'El recurso no fue encontrado.'
    case 409: return 'Conflicto: el registro fue modificado por otro usuario.'
    case 422: return data?.message ?? 'Error de validación.'
    case 500: return 'Error del servidor. Intenta en unos minutos.'
    default:
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Sin conexión a internet.'
      return e.message ?? 'Error de conexión.'
  }
}

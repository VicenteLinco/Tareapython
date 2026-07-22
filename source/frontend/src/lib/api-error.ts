import type { ApiError, ApiErrorCode } from "@/types/generated";

interface LegacyApiErrorBody {
  error?: string | { code?: string; message?: string };
  message?: string;
  details?: Record<string, unknown>;
}

type ApiErrorBody = Partial<ApiError> & LegacyApiErrorBody;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getApiError(err: unknown): ApiError | null {
  if (!isObject(err)) return null;

  const response = (err as { response?: { data?: unknown } }).response;
  const data = response?.data;
  if (!isObject(data)) return null;

  if (typeof data.code === "string" && typeof data.message === "string") {
    return {
      code: data.code as ApiErrorCode,
      message: data.message,
      details: isObject(data.details) ? data.details : undefined,
    };
  }

  const legacyError = data.error;
  if (isObject(legacyError) && typeof legacyError.message === "string") {
    return {
      code: (typeof legacyError.code === "string"
        ? legacyError.code
        : "INTERNAL_ERROR") as ApiErrorCode,
      message: legacyError.message,
      details: isObject(data.details) ? data.details : undefined,
    };
  }

  return null;
}

export function getApiErrorCode(err: unknown): ApiErrorCode | null {
  return getApiError(err)?.code ?? null;
}

export function getApiStatus(err: unknown): number | null {
  if (!isObject(err)) return null;
  const status = (err as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : null;
}

export function parseApiError(err: unknown): string {
  if (!err || typeof err !== "object") return "Error inesperado";
  const e = err as {
    response?: { status?: number; data?: ApiErrorBody };
    message?: string;
  };

  const data = e.response?.data;
  const status = e.response?.status;

  const typed = getApiError(err);
  if (typed) return typed.message;

  if (data?.message) return data.message;

  if (data?.error) {
    if (typeof data.error === "string") return data.error;
    if (typeof data.error === "object" && data.error.message)
      return data.error.message;
  }

  switch (status) {
    case 400:
      return "Datos invalidos. Revisa el formulario.";
    case 401:
      return "Credenciales invalidas o sesion expirada.";
    case 403:
      return "No tienes permisos para esta accion.";
    case 404:
      return "El recurso no fue encontrado.";
    case 409:
      return "Conflicto: el registro fue modificado por otro usuario.";
    case 422:
      return data?.message ?? "Error de validacion.";
    case 500:
      return "Error del servidor. Intenta en unos minutos.";
    default:
      if (typeof navigator !== "undefined" && !navigator.onLine)
        return "Sin conexion a internet.";
      return e.message ?? "Error de conexion.";
  }
}

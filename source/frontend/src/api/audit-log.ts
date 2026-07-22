// Dominio: audit log (registro de cambios en catálogos)
import api from "@/lib/api";
import type { PaginatedResponse } from "@/types";

// ─── Tipos locales ────────────────────────────────────────────────────────────

export interface AuditLogItem {
  id: number;
  tabla: string;
  registro_id: string;
  accion: "CREATE" | "UPDATE" | "DELETE";
  datos_anteriores: Record<string, unknown> | null;
  datos_nuevos: Record<string, unknown> | null;
  usuario_nombre: string;
  created_at: string;
}

export interface AuditLogQuery {
  tabla?: string | null;
  accion?: string | null;
  desde?: string | null;
  hasta?: string | null;
  page?: number;
  per_page?: number;
}

// ─── Funciones ────────────────────────────────────────────────────────────────

/** GET /audit-log — Listar entradas del log de auditoría paginado */
export async function listarAuditLog(
  params?: AuditLogQuery,
): Promise<PaginatedResponse<AuditLogItem>> {
  const { data } = await api.get<PaginatedResponse<AuditLogItem>>(
    "/audit-log",
    { params },
  );
  return data;
}

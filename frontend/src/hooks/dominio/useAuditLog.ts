import { useQuery } from '@tanstack/react-query'
import { listarAuditLog } from '@/api'
import type { AuditLogQuery } from '@/api'
import { auditLogKeys } from '@/lib/queryKeys'

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useAuditLog(params?: AuditLogQuery) {
  return useQuery({
    queryKey: auditLogKeys.list(params),
    queryFn: () => listarAuditLog(params),
    staleTime: 2 * 60 * 1000,
  })
}

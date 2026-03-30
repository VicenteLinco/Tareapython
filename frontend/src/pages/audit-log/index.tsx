import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  FileText, 
  Calendar, 
  User, 
  Database,
  History,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import api from '@/lib/api'
import type { PaginatedResponse } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'

interface AuditLogItem {
  id: number
  tabla: string
  registro_id: string
  accion: 'CREATE' | 'UPDATE' | 'DELETE'
  datos_anteriores: any
  datos_nuevos: any
  usuario_nombre: string
  created_at: string
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [tabla, setTabla] = useState('')
  const [accion, setAccion] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', { page, tabla, accion }],
    queryFn: () =>
      api.get<PaginatedResponse<AuditLogItem>>('/audit-log', {
        params: { page, per_page: 20, tabla: tabla || undefined, accion: accion || undefined }
      }).then(r => r.data)
  })

  const logs = data?.data || []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="w-6 h-6 text-primary" />
          Auditoría del Sistema
        </h1>
        <p className="text-sm opacity-50 mt-1">Seguimiento detallado de cambios en el catálogo y configuraciones</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 bg-base-100 p-4 rounded-2xl border border-base-200 shadow-sm">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 opacity-30" />
          <select 
            className="select select-bordered select-sm w-40"
            value={tabla}
            onChange={e => { setTabla(e.target.value); setPage(1); }}
          >
            <option value="">Todas las tablas</option>
            <option value="productos">Productos</option>
            <option value="proveedores">Proveedores</option>
            <option value="categorias">Categorías</option>
            <option value="areas">Áreas</option>
            <option value="unidades_basicas">Unidades</option>
            <option value="usuarios">Usuarios</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 opacity-30" />
          <select 
            className="select select-bordered select-sm w-40"
            value={accion}
            onChange={e => { setAccion(e.target.value); setPage(1); }}
          >
            <option value="">Todas las acciones</option>
            <option value="CREATE">Creación</option>
            <option value="UPDATE">Modificación</option>
            <option value="DELETE">Eliminación</option>
          </select>
        </div>
      </div>

      {/* Timeline List */}
      <div className="flex flex-col gap-4">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-base-200 animate-pulse rounded-2xl" />)
        ) : logs.length === 0 ? (
          <div className="py-20 text-center bg-base-100 rounded-3xl border border-dashed border-base-300 opacity-40">
            No se encontraron registros de auditoría
          </div>
        ) : (
          logs.map(log => (
            <div 
              key={log.id} 
              className={`bg-base-100 border rounded-2xl shadow-sm overflow-hidden transition-all
                ${expandedId === log.id ? 'ring-2 ring-primary/20 border-primary/30' : 'border-base-200'}
              `}
            >
              <div 
                className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-base-200/20"
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    log.accion === 'CREATE' ? 'bg-success/10 text-success' :
                    log.accion === 'DELETE' ? 'bg-error/10 text-error' :
                    'bg-info/10 text-info'
                  }`}>
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm uppercase tracking-tight">{log.tabla}</span>
                      <Badge variant={
                        log.accion === 'CREATE' ? 'success' :
                        log.accion === 'DELETE' ? 'destructive' : 'info'
                      } className="text-[10px] h-4 px-1.5">
                        {log.accion}
                      </Badge>
                    </div>
                    <p className="text-xs opacity-50 font-mono mt-0.5">ID: {log.registro_id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <User className="w-3 h-3 opacity-40" />
                      {log.usuario_nombre}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] opacity-40 font-mono mt-0.5">
                      <Calendar className="w-3 h-3" />
                      {formatDateTime(log.created_at)}
                    </div>
                  </div>
                  {expandedId === log.id ? <ChevronUp className="w-4 h-4 opacity-30" /> : <ChevronDown className="w-4 h-4 opacity-30" />}
                </div>
              </div>

              {expandedId === log.id && (
                <div className="px-4 pb-4 border-t border-base-200 bg-base-200/10">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 ml-1">Estado Anterior</h4>
                      <pre className="p-3 bg-base-300/50 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 custom-scrollbar">
                        {JSON.stringify(log.datos_anteriores || {}, null, 2)}
                      </pre>
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-40 ml-1">Estado Nuevo</h4>
                      <pre className="p-3 bg-base-300/50 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 custom-scrollbar">
                        {JSON.stringify(log.datos_nuevos || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-4">
        <Pagination 
          page={page} 
          totalPages={data?.total_pages || 1} 
          onPageChange={setPage} 
        />
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import api from '@/lib/api'
import type { Proveedor } from '@/types'
import { formatDate } from '@/lib/utils'

// Shape returned by the backend listar endpoint
interface RecepcionRow {
  id: string
  numero_documento: string
  proveedor_nombre: string
  guia_despacho?: string | null
  estado: string
  fecha_recepcion: string
  usuario_nombre: string
  created_at: string
}

export default function RecepcionesPage() {
  const [proveedorId, setProveedorId] = useState('')
  const [estado, setEstado] = useState('')
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['recepciones', { proveedorId, estado }],
    queryFn: () =>
      api.get<RecepcionRow[]>('/recepciones', {
        params: {
          proveedor_id: proveedorId || undefined,
          estado: estado || undefined,
        },
      }).then((r) => r.data),
  })

  const { data: proveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then((r) => r.data),
  })

  const columns = [
    {
      key: 'numero_documento',
      header: 'N° Documento',
      render: (item: RecepcionRow) => (
        <span className="font-mono text-sm font-medium">{item.numero_documento}</span>
      ),
    },
    {
      key: 'proveedor_nombre',
      header: 'Proveedor',
      render: (item: RecepcionRow) => (
        <span className="text-sm">{item.proveedor_nombre}</span>
      ),
    },
    {
      key: 'fecha_recepcion',
      header: 'Fecha',
      render: (item: RecepcionRow) => formatDate(item.fecha_recepcion),
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (item: RecepcionRow) => (
        <Badge variant={item.estado === 'completa' || item.estado === 'confirmada' ? 'success' : 'secondary'}>
          {item.estado === 'completa' || item.estado === 'confirmada' ? 'Confirmada' : 'Borrador'}
        </Badge>
      ),
    },
    { key: 'usuario_nombre', header: 'Usuario', className: 'hidden md:table-cell' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recepciones</h1>
        <button className="btn btn-primary" onClick={() => navigate('/recepciones/nueva')}>
          <Plus className="h-4 w-4" />
          Nueva Recepción
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <ProveedorSelect
          value={proveedorId}
          onChange={(v) => setProveedorId(v)}
          proveedores={proveedores ?? []}
          allLabel="Todos los proveedores"
          className="w-56"
          size="md"
        />
        <select
          className="select select-bordered w-44"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="completa">Confirmada</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 w-full" />)}
        </div>
      ) : (
        <DataTable
          columns={columns as any}
          data={(data ?? []) as unknown as Record<string, unknown>[]}
          onRowClick={(item) => navigate(`/recepciones/${(item as unknown as RecepcionRow).id}`)}
          emptyMessage="No hay recepciones"
        />
      )}
    </div>
  )
}

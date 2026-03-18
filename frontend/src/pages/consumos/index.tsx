import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { Plus, Trash2, Send, CheckCircle, Zap } from 'lucide-react'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useAreaStore } from '@/hooks/use-area-store'
import api from '@/lib/api'
import type { Producto, Area, ConsumoRequest, ConsumoBatchRequest } from '@/types'
import { toast } from 'sonner'

interface ConsumoLine {
  id: string
  producto_id: number | null
  cantidad: number
}

export default function ConsumosPage() {
  const [mode, setMode] = useState<'individual' | 'batch'>('individual')
  const [areaId, setAreaId] = useState<number | null>(useAreaStore.getState().selectedAreaId)
  const [productoId, setProductoId] = useState<number | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [notas, setNotas] = useState('')
  const [lines, setLines] = useState<ConsumoLine[]>([])
  const [success, setSuccess] = useState(false)
  const queryClient = useQueryClient()

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: productos } = useQuery({
    queryKey: ['productos-list', areaId],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', {
      params: { area_id: areaId || undefined, per_page: 500 },
    }).then((r) => r.data.data),
    enabled: !!areaId,
  })

  const showSuccess = () => { setSuccess(true); setTimeout(() => setSuccess(false), 2500) }

  const consumoMutation = useMutation({
    mutationFn: (data: ConsumoRequest) =>
      api.post('/consumos', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      setProductoId(null); setCantidad(''); setNotas('')
      toast.success('Consumo registrado')
      showSuccess()
    },
    onError: () => toast.error('Error al registrar consumo'),
  })

  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      setLines([]); setNotas('')
      toast.success('Consumo batch registrado')
      showSuccess()
    },
    onError: () => toast.error('Error al registrar consumo batch'),
  })

  const handleIndividual = (e: React.FormEvent) => {
    e.preventDefault()
    if (!productoId || !areaId || !cantidad) return
    consumoMutation.mutate({ producto_id: productoId, area_id: areaId, cantidad: Number(cantidad), notas: notas || undefined })
  }

  const handleBatch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!areaId || lines.length === 0) return
    const valid = lines.filter((l) => l.producto_id && l.cantidad > 0)
    if (valid.length === 0) return
    batchMutation.mutate({
      area_id: areaId,
      items: valid.map((l) => ({ producto_id: l.producto_id!, cantidad: l.cantidad })),
      notas: notas || undefined,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Consumos</h1>
          <p className="text-sm opacity-50 mt-0.5">Registrar salida de insumos (FEFO automático)</p>
        </div>
        <div className="flex bg-base-200 rounded-lg p-0.5">
          {(['individual', 'batch'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                mode === m ? 'bg-base-100 shadow-sm text-base-content' : 'text-base-content/40 hover:text-base-content/70'
              }`}
            >
              {m === 'individual' ? 'Individual' : 'Batch'}
            </button>
          ))}
        </div>
      </div>

      {/* Area */}
      <div className="max-w-xs space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Área</label>
        <select className="select select-bordered select-sm w-full h-9" value={areaId ?? ''}
          onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Seleccionar área</option>
          {(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      {/* Success banner */}
      {success && (
        <div className="flex items-center gap-2.5 rounded-xl bg-success/10 border border-success/20 px-5 py-3.5 animate-in fade-in">
          <CheckCircle className="h-4.5 w-4.5 text-success" />
          <span className="text-sm font-medium text-success">Consumo registrado exitosamente</span>
        </div>
      )}

      {mode === 'individual' ? (
        <div className="rounded-xl border border-base-200 bg-base-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-base-200 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary opacity-60" />
            <h2 className="text-sm font-semibold">Consumo Individual</h2>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">FEFO</span>
          </div>
          <form onSubmit={handleIndividual} className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Producto</label>
              <select className="select select-bordered w-full h-10" value={productoId ?? ''}
                onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : null)} disabled={!areaId}>
                <option value="">Seleccionar producto...</option>
                {(productos ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` (${p.codigo})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Cantidad</label>
                <input type="number" className="input input-bordered w-full h-10" min="0.01" step="any"
                  value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Notas</label>
                <input type="text" className="input input-bordered w-full h-10"
                  value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-sm h-10 gap-2"
              disabled={!productoId || !areaId || !cantidad || consumoMutation.isPending}>
              {consumoMutation.isPending ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-3.5 w-3.5" />}
              {consumoMutation.isPending ? 'Registrando...' : 'Registrar'}
            </button>
          </form>
        </div>
      ) : (
        <div className="rounded-xl border border-base-200 bg-base-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-base-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Consumo Batch</h2>
              {lines.length > 0 && (
                <span className="badge badge-sm badge-primary">{lines.length}</span>
              )}
            </div>
            <button className="btn btn-ghost btn-xs gap-1" disabled={!areaId}
              onClick={() => setLines([...lines, { id: uuidv4(), producto_id: null, cantidad: 0 }])}>
              <Plus className="h-3 w-3" /> Agregar
            </button>
          </div>
          <form onSubmit={handleBatch} className="p-5 space-y-4">
            {lines.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm opacity-30">Agregue productos al consumo batch</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={line.id} className="flex items-center gap-2.5 rounded-lg bg-base-200/40 border border-base-200 p-2.5">
                    <span className="text-[10px] font-bold opacity-25 w-4 text-center">{i + 1}</span>
                    <select className="select select-bordered select-sm flex-1 h-8 text-sm" value={line.producto_id ?? ''}
                      onChange={(e) => setLines(lines.map((l) =>
                        l.id === line.id ? { ...l, producto_id: e.target.value ? Number(e.target.value) : null } : l
                      ))}>
                      <option value="">Producto...</option>
                      {(productos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <input type="number" className="input input-bordered input-sm w-24 h-8 text-sm" min="0.01" step="any"
                      value={line.cantidad || ''} placeholder="Cant."
                      onChange={(e) => setLines(lines.map((l) =>
                        l.id === line.id ? { ...l, cantidad: Number(e.target.value) } : l
                      ))} />
                    <button type="button" className="btn btn-ghost btn-xs btn-square opacity-30 hover:opacity-100"
                      onClick={() => setLines(lines.filter((l) => l.id !== line.id))}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider opacity-40">Notas</label>
              <input type="text" className="input input-bordered input-sm w-full h-9"
                value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: Corrida matutina" />
            </div>
            <button type="submit" className="btn btn-primary btn-sm h-10 gap-2"
              disabled={lines.length === 0 || !areaId || batchMutation.isPending}>
              {batchMutation.isPending ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-3.5 w-3.5" />}
              {batchMutation.isPending ? 'Registrando...' : `Registrar ${lines.length} item(s)`}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

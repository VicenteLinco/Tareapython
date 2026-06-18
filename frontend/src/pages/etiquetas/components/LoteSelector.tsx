import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface LoteResult {
  lote?: {
    id: string
    numero_lote: string
    producto_nombre: string
  }
  id?: string
  numero_lote?: string
  producto_nombre?: string
}

interface Props {
  onSelect: (id: string) => void
}

export function LoteSelector({ onSelect }: Props) {
  const [search, setSearch] = useState('')

  const { data } = useQuery({
    queryKey: ['lotes-search', search],
    queryFn: () =>
      api
        .get(`/api/v1/lotes/buscar-codigo/${encodeURIComponent(search)}`)
        .then((r) => r.data),
    enabled: search.length > 2,
  })

  const results: LoteResult[] =
    (data as { resultados?: LoteResult[] })?.resultados ?? []

  return (
    <div className="space-y-2">
      <input
        className="input input-bordered w-full max-w-md"
        placeholder="Número de lote del fabricante..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="menu bg-base-100 border border-base-300 rounded-xl max-w-md">
          {results.map((r) => (
            <li key={r.lote?.id ?? r.id}>
              <button
                onClick={() => {
                  onSelect(r.lote?.id ?? r.id ?? '')
                  setSearch('')
                }}
              >
                {r.lote?.numero_lote ?? r.numero_lote} —{' '}
                {r.lote?.producto_nombre ?? r.producto_nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

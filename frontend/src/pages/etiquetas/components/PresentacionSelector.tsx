import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

interface PresentacionItem {
  id: number
  nombre: string
  producto_nombre?: string
}

interface Props {
  onSelect: (id: string) => void
}

export function PresentacionSelector({ onSelect }: Props) {
  const [search, setSearch] = useState('')

  const { data } = useQuery({
    queryKey: ['presentaciones-search', search],
    queryFn: () =>
      api.get(`/api/v1/presentaciones?q=${encodeURIComponent(search)}`).then((r) => r.data),
    enabled: search.length > 1,
  })

  const items: PresentacionItem[] =
    (data as { presentaciones?: PresentacionItem[]; items?: PresentacionItem[] } | PresentacionItem[])
      ? Array.isArray(data)
        ? data
        : (data as { presentaciones?: PresentacionItem[]; items?: PresentacionItem[] })
            ?.presentaciones ??
          (data as { items?: PresentacionItem[] })?.items ??
          []
      : []

  return (
    <div className="space-y-2">
      <input
        className="input input-bordered w-full max-w-md"
        placeholder="Buscar presentación..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {items.length > 0 && (
        <ul className="menu bg-base-100 border border-base-300 rounded-xl max-h-48 overflow-y-auto w-full max-w-md">
          {items.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  onSelect(String(item.id))
                  setSearch('')
                }}
              >
                {item.nombre} — {item.producto_nombre ?? ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

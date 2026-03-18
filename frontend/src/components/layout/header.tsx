import { LogOut } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useAreaStore } from '@/hooks/use-area-store'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Area } from '@/types'

export function Header() {
  const { usuario, logout } = useAuthStore()
  const { selectedAreaId, setSelectedArea } = useAreaStore()
  const navigate = useNavigate()

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const userAreas = areas?.filter((a) => usuario?.area_ids?.includes(a.id)) ?? []

  return (
    <header className="glass-header sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-base-200 bg-base-100/80 px-6">
      <div className="flex items-center gap-3">
        {userAreas.length > 1 && (
          <select
            className="select select-sm select-ghost font-medium w-auto"
            value={selectedAreaId ?? ''}
            onChange={(e) => setSelectedArea(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las áreas</option>
            {userAreas.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        )}
        {userAreas.length === 1 && (
          <span className="text-sm font-medium opacity-50">{userAreas[0].nombre}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
            {usuario?.nombre?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-semibold leading-tight">{usuario?.nombre}</span>
            <span className="text-[10px] opacity-40 capitalize leading-tight">{usuario?.rol}</span>
          </div>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Cerrar sesión">
          <button onClick={handleLogout} className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}

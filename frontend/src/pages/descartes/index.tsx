import { useState } from 'react'
import { PackageX, Plus, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NuevoDescarteTab } from './nuevo-descarte-tab'
import { HistorialTab } from './historial-tab'
import { useQueryClient } from '@tanstack/react-query'

type Tab = 'nuevo' | 'historial'

export default function DescartesPage() {
  const [tab, setTab] = useState<Tab>('nuevo')
  const queryClient = useQueryClient()

  const handleDescarteCreado = () => {
    queryClient.invalidateQueries({ queryKey: ['descartes-historial'] })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <PackageX className="w-5 h-5 text-error" />
            Gestión de Descartes
          </h1>
          <p className="text-xs opacity-40">Retiro de insumos vencidos o dañados</p>
        </div>

        <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl">
          <button
            className={cn(
              'tab gap-2 rounded-xl transition-all px-5 h-9',
              tab === 'nuevo'
                ? 'tab-active bg-error text-error-content font-bold shadow'
                : 'hover:bg-base-300'
            )}
            onClick={() => setTab('nuevo')}
          >
            <Plus className="w-4 h-4" />
            Nuevo Descarte
          </button>
          <button
            className={cn(
              'tab gap-2 rounded-xl transition-all px-5 h-9',
              tab === 'historial'
                ? 'tab-active bg-base-100 font-bold shadow'
                : 'hover:bg-base-300'
            )}
            onClick={() => setTab('historial')}
          >
            <History className="w-4 h-4" />
            Historial
          </button>
        </div>
      </div>

      {/* Contenido */}
      {tab === 'nuevo' ? (
        <NuevoDescarteTab onDescarteCreado={handleDescarteCreado} />
      ) : (
        <HistorialTab />
      )}
    </div>
  )
}

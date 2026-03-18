import { useState } from 'react'
import { Tag, Layers, MapPin, Truck, LayoutList } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import CategoriasTab from './categorias-tab'
import UnidadesTab from './unidades-tab'
import AreasTab from './areas-tab'
import ProveedoresTab from './proveedores-tab'
import ProductosTab from './productos-tab'
import PresentacionesFormatosTab from './presentaciones-formatos-tab'

type ModalId = 'categorias' | 'unidades' | 'areas' | 'proveedores' | 'presentaciones' | null

export default function CatalogosPage() {
  const [modal, setModal] = useState<ModalId>(null)

  const cards = [
    { id: 'categorias'     as ModalId, label: 'Categorías',      icon: Tag,        desc: 'Grupos de productos'              },
    { id: 'unidades'       as ModalId, label: 'Unidades básicas', icon: Layers,     desc: 'Unidad básica de consumo'         },
    { id: 'areas'          as ModalId, label: 'Áreas',            icon: MapPin,     desc: 'Zonas del laboratorio'            },
    { id: 'proveedores'    as ModalId, label: 'Proveedores',      icon: Truck,      desc: 'Empresas suministradoras'         },
    { id: 'presentaciones' as ModalId, label: 'Presentaciones',   icon: LayoutList, desc: 'Formatos de ingreso de productos' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Creador de Productos</h1>
        <p className="text-sm opacity-50 mt-0.5">Administra los datos maestros del sistema</p>
      </div>

      {/* Support catalogs — compact accessory row */}
      <div className="flex items-center gap-3 pb-4">
        <span className="text-xs text-base-content/40 shrink-0">Gestión de listas desplegables</span>
        <div className="join">
          {cards.map(({ id, label, icon: Icon, desc }) => (
            <div key={id} className="tooltip tooltip-bottom" data-tip={desc}>
              <button
                onClick={() => setModal(id)}
                className="join-item btn btn-ghost btn-sm gap-1.5 font-normal"
              >
                <Icon className="h-3.5 w-3.5 opacity-60" />
                <span className="text-xs">{label}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Products — main content */}
      <ProductosTab />

      {/* Modals */}
      <Dialog open={modal === 'categorias'}     onClose={() => setModal(null)} title="Categorías"       className="max-w-2xl">
        <CategoriasTab />
      </Dialog>
      <Dialog open={modal === 'unidades'}       onClose={() => setModal(null)} title="Unidades básicas" className="max-w-2xl">
        <UnidadesTab />
      </Dialog>
      <Dialog open={modal === 'areas'}          onClose={() => setModal(null)} title="Áreas"            className="max-w-2xl">
        <AreasTab />
      </Dialog>
      <Dialog open={modal === 'proveedores'}    onClose={() => setModal(null)} title="Proveedores"      className="max-w-3xl">
        <ProveedoresTab />
      </Dialog>
      <Dialog open={modal === 'presentaciones'} onClose={() => setModal(null)} title="Formatos de presentación" className="max-w-md">
        <PresentacionesFormatosTab />
      </Dialog>
    </div>
  )
}

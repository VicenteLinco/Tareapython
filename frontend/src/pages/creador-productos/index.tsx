import { useSearchParams } from 'react-router-dom'
import { Tag, Layers, MapPin, Truck, LayoutList, Package, Barcode, ShieldAlert } from 'lucide-react'
import { useFullWidthPage } from '@/components/layout/page-width'
import { cn } from '@/lib/utils'
import CategoriasTab from './categorias-tab'
import UnidadesTab from './unidades-tab'
import AreasTab from './areas-tab'
import ProveedoresTab from './proveedores-tab'
import ProductosTab from './productos-tab'
import PresentacionesFormatosTab from './presentaciones-formatos-tab'
import GtinsTab from './gtins-tab'
import BandejaCatalogacionTab from './BandejaCatalogacionTab'

type TabId = 'productos' | 'categorias' | 'unidades' | 'areas' | 'proveedores' | 'presentaciones' | 'gtins' | 'catalogacion'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'productos',      label: 'Productos',      icon: Package   },
  { id: 'catalogacion',   label: 'Catalogación',   icon: ShieldAlert },
  { id: 'categorias',     label: 'Categorías',     icon: Tag       },
  { id: 'unidades',       label: 'Unidades',       icon: Layers    },
  { id: 'proveedores',    label: 'Proveedores',    icon: Truck     },
  { id: 'areas',          label: 'Áreas',          icon: MapPin    },
  { id: 'presentaciones', label: 'Presentaciones', icon: LayoutList },
  { id: 'gtins',          label: 'GTINs',          icon: Barcode   },
]

export default function CreadorProductosPage() {
  useFullWidthPage()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabId | null
  const tabActivo: TabId = TABS.some(t => t.id === tabParam) ? tabParam! : 'productos'

  const setTab = (id: TabId) => {
    const p = new URLSearchParams(searchParams)
    if (id === 'productos') p.delete('tab')
    else p.set('tab', id)
    setSearchParams(p, { replace: true })
  }

  return (
    <div className="space-y-0">
      <div className="mb-4">
        <h1 className="t-h1 tracking-tight">Creador de Productos</h1>
        <p className="text-sm opacity-50 mt-0.5">Administra los datos maestros del sistema</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-base-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap -mb-px",
              tabActivo === id
                ? "border-primary text-primary"
                : "border-transparent text-base-content/50 hover:text-base-content/80 hover:border-base-300"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Contenido del tab activo */}
      <div className="pt-5">
        {tabActivo === 'productos'      && <ProductosTab />}
        {tabActivo === 'catalogacion'   && <BandejaCatalogacionTab />}
        {tabActivo === 'categorias'     && <CategoriasTab />}
        {tabActivo === 'unidades'       && <UnidadesTab />}
        {tabActivo === 'proveedores'    && <ProveedoresTab />}
        {tabActivo === 'areas'          && <AreasTab />}
        {tabActivo === 'presentaciones' && <PresentacionesFormatosTab />}
        {tabActivo === 'gtins'          && <GtinsTab />}
      </div>
    </div>
  )
}

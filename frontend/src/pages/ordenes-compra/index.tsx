import { useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ShoppingBag, FileText, Search, X, Image as ImageIcon } from 'lucide-react'
import api from '@/lib/api'
import type { OrdenCompraResumen, PaginatedResponse, RecepcionListItem } from '@/types'
import { formatDate, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ESTADO_LABEL, ESTADO_BADGE_CLASS } from './utils'
import { AuthenticatedUploadImage } from '@/components/ui/authenticated-image'

const PAGE_SIZE_OC = 15
const PAGE_SIZE_GUIAS = 8

export default function OrdenesCompraPage() {
  const [tabActivo, setTabActivo] = useState<'ordenes' | 'guias'>('ordenes')
  const navigate = useNavigate()

  // --- Estados para Órdenes de Compra ---
  const [pageOC, setPageOC] = useState(1)

  // --- Estados para Guías Respaldadas ---
  const [guiaSearchInput, setGuiaSearchInput] = useState('')
  const [guiaSearch, setGuiaSearch] = useState('')
  const [pageGuias, setPageGuias] = useState(1)
  const [selectedFotoPath, setSelectedFotoPath] = useState<string | null>(null)
  const [selectedFotoTitle, setSelectedFotoTitle] = useState<string | null>(null)

  // Debounce para búsqueda de guías
  useEffect(() => {
    const timer = setTimeout(() => {
      setGuiaSearch(guiaSearchInput)
      setPageGuias(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [guiaSearchInput])

  // --- Query Órdenes de Compra ---
  const { data: dataOC, isLoading: isLoadingOC } = useQuery({
    queryKey: ['ordenes-compra', pageOC],
    queryFn: () =>
      api.get<PaginatedResponse<OrdenCompraResumen>>('/ordenes-compra', {
        params: { page: pageOC, per_page: PAGE_SIZE_OC },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: tabActivo === 'ordenes',
  })

  // --- Query Guías Respaldadas (Recepciones con foto) ---
  const { data: dataGuias, isLoading: isLoadingGuias } = useQuery({
    queryKey: ['guias-respaldadas', { search: guiaSearch, page: pageGuias }],
    queryFn: () =>
      api.get<PaginatedResponse<RecepcionListItem>>('/recepciones', {
        params: {
          solo_con_foto: true,
          busqueda: guiaSearch || undefined,
          page: pageGuias,
          per_page: PAGE_SIZE_GUIAS,
        },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: tabActivo === 'guias',
  })

  const rowsOC = dataOC?.data ?? []
  const totalOC = dataOC?.total ?? 0
  const totalPagesOC = dataOC?.total_pages ?? 1

  const rowsGuias = dataGuias?.data ?? []
  const totalGuias = dataGuias?.total ?? 0
  const totalPagesGuias = dataGuias?.total_pages ?? 1

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-base-content/50 mb-1">
          <Link to="/solicitudes-compra" className="hover:text-primary transition-colors">
            Solicitudes de Compra
          </Link>
          <span>/</span>
          <span>Adquisiciones</span>
        </div>
        <h1 className="t-h1 flex items-center gap-2">
          <ShoppingBag className="w-6 h-6 text-primary" />
          Módulo de Adquisiciones
        </h1>
      </div>

      {/* Tabs */}
      <div role="tablist" className="tabs tabs-boxed w-fit bg-base-200 p-1 rounded-2xl border border-base-300">
        <button
          role="tab"
          className={cn('tab rounded-xl font-medium text-xs px-5', tabActivo === 'ordenes' ? 'tab-active' : '')}
          onClick={() => setTabActivo('ordenes')}
        >
          Órdenes de Compra
        </button>
        <button
          role="tab"
          className={cn('tab rounded-xl font-medium text-xs px-5', tabActivo === 'guias' ? 'tab-active' : '')}
          onClick={() => setTabActivo('guias')}
        >
          Guías de Despacho Respaldadas
        </button>
      </div>

      {/* --- PESTAÑA 1: ÓRDENES DE COMPRA --- */}
      {tabActivo === 'ordenes' && (
        <div className="space-y-4">
          <div className="rounded-[2rem] border border-base-200 bg-base-100 overflow-hidden shadow-sm">
            <table className="table w-full">
              <thead>
                <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
                  <th className="pl-8">N° OC</th>
                  <th>Proveedor</th>
                  <th className="hidden md:table-cell">Solicitud origen</th>
                  <th className="hidden lg:table-cell">Entrega esperada</th>
                  <th>Estado</th>
                  <th className="text-center pr-8">Ítems</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-200">
                {isLoadingOC ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i}>
                      <td className="pl-8"><Skeleton className="h-5 w-28 rounded-lg" /></td>
                      <td><Skeleton className="h-5 w-36 rounded-lg" /></td>
                      <td className="hidden md:table-cell"><Skeleton className="h-5 w-24 rounded-lg" /></td>
                      <td className="hidden lg:table-cell"><Skeleton className="h-5 w-24 rounded-lg" /></td>
                      <td><Skeleton className="h-5 w-20 rounded-lg" /></td>
                      <td className="pr-8"><Skeleton className="h-5 w-8 mx-auto rounded-lg" /></td>
                    </tr>
                  ))
                ) : rowsOC.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-20 text-center">
                      <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-10" />
                      <p className="text-sm opacity-40 italic">No hay órdenes de compra registradas</p>
                    </td>
                  </tr>
                ) : (
                  rowsOC.map((oc) => (
                    <tr
                      key={oc.id}
                      className="hover:bg-base-200/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/ordenes-compra/${oc.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs pl-8">
                        <Link to={`/ordenes-compra/${oc.id}`} className="hover:underline text-primary font-bold">
                          {oc.numero_documento}
                        </Link>
                      </td>
                      <td className="text-sm font-medium">{oc.proveedor_nombre}</td>
                      <td className="hidden md:table-cell">
                        {oc.solicitud_numero ? (
                          <span className="font-mono text-xs text-base-content/60">{oc.solicitud_numero}</span>
                        ) : (
                          <span className="text-xs opacity-30">—</span>
                        )}
                      </td>
                      <td className="hidden lg:table-cell text-xs text-base-content/60">
                        {oc.fecha_entrega_esperada ? formatDate(oc.fecha_entrega_esperada) : <span className="opacity-30">—</span>}
                      </td>
                      <td>
                        <Badge
                          className={cn(
                            'uppercase text-[9px] font-bold px-2 py-0.5 rounded-lg border-none',
                            ESTADO_BADGE_CLASS[oc.estado]
                          )}
                        >
                          {ESTADO_LABEL[oc.estado]}
                        </Badge>
                      </td>
                      <td className="text-center pr-8">
                        <Badge variant="secondary" className="font-bold tabular-nums">
                          {oc.items_count}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación OC */}
          {!isLoadingOC && rowsOC.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-50 text-xs">
                {totalOC} resultado{totalOC !== 1 ? 's' : ''} · página {pageOC} de {totalPagesOC}
              </span>
              <div className="join">
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPageOC((p) => Math.max(1, p - 1))}
                  disabled={pageOC === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPageOC((p) => Math.min(totalPagesOC, p + 1))}
                  disabled={pageOC >= totalPagesOC}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- PESTAÑA 2: GUÍAS DE DESPACHO RESPALDADAS --- */}
      {tabActivo === 'guias' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Barra de búsqueda */}
          <div className="rounded-2xl border border-base-200 bg-base-100 p-3 shadow-sm flex items-center max-w-md">
            <Search className="h-4 w-4 opacity-40 shrink-0 mr-2" />
            <input
              type="text"
              placeholder="Buscar por N° guía, proveedor o recepción..."
              className="grow text-sm bg-transparent outline-none border-none"
              value={guiaSearchInput}
              onChange={(e) => setGuiaSearchInput(e.target.value)}
            />
            {guiaSearchInput && (
              <button onClick={() => setGuiaSearchInput('')} className="btn btn-ghost btn-xs btn-circle">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Galería Visual */}
          {isLoadingGuias ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card bg-base-100 border border-base-200 overflow-hidden rounded-2xl shadow-sm space-y-3 p-0">
                  <Skeleton className="h-40 w-full rounded-t-2xl rounded-b-none" />
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-4 w-2/3 rounded-lg" />
                    <Skeleton className="h-3 w-1/2 rounded-lg" />
                    <Skeleton className="h-8 w-full rounded-xl mt-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : rowsGuias.length === 0 ? (
            <div className="rounded-[2rem] border border-base-200 bg-base-100 p-12 text-center shadow-sm">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20 text-primary" />
              <h3 className="font-bold text-base mb-1">No se encontraron guías respaldadas</h3>
              <p className="text-sm opacity-40 max-w-md mx-auto">
                {guiaSearch ? 'Ajusta los filtros de búsqueda o ingresa un término diferente.' : 'Aún no se han adjuntado fotos de guías de despacho en las recepciones.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {rowsGuias.map((guia) => (
                <div
                  key={guia.id}
                  className="card bg-base-100 border border-base-200 overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 group flex flex-col"
                >
                  {/* Thumbnail */}
                  <div className="relative h-40 w-full overflow-hidden bg-base-200 shrink-0">
                    {guia.guia_despacho_archivo ? (
                      <AuthenticatedUploadImage
                        path={guia.guia_despacho_archivo}
                        alt={`Guía ${guia.guia_despacho}`}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-base-content/30">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <span className="badge badge-sm bg-base-100/90 text-[10px] font-bold shadow-sm py-2 px-2.5 border-none">
                        {guia.proveedor_nombre}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase font-bold tracking-wider opacity-45">N° Guía</p>
                          <h3
                            className="font-mono font-bold text-sm text-primary truncate"
                            title={guia.guia_despacho ?? ''}
                          >
                            {guia.guia_despacho || 'PROVISIONAL'}
                          </h3>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] uppercase font-bold tracking-wider opacity-45">Recepción</p>
                          <Link
                            to={`/recepciones/${guia.id}`}
                            className="font-mono font-bold text-xs hover:underline text-base-content/70"
                          >
                            {guia.numero_documento}
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-base-200 text-[11px] text-base-content/50">
                      <span>{formatDate(guia.fecha_recepcion)}</span>
                      <span className="truncate max-w-[110px]" title={guia.usuario_nombre}>
                        {guia.usuario_nombre}
                      </span>
                    </div>

                    {guia.guia_despacho_archivo && (
                      <button
                        type="button"
                        className="btn btn-xs btn-primary font-bold w-full gap-1.5 shadow-sm hover:scale-[1.01] transition-all"
                        onClick={() => {
                          setSelectedFotoPath(guia.guia_despacho_archivo)
                          setSelectedFotoTitle(guia.guia_despacho || guia.numero_documento)
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Ver Documento
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paginación Guías */}
          {!isLoadingGuias && rowsGuias.length > 0 && (
            <div className="flex items-center justify-between text-sm pt-4">
              <span className="opacity-50 text-xs">
                {totalGuias} resultado{totalGuias !== 1 ? 's' : ''} · página {pageGuias} de {totalPagesGuias}
              </span>
              <div className="join">
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPageGuias((p) => Math.max(1, p - 1))}
                  disabled={pageGuias === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPageGuias((p) => Math.min(totalPagesGuias, p + 1))}
                  disabled={pageGuias >= totalPagesGuias}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lightbox para visor de fotos */}
      {selectedFotoPath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 transition-opacity"
          onClick={() => {
            setSelectedFotoPath(null)
            setSelectedFotoTitle(null)
          }}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-12 left-0 right-0 flex items-center justify-between text-white px-2">
              <span className="font-semibold text-sm">Guía: {selectedFotoTitle}</span>
              <button
                className="btn btn-circle btn-sm btn-error"
                onClick={() => {
                  setSelectedFotoPath(null)
                  setSelectedFotoTitle(null)
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <AuthenticatedUploadImage
              path={selectedFotoPath}
              alt="Guía de despacho"
              className="max-h-[80vh] max-w-[85vw] rounded-xl shadow-2xl object-contain border border-base-200/20"
            />
          </div>
        </div>
      )}
    </div>
  )
}

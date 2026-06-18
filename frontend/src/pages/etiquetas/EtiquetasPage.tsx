import { useState } from 'react'
import { LabelTypeSelector } from './components/LabelTypeSelector'
import { LabelPreview } from './components/LabelPreview'
import { PrintDialog } from './components/PrintDialog'
import { PresentacionSelector } from './components/PresentacionSelector'
import { LoteSelector } from './components/LoteSelector'

export type LabelType = 'presentacion' | 'lote'

export function EtiquetasPage() {
  const [labelType, setLabelType] = useState<LabelType>('presentacion')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  const handleTypeChange = (t: LabelType) => {
    setLabelType(t)
    setSelectedId(null)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Etiquetas</h1>

      <LabelTypeSelector value={labelType} onChange={handleTypeChange} />

      {labelType === 'presentacion' && (
        <PresentacionSelector onSelect={setSelectedId} />
      )}
      {labelType === 'lote' && <LoteSelector onSelect={setSelectedId} />}

      {selectedId && (
        <>
          <LabelPreview type={labelType} id={selectedId} />
          <button className="btn btn-primary" onClick={() => setPrintOpen(true)}>
            Imprimir etiqueta
          </button>
        </>
      )}

      {printOpen && selectedId && (
        <PrintDialog
          type={labelType}
          id={selectedId}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  )
}

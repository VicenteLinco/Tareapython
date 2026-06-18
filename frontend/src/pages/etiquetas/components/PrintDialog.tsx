import { useRef } from 'react'
import { LabelPreview } from './LabelPreview'

interface Props {
  type: 'presentacion' | 'lote'
  id: string
  onClose: () => void
}

export function PrintDialog({ type, id, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const content = printRef.current?.innerHTML
    if (!content) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`
      <html><head><title>Etiqueta</title>
      <style>
        body { font-family: sans-serif; margin: 0; padding: 8px; }
        @media print { body { margin: 0; } }
        canvas { display: block; }
      </style>
      </head><body>${content}</body></html>
    `)
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg mb-4">Vista previa de impresión</h3>
        <div ref={printRef}>
          <LabelPreview type={type} id={id} />
        </div>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={handlePrint}>
            Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}

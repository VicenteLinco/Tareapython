import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate, formatCantidad, APP_LOCALE } from '@/lib/utils'
import { drawPdfLogo, hasValidLogo } from '@/lib/pdf-logo'
import type { DescarteSession, DescarteSessionItem } from '@/types'

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number }
}

const C = {
  primary: [15, 23, 42] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  textMain: [30, 41, 59] as [number, number, number],
  textLight: [100, 116, 139] as [number, number, number],
  error: [220, 38, 38] as [number, number, number],
  bgLight: [248, 250, 252] as [number, number, number],
}

function motivoLabel(tipo: DescarteSessionItem['tipo']): string {
  return tipo === 'DESCARTE_VENCIDO' ? 'Vencido' : 'Dañado/Otro'
}

export function exportarDescartePDF(
  session: DescarteSession,
  nombreLaboratorio = 'Laboratorio Clínico',
  logoBase64?: string | null
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const W = doc.internal.pageSize.getWidth()

  // Cabecera
  doc.setFillColor(...C.error)
  doc.rect(0, 0, W, 35, 'F')
  drawPdfLogo(doc, logoBase64, { x: 12, y: 6, maxW: 22, maxH: 22 })
  const textX = hasValidLogo(logoBase64) ? 40 : 15
  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('ACTA DE DESCARTE', textX, 17)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(nombreLaboratorio.toUpperCase(), textX, 25)

  const shortId = session.grupo_movimiento.slice(-8).toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`#${shortId}`, W - 20, 20, { align: 'right' })

  // Info general
  let y = 45
  doc.setTextColor(...C.textMain)
  doc.setFontSize(9)

  const infoRows: [string, string][] = [
    ['Fecha:', formatDate(session.fecha)],
    ['Responsable:', session.usuario_nombre],
    ['Área(s):', session.areas.join(', ')],
    ['Total ítems:', String(session.total_items)],
  ]

  for (const [label, value] of infoRows) {
    doc.setFont('helvetica', 'bold')
    doc.text(label, 15, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, 45, y)
    y += 6
  }

  y += 4

  autoTable(doc, {
    startY: y,
    head: [['#', 'Producto', 'Lote', 'Área', 'Motivo', 'Cantidad', 'Venc.', 'Nota']],
    body: session.items.map((item, i) => [
      String(i + 1),
      item.producto_nombre,
      item.codigo_lote,
      item.area_nombre,
      motivoLabel(item.tipo),
      formatCantidad(item.cantidad, item.unidad_base_nombre, item.unidad_base_nombre_plural),
      formatDate(item.fecha_vencimiento),
      item.nota ?? '',
    ]),
    headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: C.textMain },
    alternateRowStyles: { fillColor: C.bgLight },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 40 },
      2: { cellWidth: 20 },
      3: { cellWidth: 22 },
      4: { cellWidth: 18 },
      5: { cellWidth: 20 },
      6: { cellWidth: 18 },
      7: { cellWidth: 'auto' },
    },
    margin: { left: 15, right: 15 },
  })

  const finalY = doc.lastAutoTable.finalY + 15
  doc.setFontSize(9)
  doc.setTextColor(...C.textLight)
  doc.text('Firma responsable: ___________________________', 15, finalY)
  doc.text(`Generado: ${new Date().toLocaleString(APP_LOCALE)}`, W - 15, finalY, { align: 'right' })

  doc.save(`descarte-${session.fecha.slice(0, 10)}-${shortId}.pdf`)
}

export function exportarDescartesRangoPDF(
  sessions: DescarteSession[],
  desde: string | null,
  hasta: string | null,
  nombreLaboratorio = 'Laboratorio Clínico',
  logoBase64?: string | null
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const W = doc.internal.pageSize.getWidth()

  doc.setFillColor(...C.error)
  doc.rect(0, 0, W, 30, 'F')
  drawPdfLogo(doc, logoBase64, { x: 12, y: 5, maxW: 20, maxH: 20 })
  const textX = hasValidLogo(logoBase64) ? 38 : 15
  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('HISTORIAL DE DESCARTES', textX, 14)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(nombreLaboratorio.toUpperCase(), textX, 22)

  const rango =
    desde || hasta
      ? `Período: ${desde ? formatDate(desde) : '—'} → ${hasta ? formatDate(hasta) : '—'}`
      : 'Período: Todos los registros'
  doc.text(rango, W - 15, 22, { align: 'right' })

  const allRows: (string | number)[][] = []
  for (const session of sessions) {
    for (const item of session.items) {
      allRows.push([
        formatDate(session.fecha),
        session.usuario_nombre,
        item.producto_nombre,
        item.codigo_lote,
        item.area_nombre,
        motivoLabel(item.tipo),
        formatCantidad(item.cantidad, item.unidad_base_nombre, item.unidad_base_nombre_plural),
        formatDate(item.fecha_vencimiento),
        item.nota ?? '',
      ])
    }
  }

  autoTable(doc, {
    startY: 36,
    head: [['Fecha', 'Responsable', 'Producto', 'Lote', 'Área', 'Motivo', 'Cantidad', 'Venc.', 'Nota']],
    body: allRows,
    headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: C.textMain },
    alternateRowStyles: { fillColor: C.bgLight },
    margin: { left: 15, right: 15 },
  })

  const finalY = doc.lastAutoTable.finalY + 10
  doc.setFontSize(8)
  doc.setTextColor(...C.textLight)
  doc.text(`Total operaciones: ${sessions.length} · Total ítems: ${allRows.length}`, 15, finalY)
  doc.text(`Generado: ${new Date().toLocaleString(APP_LOCALE)}`, W - 15, finalY, { align: 'right' })

  const suffix = desde ? desde.slice(0, 7) : 'todos'
  doc.save(`descartes-${suffix}.pdf`)
}

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatDate } from '@/lib/utils'

interface SolicitudPdfOptions {
  numero_documento: string
  fecha_creacion: string
  usuario_nombre: string
  nota?: string | null
  subtotal_neto: number
  iva: number
  total_con_iva: number
  items: {
    producto_nombre: string
    cantidad_sugerida: number
    unidad: string
    codigo_maestro?: string | null
    codigo_proveedor?: string | null
    proveedor_nombre?: string | null
    presentacion_nombre?: string | null
    presentacion_nombre_plural?: string | null
    factor_conversion?: number | null
    precio_unitario?: number | null
    cantidad_presentaciones?: number | null
  }[]
  nombreLaboratorio: string
}

const C = {
  primary: [15, 23, 42] as [number, number, number], // Navy Dark
  secondary: [37, 99, 235] as [number, number, number], // Blue
  textMain: [30, 41, 59] as [number, number, number],
  textLight: [100, 116, 139] as [number, number, number],
  bgLight: [248, 250, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  accent: [241, 245, 249] as [number, number, number],
  muted: [200, 200, 200] as [number, number, number],
}

export async function exportarSolicitudPDF(options: SolicitudPdfOptions): Promise<void> {
  const { numero_documento, fecha_creacion, usuario_nombre, nota, items, nombreLaboratorio, subtotal_neto, iva, total_con_iva } = options

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  // --- CABECERA CORPORATIVA ---
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, W, 35, 'F')
  
  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('SOLICITUD DE COMPRA', 15, 18)
  
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('SISTEMA DE GESTIÓN DE INVENTARIO E INSUMOS CLÍNICOS', 15, 25)

  // Cuadro de Información del Documento
  doc.setFillColor(255, 255, 255, 0.1)
  doc.roundedRect(W - 75, 8, 60, 20, 2, 2, 'F')
  doc.setTextColor(...C.white)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(numero_documento, W - 45, 16, { align: 'center' })
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text('REFERENCIA INTERNA', W - 45, 22, { align: 'center' })

  // --- INFO DE EMISIÓN ---
  let y = 45
  doc.setTextColor(...C.primary)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(nombreLaboratorio.toUpperCase(), 15, y)
  
  y += 6
  doc.setDrawColor(...C.accent)
  doc.line(15, y, W - 15, y)
  
  y += 6
  doc.setFontSize(8)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'bold')
  doc.text('FECHA DE EMISIÓN', 15, y)
  doc.text('SOLICITANTE RESPONSABLE', 70, y)
  doc.text('DEPARTAMENTO / ORIGEN', 140, y)
  
  y += 5
  doc.setTextColor(...C.textMain)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(formatDate(fecha_creacion), 15, y)
  doc.text(usuario_nombre.toUpperCase(), 70, y)
  doc.text('LABORATORIO CLÍNICO', 140, y)

  y += 10

  // --- NOTAS ---
  if (nota) {
    doc.setFillColor(...C.bgLight)
    doc.setDrawColor(...C.accent)
    const splitNota = doc.splitTextToSize(nota, W - 40)
    const boxHeight = (splitNota.length * 4) + 10
    
    doc.roundedRect(15, y, W - 30, boxHeight, 1, 1, 'FD')
    doc.setTextColor(...C.primary)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('OBSERVACIONES DE REPOSICIÓN:', 20, y + 5)
    
    doc.setTextColor(...C.textMain)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(splitNota, 20, y + 10)
    
    y += boxHeight + 8
  } else {
    y += 2
  }

  // --- TABLA DE ÍTEMS ---
  autoTable(doc, {
    startY: y,
    head: [[
      '#',
      'Descripción · Identificadores',
      'Cód. Prov.',
      'Cód. Bodega',
      'Cantidad',
      'P. Neto',
      'Total Neto',
    ]],
    body: items.map((item, index) => {
      const usaPresentacion = item.presentacion_nombre && item.factor_conversion && item.cantidad_presentaciones
      const cantDisplay = usaPresentacion
        ? `${item.cantidad_presentaciones} ${(item.cantidad_presentaciones === 1 ? item.presentacion_nombre : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's'))}\n= ${Math.round(item.cantidad_sugerida)} ${item.unidad}`
        : `${Math.round(item.cantidad_sugerida)} ${item.unidad}`
      const qty = usaPresentacion ? item.cantidad_presentaciones! : item.cantidad_sugerida
      const totalLinea = item.precio_unitario ? qty * item.precio_unitario : null

      return [
        index + 1,
        item.producto_nombre,
        item.codigo_proveedor ?? '—',
        item.codigo_maestro ?? '—',
        { content: cantDisplay, styles: { fontSize: 7 } },
        item.precio_unitario ? `$${Math.round(item.precio_unitario).toLocaleString('es-CL')}` : '—',
        totalLinea ? `$${Math.round(totalLinea).toLocaleString('es-CL')}` : '—',
      ]
    }),
    theme: 'grid',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontSize: 7,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: 3,
    },
    styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 7 },
      1: { cellWidth: 60 },
      2: { halign: 'center', cellWidth: 22 },
      3: { halign: 'center', cellWidth: 22 },
      4: { halign: 'center', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 25 },
    },
    alternateRowStyles: { fillColor: C.bgLight },
  })

  // --- CAJA DE TOTALES IVA ---
  const tableEndY = (doc as any).lastAutoTable.finalY + 5
  let ty = tableEndY

  // Caja de totales (right-aligned)
  const boxX = W - 85
  doc.setFillColor(...C.bgLight)
  doc.roundedRect(boxX, ty, 70, 28, 2, 2, 'F')

  doc.setFontSize(8)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'normal')
  doc.text('Subtotal neto:', boxX + 4, ty + 7)
  doc.text('IVA 19%:', boxX + 4, ty + 14)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMain)
  doc.text(`$${Math.round(subtotal_neto).toLocaleString('es-CL')}`, W - 20, ty + 7, { align: 'right' })
  doc.text(`$${Math.round(iva).toLocaleString('es-CL')}`, W - 20, ty + 14, { align: 'right' })

  // Separator line
  doc.setDrawColor(...C.secondary)
  doc.setLineWidth(0.5)
  doc.line(boxX + 4, ty + 17, boxX + 66, ty + 17)

  doc.setFontSize(10)
  doc.setTextColor(...C.secondary)
  doc.text('Total con IVA:', boxX + 4, ty + 24)
  doc.text(`$${Math.round(total_con_iva).toLocaleString('es-CL')}`, W - 20, ty + 24, { align: 'right' })

  const finalY = ty + 33

  // --- SECCIÓN DE FIRMAS ---
  
  const signY = finalY + 15 > H - 25 ? (doc.addPage(), 40) : finalY
  
  doc.setDrawColor(...C.muted)
  doc.setLineWidth(0.2)
  
  // Línea Solicitante
  doc.line(25, signY, 85, signY)
  doc.setFontSize(7)
  doc.setTextColor(...C.textLight)
  doc.text('SOLICITADO POR (FIRMA)', 55, signY + 4, { align: 'center' })
  doc.setTextColor(...C.textMain)
  doc.setFont('helvetica', 'bold')
  doc.text(usuario_nombre.toUpperCase(), 55, signY + 8, { align: 'center' })

  // Línea Autorización
  doc.line(W - 85, signY, W - 25, signY)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'normal')
  doc.text('AUTORIZACIÓN / DIRECCIÓN', W - 55, signY + 4, { align: 'center' })
  doc.text('V°B° FINANZAS / COMPRAS', W - 55, signY + 8, { align: 'center' })

  // --- FOOTER ---
  const pageCount = (doc.internal as any).getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(...C.accent)
    doc.line(15, H - 15, W - 15, H - 15)
    doc.setFontSize(7)
    doc.setTextColor(...C.textLight)
    doc.text(`Documento generado electrónicamente por el Sistema de Gestión de Inventario.`, 15, H - 10)
    doc.text(`Página ${i} de ${pageCount}`, W - 15, H - 10, { align: 'right' })
  }

  doc.save(`SOLICITUD_${numero_documento}_${formatDate(fecha_creacion).replace(/\//g, '-')}.pdf`)
}


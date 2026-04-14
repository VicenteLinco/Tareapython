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
  logoBase64?: string | null
  monedaSimbolo?: string
  firma_solicitante_label?: string | null
}

const C = {
  primary: [15, 23, 42] as [number, number, number],
  secondary: [37, 99, 235] as [number, number, number],
  textMain: [30, 41, 59] as [number, number, number],
  textLight: [100, 116, 139] as [number, number, number],
  bgLight: [248, 250, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  accent: [241, 245, 249] as [number, number, number],
  muted: [200, 200, 200] as [number, number, number],
}

export async function exportarSolicitudPDF(options: SolicitudPdfOptions): Promise<void> {
  const {
    numero_documento, fecha_creacion, usuario_nombre, nota, items,
    nombreLaboratorio, subtotal_neto, iva, total_con_iva,
    firma_solicitante_label,
  } = options
  const sym = options.monedaSimbolo || '$'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  // --- CABECERA CORPORATIVA ---
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, W, 35, 'F')

  const hasLogo = !!(options.logoBase64 && options.logoBase64.startsWith('data:image'))
  const textX = hasLogo ? 40 : 15

  if (hasLogo) {
    try {
      doc.addImage(options.logoBase64!, 'AUTO', 10, 6, 22, 22)
    } catch (_) { /* ignore */ }
  }

  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('SOLICITUD DE COMPRA', textX, 18)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(nombreLaboratorio.toUpperCase(), textX, 25)

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
  // Márgenes 12mm → ancho útil ≈ 192mm
  // # (5) | Producto (56) | Cant. (23) | P.U.Base (26) | P.Pres. (26) | Neto (27) | IVA 19% (29)

  // Formateador que preserva decimales cuando el monto < 1 (cantidades pequeñas de IVA, etc.)
  const fmtMonto = (n: number): string => {
    if (n === 0) return `${sym}0`
    if (Number.isInteger(n)) return `${sym}${n.toLocaleString('es-CL')}`
    return `${sym}${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12 },
    head: [[
      '#',
      'Producto',
      'Cantidad',
      'Precio unitario',
      'Total neto',
    ]],
    body: items.map((item, index) => {
      const usaPresentacion = !!(item.presentacion_nombre && item.factor_conversion && item.cantidad_presentaciones)

      const baseEquiv = usaPresentacion
        ? Math.round(item.cantidad_presentaciones! * item.factor_conversion!)
        : Math.round(item.cantidad_sugerida)
      const presLabel = usaPresentacion
        ? (item.cantidad_presentaciones === 1
          ? item.presentacion_nombre!
          : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's'))
        : ''
      const cantDisplay = usaPresentacion
        ? `${item.cantidad_presentaciones} ${presLabel}\n= ${baseEquiv} ${item.unidad}`
        : `${Math.round(item.cantidad_sugerida)} ${item.unidad}`

      const precioBase = item.precio_unitario ?? 0
      const precioPres = (usaPresentacion && item.factor_conversion)
        ? precioBase * item.factor_conversion
        : null
      const qty = usaPresentacion ? item.cantidad_presentaciones! : item.cantidad_sugerida
      const precioEfectivo = precioPres ?? precioBase
      const hasPrice = item.precio_unitario != null
      const neto = hasPrice ? qty * precioEfectivo : 0

      // Una sola columna de precio: mostrar precio de presentación si aplica, si no precio base
      const precioDisplay = hasPrice
        ? fmtMonto(precioPres ?? precioBase)
        : '—'

      return [
        index + 1,
        item.producto_nombre,
        { content: cantDisplay, styles: { fontSize: 6.5 } },
        precioDisplay,
        hasPrice ? fmtMonto(neto) : '—',
      ]
    }),
    theme: 'grid',
    headStyles: {
      fillColor: C.primary,
      textColor: C.white,
      fontSize: 6.5,
      fontStyle: 'bold',
      halign: 'center',
      cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
    },
    styles: { fontSize: 7.5, cellPadding: { top: 3, right: 2, bottom: 3, left: 2 }, valign: 'middle' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 6 },
      1: { cellWidth: 80, cellPadding: { top: 3, right: 2, bottom: 3, left: 3 } },
      2: { halign: 'center', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 38 },
    },
    alternateRowStyles: { fillColor: C.bgLight },
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const item = items[data.row.index]
      if (!item) return
      if (item.codigo_proveedor || item.codigo_maestro) {
        data.cell.styles.cellPadding = { top: 3, right: 2, bottom: 11, left: 3 }
      }
    },
    didDrawCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const item = items[data.row.index]
      if (!item) return
      const codigos = [
        item.codigo_proveedor ? `Prv: ${item.codigo_proveedor}` : null,
        item.codigo_maestro   ? `Bod: ${item.codigo_maestro}`   : null,
      ].filter(Boolean).join('   ·   ')
      if (!codigos) return
      const prevSize = doc.getFontSize()
      const prevFont = doc.getFont()
      doc.setFontSize(5.5)
      doc.setTextColor(120, 130, 150)
      doc.setFont('helvetica', 'normal')
      doc.text(codigos, data.cell.x + 3, data.cell.y + data.cell.height - 3.5)
      doc.setFontSize(prevSize)
      doc.setTextColor(...C.textMain)
      doc.setFont(prevFont.fontName, prevFont.fontStyle)
    },
  })

  // --- CAJA DE TOTALES ---
  const tableEndY = (doc as any).lastAutoTable.finalY + 6
  let ty = tableEndY

  const boxX = W - 90
  doc.setFillColor(...C.bgLight)
  doc.roundedRect(boxX, ty, 75, 30, 2, 2, 'F')

  doc.setFontSize(8)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'normal')
  doc.text('Subtotal neto:', boxX + 5, ty + 8)
  doc.text('IVA 19%:', boxX + 5, ty + 16)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...C.textMain)
  doc.text(`${sym}${Math.round(subtotal_neto).toLocaleString('es-CL')}`, W - 18, ty + 8, { align: 'right' })
  doc.text(`${sym}${Math.round(iva).toLocaleString('es-CL')}`, W - 18, ty + 16, { align: 'right' })

  doc.setDrawColor(...C.secondary)
  doc.setLineWidth(0.5)
  doc.line(boxX + 5, ty + 20, boxX + 70, ty + 20)

  doc.setFontSize(10)
  doc.setTextColor(...C.secondary)
  doc.text('Total con IVA:', boxX + 5, ty + 27)
  doc.text(`${sym}${Math.round(total_con_iva).toLocaleString('es-CL')}`, W - 18, ty + 27, { align: 'right' })

  // --- SECCIÓN RESPONSABLE ---
  const firmasStartY = tableEndY + 38
  const signY = firmasStartY + 36 > H - 20
    ? (doc.addPage(), 45)
    : firmasStartY

  doc.setFillColor(...C.bgLight)
  doc.roundedRect(15, signY - 4, W - 30, 28, 2, 2, 'F')
  doc.setDrawColor(...C.muted)
  doc.setLineWidth(0.3)
  doc.roundedRect(15, signY - 4, W - 30, 28, 2, 2, 'S')

  doc.setFontSize(6.5)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'bold')
  doc.text('RESPONSABLE', W / 2, signY + 2, { align: 'center' })

  const lineY = signY + 16
  const centerX = W / 2
  doc.setDrawColor(...C.primary)
  doc.setLineWidth(0.4)
  doc.line(centerX - 50, lineY, centerX + 50, lineY)

  doc.setFontSize(6.5)
  doc.setTextColor(...C.textLight)
  doc.setFont('helvetica', 'normal')
  doc.text('GENERADO POR', centerX, lineY + 4, { align: 'center' })
  doc.setTextColor(...C.textMain)
  doc.setFont('helvetica', 'bold')
  doc.text(
    (firma_solicitante_label || usuario_nombre).toUpperCase(),
    centerX, lineY + 9, { align: 'center' }
  )

  // --- FOOTER ---
  const pageCount = (doc.internal as any).getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setDrawColor(...C.accent)
    doc.line(15, H - 15, W - 15, H - 15)
    doc.setFontSize(7)
    doc.setTextColor(...C.textLight)
    doc.setFont('helvetica', 'normal')
    doc.text('Documento generado electrónicamente por el Sistema de Gestión de Inventario.', 15, H - 10)
    doc.text(`Página ${i} de ${pageCount}`, W - 15, H - 10, { align: 'right' })
  }

  doc.save(`SOLICITUD_${numero_documento}_${formatDate(fecha_creacion).replace(/\//g, '-')}.pdf`)
}

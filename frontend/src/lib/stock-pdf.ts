import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { StockItem, Area } from '@/types'
import { daysUntil, formatDate, formatCantidad } from '@/lib/utils'
import api from '@/lib/api'

// Paleta de colores
const C = {
  navy:      [15,  23,  42]  as [number, number, number], // slate-900
  blue:      [37,  99,  235] as [number, number, number], // blue-600
  blueLight: [219, 234, 254] as [number, number, number], // blue-100
  grayDark:  [51,  65,  85]  as [number, number, number], // slate-700
  gray:      [100, 116, 139] as [number, number, number], // slate-500
  grayLight: [241, 245, 249] as [number, number, number], // slate-100
  white:     [255, 255, 255] as [number, number, number],
  red:       [220, 38,  38]  as [number, number, number], // red-600
  redLight:  [254, 226, 226] as [number, number, number], // red-100
  redDark:   [153, 27,  27]  as [number, number, number], // red-800
  amber:     [217, 119, 6]   as [number, number, number], // amber-600
  amberLight:[254, 243, 199] as [number, number, number], // amber-100
  amberDark: [120, 53,  15]  as [number, number, number], // amber-900
  green:     [21,  128, 61]  as [number, number, number], // green-700
  border:    [226, 232, 240] as [number, number, number], // slate-200
}

interface PdfOptions {
  selectedAreas: Area[]
  incluirResumen: boolean
  nombreLaboratorio: string
  logoBase64: string
  usuarioNombre: string
}

interface StockResponse {
  data: StockItem[]
  total_pages: number
}

async function fetchStockForArea(areaId: number): Promise<StockItem[]> {
  const first = await api
    .get<StockResponse>('/stock', { params: { area_id: areaId, per_page: 500, page: 1 } })
    .then((r) => r.data)

  if (first.total_pages <= 1) return first.data

  const rest = await Promise.all(
    Array.from({ length: first.total_pages - 1 }, (_, i) =>
      api
        .get<StockResponse>('/stock', { params: { area_id: areaId, per_page: 500, page: i + 2 } })
        .then((r) => r.data.data)
    )
  )
  return [...first.data, ...rest.flat()]
}

function getAlerta(item: StockItem): 'bajo' | 'vencer' | null {
  const stock = item.stock_total ?? 0
  if (stock <= item.stock_minimo) return 'bajo'
  if (item.proximo_vencimiento) {
    const d = daysUntil(item.proximo_vencimiento)
    if (d <= 30) return 'vencer'
  }
  return null
}

// Convierte hex string o data URL a base64 puro + tipo
function parseLogoBase64(raw: string): { data: string; type: 'PNG' | 'JPEG' } | null {
  if (!raw || raw.length < 50) return null
  try {
    if (raw.startsWith('data:image/png')) {
      return { data: raw.split(',')[1], type: 'PNG' }
    }
    if (raw.startsWith('data:image/jpeg') || raw.startsWith('data:image/jpg')) {
      return { data: raw.split(',')[1], type: 'JPEG' }
    }
    return null
  } catch {
    return null
  }
}

export async function exportarStockPDF(options: PdfOptions): Promise<void> {
  const { selectedAreas, incluirResumen, nombreLaboratorio, logoBase64, usuarioNombre } = options

  // Fetch data
  const stockPorArea: { area: Area; items: StockItem[] }[] = []
  for (const area of selectedAreas) {
    const items = await fetchStockForArea(area.id)
    if (items.length > 0) stockPorArea.push({ area, items })
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()   // 279.4
  const H = doc.internal.pageSize.getHeight()  // 215.9
  const now = new Date()
  const fechaStr = now.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const horaStr  = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  const logo = parseLogoBase64(logoBase64)

  // ─── HEADER ────────────────────────────────────────────────────────────────
  // Medidas
  const HEADER_H = 26
  const LOGO_BOX = 20   // cuadrado del logo
  const LOGO_X   = 8
  const LOGO_Y   = 3

  function drawHeader() {
    // Fondo blanco del header
    doc.setFillColor(...C.white)
    doc.rect(0, 0, W, HEADER_H, 'F')

    // Barra de acento izquierda
    doc.setFillColor(...C.blue)
    doc.rect(0, 0, 3, HEADER_H, 'F')

    // Caja del logo (siempre presente)
    doc.setFillColor(...C.grayLight)
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.roundedRect(LOGO_X, LOGO_Y, LOGO_BOX, LOGO_BOX, 2, 2, 'FD')

    if (logo) {
      try {
        doc.addImage(logo.data, logo.type, LOGO_X + 1, LOGO_Y + 1, LOGO_BOX - 2, LOGO_BOX - 2)
      } catch {
        // si falla, deja el cuadro vacío
      }
    } else {
      // Icono placeholder: cruz de laboratorio
      doc.setDrawColor(...C.gray)
      doc.setLineWidth(0.5)
      const cx = LOGO_X + LOGO_BOX / 2
      const cy = LOGO_Y + LOGO_BOX / 2
      doc.line(cx - 4, cy, cx + 4, cy)
      doc.line(cx, cy - 4, cx, cy + 4)
    }

    // Nombre del laboratorio
    const textX = LOGO_X + LOGO_BOX + 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...C.navy)
    doc.text(nombreLaboratorio, textX, 11)

    // Subtitulo
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.gray)
    doc.text('Reporte de Stock - Inventario', textX, 17)

    // Fecha y usuario (derecha)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.grayDark)
    doc.text(`${fechaStr}  ${horaStr}`, W - 8, 11, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(`Generado por: ${usuarioNombre}`, W - 8, 17, { align: 'right' })

    // Linea separadora sutil
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.line(0, HEADER_H, W, HEADER_H)
  }

  // ─── FOOTER ────────────────────────────────────────────────────────────────
  function drawFooter(pageNum: number) {
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.line(8, H - 8, W - 8, H - 8)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.gray)
    doc.text(nombreLaboratorio, 8, H - 4)
    doc.text(`Pagina ${pageNum}`, W - 8, H - 4, { align: 'right' })
  }

  // ─── RESUMEN EJECUTIVO ─────────────────────────────────────────────────────
  if (incluirResumen) {
    drawHeader()

    const allItems     = stockPorArea.flatMap((s) => s.items)
    const itemsBajo    = allItems.filter((i) => (i.stock_total ?? 0) <= i.stock_minimo)
    const itemsVencer  = allItems.filter((i) => {
      if (!i.proximo_vencimiento) return false
      const d = daysUntil(i.proximo_vencimiento)
      return d >= 0 && d <= 30
    })

    const MARGIN = 14
    let y = HEADER_H + 12

    // ── Encabezado del resumen ──────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...C.navy)
    doc.text('Resumen Ejecutivo', MARGIN, y)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.gray)
    doc.text(`${fechaStr}  ·  ${horaStr}`, W - MARGIN, y, { align: 'right' })

    y += 2
    doc.setDrawColor(...C.blue)
    doc.setLineWidth(0.6)
    doc.line(MARGIN, y, MARGIN + 42, y)
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.line(MARGIN + 42, y, W - MARGIN, y)

    y += 14

    // ── Métricas en línea horizontal ────────────────────────────────────────
    // 4 métricas separadas por líneas verticales, sin cajas
    const metrics = [
      { value: String(allItems.length),         label: 'Productos en stock',  color: C.navy  },
      { value: String(itemsBajo.length),         label: 'Bajo minimo',         color: C.red   },
      { value: String(itemsVencer.length),       label: 'Por vencer (30 d)',   color: C.amber },
      { value: String(selectedAreas.length),     label: 'Secciones',           color: C.gray  },
    ]

    const colW = (W - MARGIN * 2) / metrics.length

    metrics.forEach((m, i) => {
      const cx = MARGIN + i * colW + colW / 2

      // Línea divisora (no antes de la primera)
      if (i > 0) {
        doc.setDrawColor(...C.border)
        doc.setLineWidth(0.4)
        doc.line(MARGIN + i * colW, y - 10, MARGIN + i * colW, y + 8)
      }

      // Número
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(28)
      doc.setTextColor(...m.color)
      doc.text(m.value, cx, y, { align: 'center' })

      // Label
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...C.gray)
      doc.text(m.label, cx, y + 7, { align: 'center' })
    })

    y += 20

    // ── Separador de sección ────────────────────────────────────────────────
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    doc.line(MARGIN, y, W - MARGIN, y)

    y += 10

    // ── Dos columnas de alertas ─────────────────────────────────────────────
    const COL_LEFT  = MARGIN
    const COL_RIGHT = W / 2 + 4
    const COL_W     = W / 2 - MARGIN - 4

    // Título col izquierda — Bajo mínimo
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.red)
    doc.text('STOCK BAJO MINIMO', COL_LEFT, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(
      itemsBajo.length === 0 ? 'Sin alertas' : formatCantidad(itemsBajo.length, 'producto'),
      COL_LEFT + doc.getTextWidth('STOCK BAJO MINIMO') + 3,
      y
    )

    // Título col derecha — Por vencer
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.amber)
    doc.text('POR VENCER EN 30 DIAS', COL_RIGHT, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(
      itemsVencer.length === 0 ? 'Sin alertas' : formatCantidad(itemsVencer.length, 'producto'),
      COL_RIGHT + doc.getTextWidth('POR VENCER EN 30 DIAS') + 3,
      y
    )

    y += 4
    // Línea bajo títulos de columnas
    doc.setDrawColor(...C.redLight)
    doc.setLineWidth(0.4)
    doc.line(COL_LEFT, y, COL_LEFT + COL_W, y)
    doc.setDrawColor(...C.amberLight)
    doc.line(COL_RIGHT, y, COL_RIGHT + COL_W, y)

    y += 5

    // Línea vertical divisora de columnas
    doc.setDrawColor(...C.border)
    doc.setLineWidth(0.3)
    const listMaxY = H - 16
    doc.line(W / 2, y - 4, W / 2, listMaxY)

    // Filas de alertas — Bajo mínimo (izquierda)
    const MAX_ROWS = Math.floor((listMaxY - y) / 6)

    const drawAlertRow = (
      label: string,
      detail: string,
      rx: number,
      ry: number,
      isAlt: boolean,
      textColor: [number, number, number]
    ) => {
      const ROW_H = 6
      if (isAlt) {
        doc.setFillColor(...C.grayLight)
        doc.rect(rx, ry - 4.5, COL_W, ROW_H, 'F')
      }
      // Medir detail en normal (el font con que se dibuja)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      const detailW = doc.getTextWidth(detail)
      // Truncar label en bold
      doc.setFont('helvetica', 'bold')
      const maxLabelW = COL_W - detailW - 8
      let displayLabel = label
      while (doc.getTextWidth(displayLabel) > maxLabelW && displayLabel.length > 4) {
        displayLabel = displayLabel.slice(0, -1)
      }
      if (displayLabel !== label) displayLabel += '...'
      doc.setTextColor(...textColor)
      doc.text(displayLabel, rx + 2, ry)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...C.gray)
      doc.text(detail, rx + COL_W - 2, ry, { align: 'right' })
    }

    if (itemsBajo.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...C.gray)
      doc.text('Sin productos bajo minimo', COL_LEFT + COL_W / 2, y + 4, { align: 'center' })
    } else {
      itemsBajo.slice(0, MAX_ROWS).forEach((item, idx) => {
        const stock = Math.round(item.stock_total ?? 0)
        const min   = Math.round(item.stock_minimo)
        drawAlertRow(
          item.producto_nombre,
          `${formatCantidad(stock, item.unidad, item.unidad_plural)} / ${min}`,
          COL_LEFT, y + idx * 6,
          idx % 2 === 1,
          C.redDark
        )
      })
      if (itemsBajo.length > MAX_ROWS) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(6.5)
        doc.setTextColor(...C.gray)
        doc.text(`... y ${itemsBajo.length - MAX_ROWS} mas`, COL_LEFT + 2, y + MAX_ROWS * 6)
      }
    }

    if (itemsVencer.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...C.gray)
      doc.text('Sin productos por vencer', COL_RIGHT + COL_W / 2, y + 4, { align: 'center' })
    } else {
      itemsVencer.slice(0, MAX_ROWS).forEach((item, idx) => {
        const d = daysUntil(item.proximo_vencimiento!)
        const label = d === 0 ? 'hoy' : formatCantidad(d, 'día')
        drawAlertRow(
          item.producto_nombre,
          label,
          COL_RIGHT, y + idx * 6,
          idx % 2 === 1,
          C.amberDark
        )
      })
      if (itemsVencer.length > MAX_ROWS) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(6.5)
        doc.setTextColor(...C.gray)
        doc.text(`... y ${itemsVencer.length - MAX_ROWS} mas`, COL_RIGHT + 2, y + MAX_ROWS * 6)
      }
    }

    drawFooter(1)
    doc.addPage()
  }

  // ─── TABLAS POR ÁREA ───────────────────────────────────────────────────────
  // NOTA: didDrawPage dispara en TODAS las páginas incluida la primera,
  // por eso header/footer/sección se manejan SOLO desde didDrawPage.
  for (let aIdx = 0; aIdx < stockPorArea.length; aIdx++) {
    if (aIdx > 0) doc.addPage()
    const { area, items } = stockPorArea[aIdx]

    const tableBody = items.map((item) => {
      const stock = Math.round(item.stock_total ?? 0)
      const vencStr = item.proximo_vencimiento
        ? (() => {
            const d = daysUntil(item.proximo_vencimiento)
            const label = d <= 0 ? 'Vencido' : formatCantidad(d, 'día')
            return `${formatDate(item.proximo_vencimiento)} (${label})`
          })()
        : '-'
      return [
        item.producto_nombre,
        item.codigo_interno ?? '-',
        item.categoria ?? '-',
        formatCantidad(stock, item.unidad, item.unidad_plural),
        vencStr,
      ]
    })

    const alertas = items.map(getAlerta)
    let isFirstPageOfArea = true

    autoTable(doc, {
      startY: HEADER_H + 18,  // espacio para header + etiqueta de sección
      head: [['Producto', 'Codigo', 'Categoria', 'Stock', 'Prox. vencimiento']],
      body: tableBody,
      didParseCell: (data) => {
        if (data.section !== 'body') return
        const alerta = alertas[data.row.index]
        if (alerta === 'bajo') {
          data.cell.styles.fillColor = C.redLight
          data.cell.styles.textColor = C.redDark
          data.cell.styles.fontStyle = 'bold'
        } else if (alerta === 'vencer') {
          data.cell.styles.fillColor = C.amberLight
          data.cell.styles.textColor = C.amberDark
          data.cell.styles.fontStyle = 'bold'
        }
      },
      headStyles: {
        fillColor:   C.navy,
        textColor:   C.white,
        fontStyle:   'bold',
        fontSize:    8,
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      },
      bodyStyles: {
        fontSize:    7.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
        textColor:   C.grayDark,
      },
      alternateRowStyles: { fillColor: C.grayLight },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 30, font: 'courier' },
        2: { cellWidth: 38 },
        3: { cellWidth: 28, halign: 'right' },
        4: { cellWidth: 48 },
      },
      tableLineColor: C.border,
      tableLineWidth: 0.2,
      // top deja espacio para el header en páginas de continuación
      margin: { left: 8, right: 8, top: HEADER_H + 5, bottom: 12 },
      didDrawPage: () => {
        // Header siempre (única fuente de verdad)
        drawHeader()

        // Etiqueta de sección solo en la primera página de cada área
        if (isFirstPageOfArea) {
          isFirstPageOfArea = false
          const secY = HEADER_H + 10

          doc.setFont('helvetica', 'bold')
          doc.setFontSize(9)
          const pillW = Math.min(doc.getTextWidth(area.nombre) + 16, W - 50)
          doc.setFillColor(...C.blueLight)
          doc.setDrawColor(...C.blue)
          doc.setLineWidth(0.3)
          doc.roundedRect(8, secY - 5, pillW, 7, 2, 2, 'FD')
          doc.setTextColor(...C.blue)
          doc.text(area.nombre, 8 + pillW / 2, secY, { align: 'center' })

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7.5)
          doc.setTextColor(...C.gray)
          doc.text(
            formatCantidad(items.length, 'producto'),
            W - 8, secY, { align: 'right' }
          )
        }

        // Footer con número de página real
        const pageInfo = (doc.internal as unknown as { getCurrentPageInfo: () => { pageNumber: number } })
          .getCurrentPageInfo()
        drawFooter(pageInfo.pageNumber)
      },
    })
  }

  const fecha = now.toISOString().split('T')[0]
  doc.save(`stock-${fecha}.pdf`)
}

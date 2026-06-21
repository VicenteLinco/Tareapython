import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { CellHookData } from 'jspdf-autotable'
import type { StockItem, Area } from '@/types'
import { daysUntil, formatDate, formatCantidad, APP_LOCALE } from '@/lib/utils'
import { drawPdfLogo } from '@/lib/pdf-logo'
import api from '@/lib/api'

// ─── Paleta Minimal Pro ────────────────────────────────────────────────────
const C = {
  black:       [17,  24,  39]  as [number,number,number], // #111827
  grayDark:    [55,  65,  81]  as [number,number,number], // #374151
  gray:        [107, 114, 128] as [number,number,number], // #6b7280
  grayMid:     [156, 163, 175] as [number,number,number], // #9ca3af
  grayLight:   [249, 250, 251] as [number,number,number], // #f9fafb
  grayBorder:  [229, 231, 235] as [number,number,number], // #e5e7eb
  white:       [255, 255, 255] as [number,number,number],

  red:         [220,  38,  38] as [number,number,number], // #dc2626
  redLight:    [254, 242, 242] as [number,number,number], // #fef2f2
  redBorder:   [252, 165, 165] as [number,number,number], // #fca5a5
  redDark:     [185,  28,  28] as [number,number,number], // #b91c1c

  amber:       [217, 119,   6] as [number,number,number], // #d97706
  amberLight:  [255, 251, 235] as [number,number,number], // #fffbeb
  amberBorder: [252, 211,  77] as [number,number,number], // #fcd34d
  amberDark:   [180,  83,   9] as [number,number,number], // #b45309

  green:       [ 34, 197,  94] as [number,number,number], // #22c55e
  greenOk:     [ 22, 163,  74] as [number,number,number], // #16a34a
}

// ─── Interfaces ────────────────────────────────────────────────────────────
interface PdfOptions {
  selectedAreas: Area[]
  incluirResumen: boolean
  nombreLaboratorio: string
  logoBase64: string
  usuarioNombre: string
  filters?: {
    q?: string
    categoria_id?: string
    proveedor_id?: string
    stock_bajo?: boolean
  }
}

interface StockResponse {
  data: StockItem[]
  total: number
  total_pages: number
}

interface GlobalStockResponse extends StockResponse {
  resumen: {
    total_productos_con_stock: number
    productos_bajo_minimo: number
  }
}

interface GlobalAlertData {
  totalActivos: number   // todos los insumos activos (con o sin stock)
  itemsBajo: StockItem[]
  itemsPorVencer30: StockItem[]
  itemsVencidos: StockItem[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function badgeDate(d: Date): string {
  return `Stock · ${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}

function getAlerta(item: StockItem): 'bajo' | 'vencer' | null {
  const e = item.estado_alerta
  if (e === 'agotado' || e === 'critico' || e === 'reponer') return 'bajo'
  if (e === 'riesgo_venc') return 'vencer'
  if (item.proximo_vencimiento) {
    const d = daysUntil(item.proximo_vencimiento)
    if (d !== null && d >= 0 && d <= 30) return 'vencer'
  }
  return null
}

// ─── fetchGlobalResumenData ───────────────────────────────────────────────
// Obtiene datos globales para el Resumen Ejecutivo (sin filtro de área).
// - totalActivos: todos los insumos activos (stock>0 OR stock_minimo>0), igual al dashboard
// - alertas: bajo mínimo (incl. agotados), por vencer 30d, vencidos
async function fetchGlobalResumenData(filters?: PdfOptions['filters']): Promise<GlobalAlertData> {
  // Dos llamadas en paralelo:
  // 1. Sin filtro especial → total de insumos activos en el sistema
  // 2. con_alertas=true → todos los ítems que necesitan atención
  const [activosResp, alertsFirst] = await Promise.all([
    api.get<StockResponse>('/stock', { params: { ...filters, per_page: 1, page: 1 } }).then(r => r.data),
    api.get<GlobalStockResponse>('/stock', { params: { ...filters, con_alertas: true, per_page: 100, page: 1 } }).then(r => r.data),
  ])

  const allAlerts = alertsFirst.total_pages <= 1
    ? alertsFirst.data
    : [
        ...alertsFirst.data,
        ...await Promise.all(
          Array.from({ length: alertsFirst.total_pages - 1 }, (_, i) =>
            api.get<GlobalStockResponse>('/stock', {
              params: { ...filters, con_alertas: true, per_page: 100, page: i + 2 },
            }).then(r => r.data.data)
          )
        ).then(pages => pages.flat()),
      ]

  return {
    // total = todos los productos activos (igual al dashboard)
    totalActivos: activosResp.total,
    itemsBajo: allAlerts.filter(i => ['critico', 'reponer', 'agotado'].includes(i.estado_alerta ?? '')),
    itemsPorVencer30: allAlerts.filter(i => {
      if (!i.proximo_vencimiento) return false
      const d = daysUntil(i.proximo_vencimiento)
      return d !== null && d >= 0 && d <= 30
    }),
    itemsVencidos: allAlerts.filter(i => {
      if (!i.proximo_vencimiento) return false
      const d = daysUntil(i.proximo_vencimiento)
      return d !== null && d < 0
    }),
  }
}

// ─── Layout constants ──────────────────────────────────────────────────────
const HEADER_H  = 50   // altura del header en mm
const FOOTER_H  = 14   // altura del footer en mm
const MARGIN    = 18   // margen lateral
const LOGO_SIZE = 32   // diámetro del logo
const LOGO_X    = MARGIN
const LOGO_Y    = (HEADER_H - LOGO_SIZE) / 2  // centrado vertical

// ─── fetchStockForArea ─────────────────────────────────────────────────────
async function fetchStockForArea(areaId: number, filters?: PdfOptions['filters']): Promise<StockItem[]> {
  const params = {
    ...filters,
    area_id: areaId,
    per_page: 100,
    page: 1,
  }
  const first = await api.get<StockResponse>('/stock', { params }).then(r => r.data)
  const all = first.total_pages <= 1
    ? first.data
    : [
        ...first.data,
        ...await Promise.all(
          Array.from({ length: first.total_pages - 1 }, (_, i) =>
            api.get<StockResponse>('/stock', { params: { ...params, page: i + 2 } }).then(r => r.data.data)
          )
        ).then(pages => pages.flat()),
      ]
  // El endpoint /stock?area_id=X tiene un LEFT JOIN que devuelve productos con
  // stock_minimo > 0 aunque no tengan stock real en esa área. Filtrar explícitamente.
  return all.filter(i => (i.stock_total ?? 0) > 0)
}

// ─── drawHeader ───────────────────────────────────────────────────────────
function drawHeader(
  doc: jsPDF,
  W: number,
  nombreLaboratorio: string,
  logo: string,
  badgeTxt: string,
  usuarioNombre: string,
  horaStr: string
) {
  // Fondo blanco
  doc.setFillColor(...C.white)
  doc.rect(0, 0, W, HEADER_H, 'F')

  // El logo se dibuja directo sobre el header blanco, sin fondo decorativo: así
  // respeta su transparencia y su forma (redondo o cuadrado) sin recuadro feo.
  drawPdfLogo(doc, logo, {
    x: LOGO_X,
    y: LOGO_Y,
    maxW: LOGO_SIZE,
    maxH: LOGO_SIZE,
  })

  // Nombre del lab
  const textX = LOGO_X + LOGO_SIZE + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...C.black)
  doc.text(nombreLaboratorio, textX, HEADER_H / 2 - 2)

  // Subtítulo
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.grayMid)
  doc.text('Sistema de Inventario · Reporte de Stock', textX, HEADER_H / 2 + 5)

  // Badge negro (derecha)
  const badgeH = 8
  const badgePadX = 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  const bW = doc.getTextWidth(badgeTxt) + badgePadX * 2
  const bX = W - MARGIN - bW
  const bY = HEADER_H / 2 - 8
  doc.setFillColor(...C.black)
  doc.roundedRect(bX, bY, bW, badgeH, badgeH / 2, badgeH / 2, 'F')
  doc.setTextColor(...C.white)
  doc.text(badgeTxt, bX + badgePadX, bY + 5.5)

  // Meta (usuario · hora)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.grayMid)
  doc.text(`${usuarioNombre} · ${horaStr}`, W - MARGIN, HEADER_H / 2 + 5, { align: 'right' })

  // Línea divisora
  doc.setDrawColor(...C.grayBorder)
  doc.setLineWidth(0.4)
  doc.line(0, HEADER_H, W, HEADER_H)
}

// ─── drawFooterFinal ──────────────────────────────────────────────────────
function drawFooterFinal(
  doc: jsPDF,
  W: number,
  H: number,
  pageNum: number,
  totalPages: number,
  nombreLaboratorio: string
) {
  // Cubrir footer previo (si existe) con rect gris claro
  doc.setFillColor(...C.grayLight)
  doc.rect(0, H - FOOTER_H, W, FOOTER_H, 'F')

  // Línea superior del footer
  doc.setDrawColor(...C.grayBorder)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, H - FOOTER_H + 1, W - MARGIN, H - FOOTER_H + 1)

  // Texto izquierda
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C.grayMid)
  doc.text(nombreLaboratorio, MARGIN, H - 3)

  // Texto derecha
  doc.text(`Página ${pageNum} de ${totalPages}`, W - MARGIN, H - 3, { align: 'right' })
}

// ─── drawResumen ──────────────────────────────────────────────────────────
function drawResumen(
  doc: jsPDF,
  W: number,
  H: number,
  globalData: GlobalAlertData,
  selectedAreas: Area[],
  nombreLaboratorio: string,
  logo: string,
  badgeTxt: string,
  usuarioNombre: string,
  horaStr: string
) {
  drawHeader(doc, W, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr)

  const { totalActivos, itemsBajo, itemsPorVencer30: itemsVencer, itemsVencidos } = globalData

  const bodyTop = HEADER_H + 14
  let y = bodyTop

  // ── Título grande ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...C.black)
  doc.text('Resumen', MARGIN, y)
  doc.text('Ejecutivo', MARGIN, y + 14)

  // ── Scope (derecha) ────────────────────────────────────────────────────
  const scopeX = W - MARGIN
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.grayMid)
  doc.text('Inventario global', scopeX, y, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.grayDark)
  doc.text(`${selectedAreas.length} secciones incluidas`, scopeX, y + 6, { align: 'right' })
  // Lista primeras 3 áreas
  const areasLabel = selectedAreas.slice(0, 3).map(a => a.nombre).join(' · ')
    + (selectedAreas.length > 3 ? ' · …' : '')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C.grayMid)
  doc.text(areasLabel, scopeX, y + 12, { align: 'right' })

  y += 30

  // ── KPI Strip ─────────────────────────────────────────────────────────
  const kpiH   = 26
  const kpiGap = 1
  const kpiW   = (W - MARGIN * 2 - kpiGap * 3) / 4
  const kpis = [
    { val: totalActivos,         lbl: 'Insumos\nactivos',    color: C.black },
    { val: itemsBajo.length,     lbl: 'Stock\nbajo',        color: C.red   },
    { val: itemsVencer.length,   lbl: 'Por vencer\n30 días', color: C.amber },
    { val: itemsVencidos.length, lbl: 'Lotes\nvencidos',     color: C.gray  },
  ]

  // Fondo unificado gris (separador entre tarjetas)
  doc.setFillColor(...C.grayBorder)
  doc.roundedRect(MARGIN, y, W - MARGIN * 2, kpiH, 4, 4, 'F')

  kpis.forEach((kpi, i) => {
    const kx = MARGIN + i * (kpiW + kpiGap)
    const ky = y

    // Fondo blanco de la tarjeta
    doc.setFillColor(...C.white)
    if (i === 0) {
      doc.roundedRect(kx, ky, kpiW, kpiH, 4, 4, 'F')
      // Cubrir esquinas derechas
      doc.rect(kx + kpiW - 4, ky, 4, kpiH, 'F')
    } else if (i === 3) {
      doc.roundedRect(kx, ky, kpiW, kpiH, 4, 4, 'F')
      // Cubrir esquinas izquierdas
      doc.rect(kx, ky, 4, kpiH, 'F')
    } else {
      doc.rect(kx, ky, kpiW, kpiH, 'F')
    }

    const cx = kx + kpiW / 2

    // Número grande
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...kpi.color)
    doc.text(String(kpi.val), cx, ky + 13, { align: 'center' })

    // Label (puede tener salto de línea)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.grayMid)
    const lblLines = kpi.lbl.split('\n')
    lblLines.forEach((line, li) => {
      doc.text(line, cx, ky + 18 + li * 4, { align: 'center' })
    })
  })

  y += kpiH + 10

  // ── Columnas de alertas ────────────────────────────────────────────────
  const colW   = (W - MARGIN * 2 - 14) / 2
  const colL   = MARGIN
  const colR   = MARGIN + colW + 14
  const listMaxY = H - FOOTER_H - 4
  const ROW_H  = 5.5
  const MAX_ROWS = Math.floor((listMaxY - y - 12) / ROW_H)

  function drawAlertCol(
    x: number,
    titulo: string,
    count: number,
    borderColor: [number,number,number],
    dotColor: [number,number,number],
    titleColor: [number,number,number],
    valColor: [number,number,number],
    rows: { name: string; val: string }[]
  ) {
    // Encabezado de columna
    doc.setFillColor(...dotColor)
    doc.circle(x + 3, y + 1.5, 2, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...titleColor)
    doc.text(titulo, x + 8, y + 3)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...titleColor)
    const countLabel = `${count} ${count === 1 ? 'producto' : 'productos'}`
    doc.text(countLabel, x + colW, y + 3, { align: 'right' })

    // Línea bajo encabezado
    doc.setDrawColor(...borderColor)
    doc.setLineWidth(1)
    doc.line(x, y + 6, x + colW, y + 6)
    doc.setLineWidth(0.4)

    const rowsY = y + 10

    if (rows.length === 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7)
      doc.setTextColor(...C.grayMid)
      doc.text('Sin alertas activas', x + colW / 2, rowsY + 4, { align: 'center' })
      return
    }

    const visible = rows.slice(0, MAX_ROWS)
    visible.forEach((row, idx) => {
      const ry = rowsY + idx * ROW_H
      if (idx % 2 === 1) {
        doc.setFillColor(...C.grayLight)
        doc.rect(x, ry - ROW_H + 1.5, colW, ROW_H, 'F')
      }

      // Nombre (truncado)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.grayDark)
      const valW = doc.getTextWidth(row.val) + 2
      const maxNomW = colW - valW - 4
      let nombre = row.name
      doc.setFont('helvetica', 'normal')
      while (doc.getTextWidth(nombre) > maxNomW && nombre.length > 4)
        nombre = nombre.slice(0, -1)
      if (nombre !== row.name) nombre += '…'
      doc.text(nombre, x + 2, ry)

      // Valor
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...valColor)
      doc.text(row.val, x + colW - 2, ry, { align: 'right' })
    })

    if (rows.length > MAX_ROWS) {
      const restY = rowsY + MAX_ROWS * ROW_H
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(6.5)
      doc.setTextColor(...C.grayMid)
      doc.text(`… y ${rows.length - MAX_ROWS} más`, x + 2, restY)
    }
  }

  // Columna izquierda — Bajo mínimo
  drawAlertCol(
    colL, 'Stock Bajo', itemsBajo.length,
    C.redBorder, C.red, C.redDark, C.redDark,
    itemsBajo.map(i => ({
      name: i.producto_nombre,
      val:  `${formatCantidad(Math.round(i.stock_total ?? 0), i.unidad, i.unidad_plural)}${i.dias_autonomia != null ? ` · ~${i.dias_autonomia}d` : ''}`
    }))
  )

  // Columna derecha — Por vencer
  drawAlertCol(
    colR, 'Por Vencer en 30 días', itemsVencer.length,
    C.amberBorder, C.amber, C.amberDark, C.amberDark,
    itemsVencer.map(i => {
      const d = daysUntil(i.proximo_vencimiento!)
      const val = d === null ? '—' : d === 0 ? 'hoy' : `vence en ${d} ${d === 1 ? 'día' : 'días'}`
      return { name: i.producto_nombre, val }
    })
  )
}

// ─── drawAreaPage ──────────────────────────────────────────────────────────
function drawAreaPage(
  doc: jsPDF,
  W: number,
  _H: number,
  area: Area,
  items: StockItem[],
  nombreLaboratorio: string,
  logo: string,
  badgeTxt: string,
  usuarioNombre: string,
  horaStr: string
) {
  const SECTION_H = 22   // altura de la sección de título del área
  const alertas = items.map(getAlerta)

  const bajoCuenta = items.filter(i =>
    ['critico', 'reponer', 'agotado'].includes(i.estado_alerta ?? '')
  ).length
  const vencerCuenta = items.filter(i => {
    if (!i.proximo_vencimiento) return false
    const d = daysUntil(i.proximo_vencimiento)
    return d !== null && d >= 0 && d <= 30
  }).length

  const tableBody = items.map(item => {
    const stock = item.stock_total ?? 0
    const stockRound = Math.round(stock)
    const stockStr = formatCantidad(stockRound, item.unidad, item.unidad_plural)

    let vencStr = '—'
    if (item.proximo_vencimiento) {
      const d = daysUntil(item.proximo_vencimiento)
      if (d !== null && d < 0) {
        vencStr = `${formatDate(item.proximo_vencimiento)} (Vencido)`
      } else if (d !== null && d <= 30) {
        vencStr = `${formatDate(item.proximo_vencimiento)} · ${d}d`
      } else {
        vencStr = formatDate(item.proximo_vencimiento)
      }
    }

    let estadoStr = 'OK'
    const alerta = getAlerta(item)
    if (alerta === 'bajo')   estadoStr = 'Bajo'
    if (alerta === 'vencer') estadoStr = 'Vence'

    return [
      item.producto_nombre,
      item.codigo_interno ?? '—',
      item.categoria ?? '—',
      stockStr,
      vencStr,
      estadoStr,
      '',          // col 6: barra de nivel — texto vacío, se dibuja en didDrawCell
    ]
  })

  let isFirstPage = true

  autoTable(doc, {
    startY: HEADER_H + SECTION_H,
    head: [['Producto', 'Código', 'Categoría', 'Stock', 'Vencimiento', 'Estado', 'Nivel']],
    body: tableBody,

    headStyles: {
      fillColor:   C.black,
      textColor:   C.white,
      fontStyle:   'bold',
      fontSize:    6.5,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize:    7,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      textColor:   C.grayDark,
    },
    alternateRowStyles: { fillColor: C.grayLight },
    tableLineColor: C.grayBorder,
    tableLineWidth: 0.2,

    columnStyles: {
      0: { cellWidth: 'auto',  fontStyle: 'bold', textColor: C.black },
      1: { cellWidth: 24, font: 'courier', fontSize: 6.5, textColor: C.gray },
      2: { cellWidth: 28, fontSize: 6.5, textColor: C.gray },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 36, fontSize: 6.5 },
      5: { cellWidth: 20, halign: 'center', fontSize: 6.5, fontStyle: 'bold' },
      6: { cellWidth: 20, halign: 'right' },
    },

    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + SECTION_H - 2, bottom: FOOTER_H + 2 },

    didParseCell: (data) => {
      if (data.section !== 'body') return
      const alerta = alertas[data.row.index]

      if (alerta === 'bajo') {
        data.cell.styles.fillColor = C.redLight
        if (data.column.index === 3 || data.column.index === 5)
          data.cell.styles.textColor = C.redDark
      } else if (alerta === 'vencer') {
        data.cell.styles.fillColor = C.amberLight
        if (data.column.index === 4 || data.column.index === 5)
          data.cell.styles.textColor = C.amberDark
      }

      // Col 6: vaciar texto (la barra se dibuja en didDrawCell)
      if (data.column.index === 6) {
        data.cell.text = ['']
      }
    },

    didDrawCell: (data: CellHookData) => {
      if (data.section !== 'body' || data.column.index !== 6) return

      const item    = items[data.row.index]

      // Sin mínimos: el llenado de la barra refleja el estado (días de cobertura).
      const ratio = (() => {
        switch (item.estado_alerta) {
          case 'agotado':
          case 'vencido':    return 0.05
          case 'critico':    return 0.15
          case 'reponer':
          case 'riesgo_venc':
          case 'por_vencer': return 0.4
          case 'normal':     return 0.85
          default:           return 0.7 // sin_datos / no_gestionado → neutro
        }
      })()

      const BAR_W  = data.cell.width - 10
      const BAR_H  = 3.5
      const barX   = data.cell.x + 5
      const barY   = data.cell.y + (data.cell.height - BAR_H) / 2

      // Fondo de la barra
      doc.setFillColor(...C.grayBorder)
      doc.roundedRect(barX, barY, BAR_W, BAR_H, BAR_H / 2, BAR_H / 2, 'F')

      // Relleno coloreado
      const fillW = BAR_W * ratio
      if (fillW > 0.5) {
        if (ratio >= 0.6)       doc.setFillColor(...C.green)
        else if (ratio >= 0.2)  doc.setFillColor(...C.amber)
        else                    doc.setFillColor(...C.red)
        const rFill = Math.min(BAR_H / 2, fillW / 2)
        doc.roundedRect(barX, barY, fillW, BAR_H, rFill, rFill, 'F')
      }
    },

    didDrawPage: () => {
      // Header siempre
      drawHeader(doc, W, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr)

      // Sección del área
      const secY = HEADER_H + 4

      if (isFirstPage) {
        isFirstPage = false

        // Nombre del área
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        doc.setTextColor(...C.black)
        doc.text(area.nombre, MARGIN, secY + 10)

        // Mini-stats (derecha)
        const statsX = W - MARGIN
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...C.gray)
        const statsStr = `${items.length} ${items.length === 1 ? 'producto' : 'productos'}`
        doc.text(statsStr, statsX, secY + 10, { align: 'right' })

        // Pills de alerta
        if (bajoCuenta > 0 || vencerCuenta > 0) {
          let pillX = statsX - doc.getTextWidth(statsStr) - 4
          doc.setFontSize(6.5)

          if (vencerCuenta > 0) {
            const pillTxt = `${vencerCuenta} por vencer`
            const pW = doc.getTextWidth(pillTxt) + 8
            pillX -= pW + 4
            doc.setFillColor(...C.amberLight)
            doc.roundedRect(pillX, secY + 5, pW, 6.5, 2, 2, 'F')
            doc.setTextColor(...C.amberDark)
            doc.text(pillTxt, pillX + 4, secY + 9.5)
          }

          if (bajoCuenta > 0) {
            const pillTxt = `${bajoCuenta} stock bajo`
            const pW = doc.getTextWidth(pillTxt) + 8
            pillX -= pW + 4
            doc.setFillColor(...C.redLight)
            doc.roundedRect(pillX, secY + 5, pW, 6.5, 2, 2, 'F')
            doc.setTextColor(...C.redDark)
            doc.text(pillTxt, pillX + 4, secY + 9.5)
          }
        }
      } else {
        // Continuación
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...C.gray)
        doc.text(`${area.nombre} — continuación`, MARGIN, secY + 10)
      }

      // Línea divisora degradada (simulada con dos segmentos)
      doc.setDrawColor(...C.black)
      doc.setLineWidth(1.5)
      doc.line(MARGIN, secY + 14, MARGIN + 60, secY + 14)
      doc.setDrawColor(...C.grayBorder)
      doc.setLineWidth(0.4)
      doc.line(MARGIN + 60, secY + 14, W - MARGIN, secY + 14)
    },
  })
}

// ─── exportarStockPDF ──────────────────────────────────────────────────────
export async function exportarStockPDF(options: PdfOptions): Promise<void> {
  const { selectedAreas, incluirResumen, nombreLaboratorio, logoBase64, usuarioNombre, filters } = options

  // ── Fetch de datos ────────────────────────────────────────────────────────
  // Resumen global y tablas por área en paralelo
  const [globalData, ...areaResults] = await Promise.all([
    incluirResumen
      ? fetchGlobalResumenData(filters)
      : Promise.resolve(null as unknown as GlobalAlertData),
    ...selectedAreas.map(area =>
      fetchStockForArea(area.id, filters).then(items => ({ area, items }))
    ),
  ])

  const stockPorArea = areaResults.filter(r => r.items.length > 0)

  if (stockPorArea.length === 0 && !incluirResumen) {
    throw new Error('No hay datos de stock para las áreas seleccionadas')
  }

  // ── Setup del documento ───────────────────────────────────────────────────
  const doc  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const W    = doc.internal.pageSize.getWidth()   // 279.4
  const H    = doc.internal.pageSize.getHeight()  // 215.9
  const now  = new Date()
  const horaStr  = now.toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' })
  const logo     = logoBase64
  const badgeTxt = badgeDate(now)

  // ── Página 1: Resumen Ejecutivo (datos globales) ──────────────────────────
  if (incluirResumen) {
    drawResumen(doc, W, H, globalData, selectedAreas, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr)
    if (stockPorArea.length > 0) doc.addPage()
  }

  // Si no hay datos, guardar solo el resumen
  if (stockPorArea.length === 0) {
    const totalPages = doc.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p)
      drawFooterFinal(doc, W, H, p, totalPages, nombreLaboratorio)
    }
    const fecha = now.toISOString().split('T')[0]
    doc.save(`stock-inventario-${fecha}.pdf`)
    return
  }

  // ── Páginas 2..N: tablas por área ─────────────────────────────────────────
  for (let aIdx = 0; aIdx < stockPorArea.length; aIdx++) {
    if (aIdx > 0) doc.addPage()
    const { area, items } = stockPorArea[aIdx]
    drawAreaPage(doc, W, H, area, items, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr)
  }

  // ── Post-pass: footers con "Página N de T" ────────────────────────────────
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    drawFooterFinal(doc, W, H, p, totalPages, nombreLaboratorio)
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  const fecha = now.toISOString().split('T')[0]
  doc.save(`stock-inventario-${fecha}.pdf`)
}

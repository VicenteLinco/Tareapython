import jsPDF from 'jspdf'
import autoTable, { type RowInput } from 'jspdf-autotable'
import type { StockItem, Area } from '@/types'
import { daysUntil, formatDate, formatCantidad, formatPrecio, APP_LOCALE } from '@/lib/utils'
import { drawPdfLogo } from '@/lib/pdf-logo'
import {
  type RowEstado,
  esSinStock,
  esBajo,
  esPorVencer30,
  getEstado,
  ESTADO_LABEL,
} from '@/lib/stock-pdf-estado'
import api from '@/lib/api'

// ─── Paleta monocroma ───────────────────────────────────────────────────────
// Reporte completamente sobrio: solo escala de grises. El estado de cada ítem se
// comunica por tipografía (peso/tamaño), nunca por color.
const C = {
  black:       [17,  24,  39]  as [number,number,number], // #111827
  grayDark:    [55,  65,  81]  as [number,number,number], // #374151
  gray:        [107, 114, 128] as [number,number,number], // #6b7280
  grayMid:     [156, 163, 175] as [number,number,number], // #9ca3af
  grayLight:   [249, 250, 251] as [number,number,number], // #f9fafb
  grayBorder:  [229, 231, 235] as [number,number,number], // #e5e7eb
  white:       [255, 255, 255] as [number,number,number],
}

// ─── Interfaces ────────────────────────────────────────────────────────────
interface PdfOptions {
  selectedAreas: Area[]
  incluirResumen: boolean
  nombreLaboratorio: string
  logoBase64: string
  usuarioNombre: string
  monedaCodigo?: string
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
    valor_total_inventario?: number
    unidades_sin_costo?: number
    unidades_total_inventario?: number
  }
}

interface GlobalAlertData {
  totalActivos: number   // todos los insumos activos (con o sin stock)
  itemsSinStock: StockItem[]   // agotado (eje cantidad)
  itemsBajo: StockItem[]       // critico / reponer (eje cantidad)
  itemsPorVencer30: StockItem[]
  itemsVencidos: StockItem[]
  valorTotalInventario: number
  unidadesSinCosto: number
  unidadesTotal: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function badgeDate(d: Date): string {
  return `Stock · ${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`
}

// ─── fetchGlobalResumenData ───────────────────────────────────────────────
// Obtiene datos globales para el Resumen Ejecutivo (sin filtro de área).
// - totalActivos: todos los insumos activos (stock>0 OR stock_minimo>0), igual al dashboard
// - alertas: sin stock (agotado), bajo (critico/reponer), por vencer 30d, vencidos
async function fetchGlobalResumenData(filters?: PdfOptions['filters']): Promise<GlobalAlertData> {
  // Dos llamadas en paralelo:
  // 1. Sin filtro especial → total de insumos activos en el sistema
  // 2. con_alertas=true → todos los ítems que necesitan atención
  const [activosResp, alertsFirst] = await Promise.all([
    api.get<GlobalStockResponse>('/stock', { params: { ...filters, per_page: 1, page: 1 } }).then(r => r.data),
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
    valorTotalInventario: activosResp.resumen?.valor_total_inventario ?? 0,
    unidadesSinCosto: activosResp.resumen?.unidades_sin_costo ?? 0,
    unidadesTotal: activosResp.resumen?.unidades_total_inventario ?? 0,
    itemsSinStock: allAlerts.filter(esSinStock),
    itemsBajo: allAlerts.filter(esBajo),
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

  // Fecha del snapshot (derecha, texto sobrio sin recuadro)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.grayDark)
  doc.text(badgeTxt, W - MARGIN, HEADER_H / 2 - 2, { align: 'right' })

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
  horaStr: string,
  monedaCodigo: string
) {
  drawHeader(doc, W, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr)

  const {
    totalActivos,
    itemsSinStock,
    itemsBajo,
    itemsPorVencer30: itemsVencer,
    itemsVencidos,
    valorTotalInventario,
    unidadesSinCosto,
    unidadesTotal,
  } = globalData

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

  // ── KPI Strip (5 números sueltos, monocromos, sin recuadros) ─────────────
  // Sin stock y Stock bajo van separados: la acción es distinta (comprar YA vs
  // planificar compra). Peso tipográfico, nunca color.
  const kpiH = 24
  const kpiW = (W - MARGIN * 2) / 5
  const kpis: { val: number; lbl: string; color: [number,number,number] }[] = [
    { val: totalActivos,         lbl: 'Insumos activos',    color: C.black    },
    { val: itemsSinStock.length, lbl: 'Sin stock',          color: C.black    },
    { val: itemsBajo.length,     lbl: 'Stock bajo',         color: C.grayDark },
    { val: itemsVencer.length,   lbl: 'Por vencer 30 días', color: C.grayDark },
    { val: itemsVencidos.length, lbl: 'Lotes vencidos',     color: C.grayDark },
  ]

  kpis.forEach((kpi, i) => {
    const kx = MARGIN + i * kpiW

    // Separador vertical fino entre KPIs (no antes del primero)
    if (i > 0) {
      doc.setDrawColor(...C.grayBorder)
      doc.setLineWidth(0.3)
      doc.line(kx, y + 2, kx, y + kpiH - 4)
    }

    // Número grande
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...kpi.color)
    doc.text(String(kpi.val), kx + 4, y + 11)

    // Label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    doc.text(kpi.lbl, kx + 4, y + 18)
  })

  y += kpiH + 6

  // ── Valorización (fila sobria, sin banda negra) ─────────────────────────
  const valBandH = 16
  // Línea fina superior
  doc.setDrawColor(...C.grayBorder)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y, W - MARGIN, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.gray)
  doc.text('VALOR TOTAL DEL INVENTARIO', MARGIN, y + 7)

  // Cobertura de costo: qué % de las unidades no tiene costo cargado.
  const pctSinCosto = unidadesTotal > 0
    ? Math.round((unidadesSinCosto / unidadesTotal) * 100)
    : 0
  const coberturaTxt = unidadesSinCosto > 0
    ? `${pctSinCosto}% del stock sin costo cargado`
    : 'todo el stock con costo cargado'
  doc.setFontSize(6.5)
  doc.setTextColor(...C.grayMid)
  doc.text(coberturaTxt, MARGIN, y + 12)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...C.black)
  doc.text(formatPrecio(valorTotalInventario, monedaCodigo), W - MARGIN, y + 9, { align: 'right' })

  // Línea fina inferior
  doc.setDrawColor(...C.grayBorder)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y + valBandH, W - MARGIN, y + valBandH)

  y += valBandH + 8

  // ── Columnas de alertas (monocromas) ─────────────────────────────────────
  // Dos columnas físicas. Izquierda = reposición (sin stock primero, en negrita,
  // luego bajo). Derecha = por vencer. El KPI strip ya separó los conteos.
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
    rows: { name: string; val: string; bold?: boolean }[]
  ) {
    // Encabezado de columna
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...C.black)
    doc.text(titulo, x, y + 3)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.gray)
    const countLabel = `${count} ${count === 1 ? 'producto' : 'productos'}`
    doc.text(countLabel, x + colW, y + 3, { align: 'right' })

    // Línea bajo encabezado
    doc.setDrawColor(...C.black)
    doc.setLineWidth(0.6)
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

      // Nombre (truncado). Bold para los ítems sin stock (máxima urgencia).
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...C.grayDark)
      const valW = doc.getTextWidth(row.val) + 2
      const maxNomW = colW - valW - 4
      let nombre = row.name
      while (doc.getTextWidth(nombre) > maxNomW && nombre.length > 4)
        nombre = nombre.slice(0, -1)
      if (nombre !== row.name) nombre += '…'
      doc.text(nombre, x + 2, ry)

      // Valor
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...C.grayDark)
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

  // Columna izquierda — Reposición (sin stock + bajo)
  drawAlertCol(
    colL, 'Reposición', itemsSinStock.length + itemsBajo.length,
    [
      ...itemsSinStock.map(i => ({
        name: i.producto_nombre,
        val:  'sin stock',
        bold: true,
      })),
      ...itemsBajo.map(i => ({
        name: i.producto_nombre,
        val:  `${formatCantidad(Math.round(i.stock_total ?? 0), i.unidad, i.unidad_plural)}${i.dias_autonomia != null ? ` · ~${i.dias_autonomia}d` : ''}`,
      })),
    ]
  )

  // Columna derecha — Por vencer
  drawAlertCol(
    colR, 'Por vencer en 30 días', itemsVencer.length,
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
  horaStr: string,
  monedaCodigo: string
) {
  const SECTION_H = 22   // altura de la sección de título del área

  const sinStockCuenta = items.filter(esSinStock).length
  const bajoCuenta     = items.filter(esBajo).length
  const vencerCuenta   = items.filter(esPorVencer30).length

  // Valor total del área para calcular el peso (% del valor) de cada ítem.
  const totalValorArea = items.reduce((s, i) => s + (i.valor_stock ?? 0), 0)

  // Lista plana de productos: el reporte busca máxima sobriedad, sin bandas de
  // grupo por categoría ni subtotales (cero peso visual). rowMeta empareja cada
  // fila del body con su RowEstado; lo usa didParseCell para el peso tipográfico.
  const rowMeta: RowEstado[] = []
  const tableBody: RowInput[] = []

  for (const item of items) {
    const stock = item.stock_total ?? 0
    const stockRound = Math.round(stock)
    const stockStr = formatCantidad(stockRound, item.unidad, item.unidad_plural)

    // Cobertura: días de autonomía directos. Sin consumo registrado → guion.
    const cob = item.dias_autonomia
    const cobStr = cob == null ? '—' : cob <= 0 ? '0 d' : `~${cob} d`

    // Valor del stock del producto. Sin costo cargado → guion.
    const valorStr = item.valor_stock && item.valor_stock > 0
      ? formatPrecio(item.valor_stock, monedaCodigo)
      : '—'

    // Peso del ítem en el valor total del área.
    const pctValStr = totalValorArea > 0 && item.valor_stock
      ? `${Math.round((item.valor_stock / totalValorArea) * 100)}%`
      : '—'

    // % del stock que vence en la fecha más próxima. Distingue un vencimiento
    // marginal (ej. 1% del total) de uno real. Solo se anexa si el backend lo
    // informa y el vencimiento es próximo o ya ocurrió (donde el dato importa).
    const pct = item.pct_por_vencer
    const pctStr = pct != null ? ` · vence ${pct}%` : ''

    let vencStr = '—'
    if (item.proximo_vencimiento) {
      const d = daysUntil(item.proximo_vencimiento)
      if (d !== null && d < 0) {
        vencStr = `${formatDate(item.proximo_vencimiento)} (Vencido)${pctStr}`
      } else if (d !== null && d <= 30) {
        vencStr = `${formatDate(item.proximo_vencimiento)} · ${d}d${pctStr}`
      } else {
        vencStr = formatDate(item.proximo_vencimiento)
      }
    }

    // Columna Estado (texto): único canal de estado ahora que no hay color.
    const estado = getEstado(item)
    const estadoStr = estado ? ESTADO_LABEL[estado] : '—'

    tableBody.push([
      item.producto_nombre,
      item.sku || item.codigo_interno || '—',
      item.proveedor_nombre ?? '—',
      stockStr,
      cobStr,
      vencStr,
      estadoStr,
      valorStr,
      pctValStr,
    ])
    rowMeta.push(estado)
  }

  let isFirstPage = true

  autoTable(doc, {
    startY: HEADER_H + SECTION_H,
    head: [['Producto', 'Código', 'Proveedor', 'Stock', 'Cobertura', 'Vencimiento', 'Estado', 'Valor', '% del valor del área']],
    body: tableBody,

    // Grid completo estilo planilla: separadores verticales y horizontales en gris
    // claro. `linebreak` evita que las palabras se corten (parten en la línea
    // siguiente por palabra completa); `valign: middle` centra verticalmente.
    theme: 'grid',
    styles: {
      lineColor: C.grayBorder,
      lineWidth: 0.1,
      overflow:  'linebreak',
      valign:    'middle',
    },
    headStyles: {
      fillColor:   C.white,
      textColor:   C.black,
      fontStyle:   'bold',
      fontSize:    6.5,
      halign:      'center',
      valign:      'middle',
      cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
    },
    bodyStyles: {
      fontSize:    7,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      textColor:   C.grayDark,
    },

    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left',   fontStyle: 'bold', textColor: C.black },
      1: { cellWidth: 20, halign: 'center', font: 'courier', fontSize: 6.5, textColor: C.gray },
      2: { cellWidth: 28, halign: 'left',   fontSize: 6.5, textColor: C.gray },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 20, halign: 'center', fontSize: 6.5 },
      5: { cellWidth: 30, halign: 'center', fontSize: 6.5 },
      6: { cellWidth: 22, halign: 'center', fontSize: 6.5 },
      7: { cellWidth: 26, halign: 'center', fontStyle: 'bold', textColor: C.black },
      8: { cellWidth: 26, halign: 'center', fontSize: 6.5, textColor: C.gray },
    },

    margin: { left: MARGIN, right: MARGIN, top: HEADER_H + SECTION_H - 2, bottom: FOOTER_H + 2 },

    didParseCell: (data) => {
      if (data.section !== 'body') return
      const meta = rowMeta[data.row.index]

      // Monocromo: el estado se distingue solo por peso tipográfico. Los estados
      // más urgentes (sin stock / vencido) van en negrita en la columna Estado (6);
      // el resto, normal.
      if (data.column.index === 6 && (meta === 'sin_stock' || meta === 'vencido')) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = C.black
      }
    },

    didDrawCell: (data) => {
      // Encabezado sobrio: sin relleno, solo una línea inferior fina que lo separa
      // del cuerpo (cero peso visual, estilo informe serio).
      if (data.section === 'head') {
        doc.setDrawColor(...C.grayDark)
        doc.setLineWidth(0.5)
        doc.line(
          data.cell.x, data.cell.y + data.cell.height,
          data.cell.x + data.cell.width, data.cell.y + data.cell.height,
        )
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

        // Mini-stats (derecha): conteo + resumen de estados, todo sobrio en texto.
        const statsX = W - MARGIN
        const partes: string[] = []
        if (sinStockCuenta > 0) partes.push(`${sinStockCuenta} sin stock`)
        if (bajoCuenta > 0)     partes.push(`${bajoCuenta} bajo`)
        if (vencerCuenta > 0)   partes.push(`${vencerCuenta} por vencer`)
        const statsStr = `${items.length} ${items.length === 1 ? 'producto' : 'productos'}`

        if (partes.length > 0) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...C.gray)
          doc.text(partes.join('  ·  '), statsX, secY + 6, { align: 'right' })
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...C.grayDark)
        doc.text(statsStr, statsX, secY + 12, { align: 'right' })
      } else {
        // Continuación
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...C.gray)
        doc.text(`${area.nombre} — continuación`, MARGIN, secY + 10)
      }

      // Línea divisora fina bajo el título del área (gris claro, sin peso visual).
      doc.setDrawColor(...C.grayBorder)
      doc.setLineWidth(0.4)
      doc.line(MARGIN, secY + 14, W - MARGIN, secY + 14)
    },
  })
}

// ─── exportarStockPDF ──────────────────────────────────────────────────────
export async function exportarStockPDF(options: PdfOptions): Promise<void> {
  const { selectedAreas, incluirResumen, nombreLaboratorio, logoBase64, usuarioNombre, filters } = options
  const monedaCodigo = options.monedaCodigo ?? 'CLP'

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
    drawResumen(doc, W, H, globalData, selectedAreas, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr, monedaCodigo)
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
    drawAreaPage(doc, W, H, area, items, nombreLaboratorio, logo, badgeTxt, usuarioNombre, horaStr, monedaCodigo)
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

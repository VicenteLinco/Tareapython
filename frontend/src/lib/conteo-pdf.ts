import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import api from '@/lib/api'
import { formatCantidad, formatDate, formatDateTime } from '@/lib/utils'
import { toDecimal } from '@/domain/parse'
import type { ConteoDetalle, ConteoItem, PaginatedSesiones, SesionConteo } from '@/types'

interface ConteoPdfOptions {
  detalle: ConteoDetalle
  nombreLaboratorio: string
  logoBase64?: string | null
  usuarioNombre: string
}

interface ConteoGlobalPdfOptions extends ConteoPdfOptions {
  fecha: string
}

interface ConteoDetalleConNota extends ConteoDetalle {
  nota: string | null
}

interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number
  }
}

const C = {
  ink: [15, 23, 42] as [number, number, number],
  text: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [226, 232, 240] as [number, number, number],
  soft: [248, 250, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
  red: [220, 38, 38] as [number, number, number],
  blue: [37, 99, 235] as [number, number, number],
}

function sameLocalDay(a: string | Date, b: string | Date): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

function isoDateLocal(date: string | Date): string {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function diff(item: ConteoItem): number | null {
  if (item.estado_item !== 'contado' || item.cantidad_contada == null) return null
  return toDecimal(item.cantidad_contada).minus(item.stock_sistema).toNumber()
}

function resumen(items: ConteoItem[]) {
  const contados = items.filter(i => i.estado_item === 'contado')
  const noContados = items.filter(i => i.estado_item === 'no_contado')
  const diferencias = contados
    .map(i => diff(i) ?? 0)
    .filter(d => Math.abs(d) > 0.0001)

  return {
    total: items.length,
    contados: contados.length,
    noContados: noContados.length,
    ajustes: diferencias.length,
    positivos: diferencias.filter(d => d > 0).reduce((acc, d) => acc + d, 0),
    negativos: diferencias.filter(d => d < 0).reduce((acc, d) => acc + Math.abs(d), 0),
  }
}

function safeLogo(doc: jsPDF, logoBase64: string | null | undefined, x: number, y: number) {
  if (!logoBase64?.startsWith('data:image')) return
  try {
    doc.addImage(logoBase64, 'AUTO', x, y, 20, 20)
  } catch {
    // Logo invalido: se omite para no bloquear el respaldo.
  }
}

function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  nombreLaboratorio: string,
  logoBase64: string | null | undefined,
) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...C.ink)
  doc.rect(0, 0, W, 30, 'F')
  safeLogo(doc, logoBase64, 12, 5)

  doc.setTextColor(...C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, logoBase64 ? 38 : 12, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(subtitle, logoBase64 ? 38 : 12, 21)
  doc.text(nombreLaboratorio, W - 12, 13, { align: 'right' })
}

function drawFooter(doc: jsPDF, nombreLaboratorio: string) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setDrawColor(...C.line)
    doc.line(12, H - 12, W - 12, H - 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.text('Documento generado electronicamente por el Sistema de Inventario.', 12, H - 7)
    doc.text(`${nombreLaboratorio} - Pagina ${page} de ${pages}`, W - 12, H - 7, { align: 'right' })
  }
}

function kpi(doc: jsPDF, x: number, y: number, label: string, value: string, color: [number, number, number]) {
  doc.setFillColor(...C.soft)
  doc.setDrawColor(...C.line)
  doc.roundedRect(x, y, 40, 18, 2, 2, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...color)
  doc.text(value, x + 20, y + 8, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...C.muted)
  doc.text(label, x + 20, y + 14, { align: 'center' })
}

function drawSesionMeta(
  doc: jsPDF,
  detalle: ConteoDetalle,
  usuarioNombre: string,
  y: number,
) {
  const sesion = detalle.sesion
  const r = resumen(detalle.items)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...C.ink)
  doc.text(sesion.area_nombre, 12, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.text(`Sesion: ${sesion.id}`, 12, y + 6)
  doc.text(`Creada: ${formatDateTime(sesion.created_at)}`, 12, y + 11)
  doc.text(`Confirmada: ${sesion.confirmed_at ? formatDateTime(sesion.confirmed_at) : 'Pendiente'}`, 12, y + 16)
  doc.text(`Emitido por: ${usuarioNombre}`, 12, y + 21)

  kpi(doc, 130, y - 5, 'Items', String(r.total), C.ink)
  kpi(doc, 174, y - 5, 'Contados', String(r.contados), C.green)
  kpi(doc, 218, y - 5, 'Ajustes', String(r.ajustes), C.blue)
  kpi(doc, 262, y - 5, 'No contados', String(r.noContados), C.red)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.muted)
  doc.text(`Total positivo: ${formatCantidad(r.positivos, 'unidad', 'unidades')}   Total negativo: ${formatCantidad(r.negativos, 'unidad', 'unidades')}`, 130, y + 19)

  if (detalle.nota) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.text(`Nota: ${detalle.nota}`, 12, y + 28)
  }
}

function drawItemsTable(doc: jsPDF, detalle: ConteoDetalle, startY: number) {
  autoTable(doc, {
    startY,
    margin: { left: 12, right: 12, bottom: 16 },
    head: [['Producto', 'Lote', 'Vencimiento', 'Sistema', 'Contado', 'Diferencia', 'Estado']],
    body: detalle.items.map(item => {
      const d = diff(item)
      const contado = item.cantidad_contada == null
        ? '-'
        : formatCantidad(item.cantidad_contada, item.unidad_base_nombre, item.unidad_base_nombre_plural)
      const diferencia = d == null
        ? '-'
        : `${d > 0 ? '+' : ''}${formatCantidad(d, item.unidad_base_nombre, item.unidad_base_nombre_plural)}`
      return [
        item.producto_nombre,
        item.numero_lote,
        formatDate(item.fecha_vencimiento),
        formatCantidad(item.stock_sistema, item.unidad_base_nombre, item.unidad_base_nombre_plural),
        contado,
        diferencia,
        item.estado_item.replace('_', ' '),
      ]
    }),
    theme: 'grid',
    headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
    styles: { fontSize: 7, cellPadding: 2.5, valign: 'middle' },
    alternateRowStyles: { fillColor: C.soft },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold' },
      1: { cellWidth: 30 },
      2: { cellWidth: 28 },
      3: { cellWidth: 38, halign: 'right' },
      4: { cellWidth: 38, halign: 'right' },
      5: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 28, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const item = detalle.items[data.row.index]
      const d = diff(item)
      if (data.column.index === 5 && d != null) {
        data.cell.styles.textColor = d > 0 ? C.blue : d < 0 ? C.red : C.green
      }
      if (item.estado_item === 'no_contado') {
        data.cell.styles.fillColor = [255, 247, 237]
      }
    },
  })
}

function drawSignatureBlock(doc: jsPDF, y: number) {
  const W = doc.internal.pageSize.getWidth()
  const usableY = Math.min(y, doc.internal.pageSize.getHeight() - 42)
  doc.setDrawColor(...C.line)
  doc.setFillColor(...C.soft)
  doc.roundedRect(12, usableY, W - 24, 26, 2, 2, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.muted)
  doc.text('Responsable del conteo', W / 2, usableY + 7, { align: 'center' })
  doc.setDrawColor(...C.ink)
  doc.line(W / 2 - 45, usableY + 17, W / 2 + 45, usableY + 17)
  doc.text('Nombre, firma y fecha', W / 2, usableY + 22, { align: 'center' })
}

function addSesionPage(
  doc: JsPdfWithAutoTable,
  detalle: ConteoDetalle,
  options: ConteoPdfOptions,
  title: string,
  subtitle: string,
) {
  drawHeader(doc, title, subtitle, options.nombreLaboratorio, options.logoBase64)
  drawSesionMeta(doc, detalle, options.usuarioNombre, 42)
  drawItemsTable(doc, detalle, detalle.nota ? 78 : 72)
  drawSignatureBlock(doc, (doc.lastAutoTable?.finalY ?? 150) + 10)
}

export async function exportarConteoSesionPDF(options: ConteoPdfOptions): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const sesion = options.detalle.sesion
  addSesionPage(
    doc,
    options.detalle,
    options,
    'ACTA DE CONTEO DE INVENTARIO',
    `Respaldo por area - ${sesion.confirmed_at ? formatDate(sesion.confirmed_at) : formatDate(sesion.created_at)}`,
  )
  drawFooter(doc, options.nombreLaboratorio)
  const fecha = isoDateLocal(sesion.confirmed_at ?? sesion.created_at)
  doc.save(`conteo-${sesion.area_nombre}-${fecha}.pdf`)
}

async function fetchSesionesConfirmadas(): Promise<SesionConteo[]> {
  const first = await api.get<PaginatedSesiones>('/conteo', {
    params: { estado: 'confirmado', per_page: 100, page: 1 },
  }).then(r => r.data)

  if (first.total_pages <= 1) return first.data

  const rest = await Promise.all(
    Array.from({ length: first.total_pages - 1 }, (_, i) =>
      api.get<PaginatedSesiones>('/conteo', {
        params: { estado: 'confirmado', per_page: 100, page: i + 2 },
      }).then(r => r.data.data)
    )
  )
  return [first.data, ...rest].flat()
}

export async function exportarConteoGlobalDiaPDF(options: ConteoGlobalPdfOptions): Promise<void> {
  const sesiones = (await fetchSesionesConfirmadas())
    .filter(s => s.confirmed_at && sameLocalDay(s.confirmed_at, options.fecha))
    .sort((a, b) => a.area_nombre.localeCompare(b.area_nombre))

  if (sesiones.length === 0) {
    throw new Error('No hay conteos confirmados para esa fecha')
  }

  const detalles = await Promise.all(
    sesiones.map(s => api.get<ConteoDetalleConNota>(`/conteo/${s.id}`).then(r => r.data))
  )

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' }) as JsPdfWithAutoTable
  const W = doc.internal.pageSize.getWidth()
  const allItems = detalles.flatMap(d => d.items)
  const r = resumen(allItems)

  drawHeader(
    doc,
    'ACTA GLOBAL DE CONTEO',
    `Respaldo institucional - ${formatDate(options.fecha)}`,
    options.nombreLaboratorio,
    options.logoBase64,
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...C.ink)
  doc.text('Resumen global del dia', 12, 48)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...C.muted)
  doc.text(`Areas confirmadas: ${sesiones.length}`, 12, 56)
  doc.text(`Emitido por: ${options.usuarioNombre}`, 12, 62)

  kpi(doc, 96, 42, 'Items', String(r.total), C.ink)
  kpi(doc, 140, 42, 'Contados', String(r.contados), C.green)
  kpi(doc, 184, 42, 'Ajustes', String(r.ajustes), C.blue)
  kpi(doc, 228, 42, 'No contados', String(r.noContados), C.red)

  autoTable(doc, {
    startY: 76,
    margin: { left: 12, right: 12, bottom: 16 },
    head: [['Area', 'Confirmado', 'Items', 'Contados', 'Ajustes', 'Ajuste +', 'Ajuste -']],
    body: detalles.map(d => {
      const sr = resumen(d.items)
      return [
        d.sesion.area_nombre,
        d.sesion.confirmed_at ? formatDateTime(d.sesion.confirmed_at) : '-',
        sr.total,
        sr.contados,
        sr.ajustes,
        formatCantidad(sr.positivos, 'unidad', 'unidades'),
        formatCantidad(sr.negativos, 'unidad', 'unidades'),
      ]
    }),
    theme: 'grid',
    headStyles: { fillColor: C.ink, textColor: C.white, fontSize: 7 },
    styles: { fontSize: 7.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: C.soft },
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...C.muted)
  doc.text('Detalle por area en paginas siguientes.', W - 12, (doc.lastAutoTable?.finalY ?? 120) + 8, { align: 'right' })

  detalles.forEach((detalle) => {
    doc.addPage()
    addSesionPage(
      doc,
      detalle,
      options,
      'DETALLE DE CONTEO POR AREA',
      `Anexo global - ${formatDate(options.fecha)}`,
    )
  })

  drawFooter(doc, options.nombreLaboratorio)
  doc.save(`conteo-global-${isoDateLocal(options.fecha)}.pdf`)
}

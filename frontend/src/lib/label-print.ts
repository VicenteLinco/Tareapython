// frontend/src/lib/label-print.ts
import QRCode from 'qrcode'

export interface LoteParaEtiqueta {
  lote_id: string
  codigo_interno: string   // valor codificado en el QR
  numero_lote: string
  fecha_vencimiento: string
  producto_nombre: string
  presentacion_nombre?: string | null
  area_nombre: string
  cantidad_etiquetas: number  // cuántas copias imprimir
}

/**
 * Genera HTML imprimible con etiquetas 50x25mm (una por fila, repetidas según cantidad_etiquetas)
 * y dispara window.print() en un iframe oculto.
 */
export async function imprimirEtiquetas(lotes: LoteParaEtiqueta[]): Promise<void> {
  const filas: string[] = []

  for (const lote of lotes) {
    const qrDataUrl = await QRCode.toDataURL(lote.codigo_interno, {
      width: 64,
      margin: 1,
      errorCorrectionLevel: 'M',
    })

    const fechaCorta = lote.fecha_vencimiento
      // Append local midnight to prevent UTC parsing from shifting the date by one day
      ? new Date(lote.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL', {
          day: '2-digit', month: '2-digit', year: '2-digit'
        })
      : '—'

    const unidad = lote.presentacion_nombre || ''
    const nombreCorto = lote.producto_nombre.length > 28
      ? lote.producto_nombre.slice(0, 26) + '…'
      : lote.producto_nombre

    const etiquetaHtml = `
      <div class="label">
        <img class="qr" src="${qrDataUrl}" alt="QR ${lote.codigo_interno}" />
        <div class="info">
          <div class="nombre">${nombreCorto}</div>
          <div class="sub">${unidad ? unidad + ' · ' : ''}${lote.area_nombre}</div>
          <div class="lote">Lote: ${lote.numero_lote}</div>
          <div class="vence">Vence: ${fechaCorta}</div>
        </div>
      </div>`

    for (let i = 0; i < lote.cantidad_etiquetas; i++) {
      filas.push(etiquetaHtml)
    }
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @page { size: 50mm 25mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; }
  .label {
    width: 50mm; height: 25mm;
    display: flex; align-items: center; gap: 2mm;
    padding: 1.5mm; page-break-after: always;
    border: 0.3mm solid #ccc;
    overflow: hidden;
  }
  .label:last-child { page-break-after: avoid; }
  .qr { width: 18mm; height: 18mm; flex-shrink: 0; }
  .info { flex: 1; min-width: 0; }
  .nombre { font-size: 6pt; font-weight: bold; line-height: 1.2; margin-bottom: 0.5mm; }
  .sub    { font-size: 5pt; color: #555; margin-bottom: 0.5mm; white-space: nowrap; overflow: hidden; }
  .lote   { font-size: 5.5pt; font-family: monospace; }
  .vence  { font-size: 5.5pt; color: #333; }
</style>
</head>
<body>
${filas.join('\n')}
</body>
</html>`

  // Crear iframe oculto para no navegar fuera de la página
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }

  doc.open()
  doc.write(html)
  doc.close()

  // Esperar a que las imágenes QR carguen antes de imprimir
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (iframeDoc) {
    const imgs = Array.from(iframeDoc.querySelectorAll('img'))
    await Promise.all(imgs.map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>(res => img.addEventListener('load', res, { once: true }))
    ))
  }

  iframe.contentWindow?.print()

  // Limpiar después de imprimir
  setTimeout(() => document.body.removeChild(iframe), 2000)
}

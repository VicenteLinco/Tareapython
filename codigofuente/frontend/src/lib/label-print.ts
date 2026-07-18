// frontend/src/lib/label-print.ts
import QRCode from "qrcode";
import { APP_LOCALE } from "@/lib/utils";

export interface LoteParaEtiqueta {
  lote_id: string; // codificado en el QR: el consumo lo resuelve por clave primaria (sin ambigüedad)
  numero_lote: string; // se muestra como texto legible en la etiqueta
  fecha_vencimiento: string;
  producto_nombre: string;
  presentacion_nombre?: string | null;
  area_nombre: string;
  cantidad_etiquetas: number; // cuántas copias imprimir
}

export interface OpcionesImprenta {
  formato: "rollo" | "hoja";
  // Si formato es 'rollo'
  rolloTamano?: "50x25" | "40x30" | "60x40" | "80x50" | "personalizado";
  rolloAnchoCustom?: number; // mm
  rolloAltoCustom?: number; // mm

  // Si formato es 'hoja'
  hojaTamano?: "carta" | "oficio" | "a4";
  hojaDiseno?: "3x10" | "3x8" | "4x10" | "personalizado";
  hojaColumnas?: number;
  hojaFilas?: number;
  posicionInicial?: number; // 1-indexed (donde empezar a imprimir en la primera hoja)

  // General
  mostrarBordes?: boolean;

  // Márgenes avanzados para hojas (mm)
  margenY?: number; // superior/inferior
  margenX?: number; // izquierdo/derecho
  espacioX?: number; // gap horizontal
  espacioY?: number; // gap vertical
}

/**
 * Genera HTML imprimible con etiquetas según el formato (rollo o grilla de hoja)
 * y dispara window.print() en un iframe oculto.
 */
export async function imprimirEtiquetas(
  lotes: LoteParaEtiqueta[],
  opciones: OpcionesImprenta = {
    formato: "rollo",
    rolloTamano: "50x25",
    mostrarBordes: true,
  },
): Promise<void> {
  const isRollo = opciones.formato === "rollo";

  // 1. Determinar dimensiones físicas del papel y de la celda
  let paperWidth = 50;
  let paperHeight = 25;
  let cellWidth = 50;
  let cellHeight = 25;

  let sheetCols = 1;
  let sheetRows = 1;
  let mX = 0;
  let mY = 0;
  let gX = 0;
  let gY = 0;
  let skipCount = 0;

  if (isRollo) {
    const size = opciones.rolloTamano || "50x25";
    if (size === "50x25") {
      paperWidth = 50;
      paperHeight = 25;
    } else if (size === "40x30") {
      paperWidth = 40;
      paperHeight = 30;
    } else if (size === "60x40") {
      paperWidth = 60;
      paperHeight = 40;
    } else if (size === "80x50") {
      paperWidth = 80;
      paperHeight = 50;
    } else {
      paperWidth = opciones.rolloAnchoCustom || 50;
      paperHeight = opciones.rolloAltoCustom || 25;
    }
    cellWidth = paperWidth;
    cellHeight = paperHeight;
  } else {
    // Formato Hoja
    const size = opciones.hojaTamano || "carta";
    if (size === "carta") {
      paperWidth = 215.9;
      paperHeight = 279.4;
    } else if (size === "oficio") {
      paperWidth = 216;
      paperHeight = 330;
    } else if (size === "a4") {
      paperWidth = 210;
      paperHeight = 297;
    }

    const diseno = opciones.hojaDiseno || "3x10";
    if (diseno === "3x10") {
      sheetCols = 3;
      sheetRows = 10;
    } else if (diseno === "3x8") {
      sheetCols = 3;
      sheetRows = 8;
    } else if (diseno === "4x10") {
      sheetCols = 4;
      sheetRows = 10;
    } else {
      sheetCols = opciones.hojaColumnas || 3;
      sheetRows = opciones.hojaFilas || 10;
    }

    mX = opciones.margenX !== undefined ? opciones.margenX : 10;
    mY = opciones.margenY !== undefined ? opciones.margenY : 10;
    gX = opciones.espacioX !== undefined ? opciones.espacioX : 2;
    gY = opciones.espacioY !== undefined ? opciones.espacioY : 2;
    skipCount = Math.max(0, (opciones.posicionInicial || 1) - 1);

    // Calcular tamaño de celda aproximado en mm
    cellWidth = (paperWidth - 2 * mX - gX * (sheetCols - 1)) / sheetCols;
    cellHeight = (paperHeight - 2 * mY - gY * (sheetRows - 1)) / sheetRows;
  }

  // 2. Generar contenido HTML para las etiquetas
  const allLabels: string[] = [];

  for (const lote of lotes) {
    // El QR codifica el lote_id (UUID). Al escanear en consumo se resuelve por
    // clave primaria → el lote exacto, sin la ambigüedad de numero_lote (que no es
    // único entre productos).
    const qrPayload = lote.lote_id?.trim();
    if (!qrPayload) continue; // sin lote_id no hay nada que codificar; evita romper toda la tanda

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 128, // Mayor resolución para impresión nítida
      margin: 1,
      errorCorrectionLevel: "M",
    });

    const fechaCorta = lote.fecha_vencimiento
      ? new Date(lote.fecha_vencimiento + "T00:00:00").toLocaleDateString(
          APP_LOCALE,
          {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
          },
        )
      : "—";

    const unidad = lote.presentacion_nombre || "";
    // En celdas más anchas permitimos más caracteres
    const maxChars = cellWidth > 60 ? 38 : 28;
    const nombreCorto =
      lote.producto_nombre.length > maxChars
        ? lote.producto_nombre.slice(0, maxChars - 2) + "…"
        : lote.producto_nombre;

    const labelHtml = `
      <div class="label-cell">
        <img class="qr" src="${qrDataUrl}" alt="QR ${lote.numero_lote}" />
        <div class="info">
          <div class="nombre">${nombreCorto}</div>
          <div class="sub">${unidad ? unidad + " · " : ""}${lote.area_nombre}</div>
          <div class="lote">Lote: ${lote.numero_lote}</div>
          <div class="vence">Vence: ${fechaCorta}</div>
        </div>
      </div>`;

    for (let i = 0; i < lote.cantidad_etiquetas; i++) {
      allLabels.push(labelHtml);
    }
  }

  // 3. Organizar etiquetas en el diseño final (rollo vs páginas con grilla)
  let bodyContent = "";

  if (isRollo) {
    // Formato Rollo: simplemente listamos las etiquetas una tras otra
    bodyContent = allLabels.map((html) => html).join("\n");
  } else {
    // Formato Hoja: dividimos en páginas con la grilla especificada
    const pagesHtml: string[] = [];
    const slotsPerPage = sheetCols * sheetRows;
    let labelIdx = 0;
    let isFirstPage = true;

    while (labelIdx < allLabels.length) {
      const pageLabels: string[] = [];
      let startOffset = 0;

      if (isFirstPage) {
        startOffset = skipCount;
        for (let i = 0; i < startOffset; i++) {
          pageLabels.push('<div class="label-empty"></div>');
        }
        isFirstPage = false;
      }

      const remainingSlots = slotsPerPage - startOffset;
      const slice = allLabels.slice(labelIdx, labelIdx + remainingSlots);
      pageLabels.push(...slice);
      labelIdx += slice.length;

      // Rellenar con celdas vacías para mantener la cuadrícula exacta en la última página
      while (pageLabels.length < slotsPerPage) {
        pageLabels.push('<div class="label-empty"></div>');
      }

      pagesHtml.push(`
        <div class="page">
          ${pageLabels.join("\n")}
        </div>
      `);
    }
    bodyContent = pagesHtml.join("\n");
  }

  // 4. Estilos y dimensionamiento dinámico
  const qrSize = Math.min(cellWidth * 0.35, cellHeight * 0.72);
  const nombreFont = Math.min(12, Math.max(5.5, cellHeight * 0.22));
  const subFont = Math.min(10, Math.max(4.5, cellHeight * 0.18));
  const infoFont = Math.min(11, Math.max(5.0, cellHeight * 0.2));
  const showBorders = opciones.mostrarBordes ?? (isRollo ? true : false);

  const styles = `
    @page {
      size: ${paperWidth}mm ${paperHeight}mm;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Arial, sans-serif;
      background: white;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    /* Rollo */
    .label-cell {
      width: ${cellWidth}mm;
      height: ${cellHeight}mm;
      display: flex;
      align-items: center;
      gap: 2mm;
      padding: 1.5mm;
      overflow: hidden;
      background: white;
      box-sizing: border-box;
      ${isRollo ? "page-break-after: always;" : ""}
      ${showBorders ? "border: 0.25mm solid #ccc;" : "border: none;"}
    }
    ${isRollo ? ".label-cell:last-child { page-break-after: avoid; }" : ""}

    /* Hoja */
    .page {
      width: ${paperWidth}mm;
      height: ${paperHeight}mm;
      padding: ${mY}mm ${mX}mm;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(${sheetCols}, 1fr);
      grid-template-rows: repeat(${sheetRows}, 1fr);
      gap: ${gY}mm ${gX}mm;
      page-break-after: always;
      overflow: hidden;
      background: white;
    }
    .page:last-child {
      page-break-after: avoid;
    }
    .label-empty {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: transparent;
      ${showBorders ? "border: 0.15mm dashed #ddd;" : "border: none;"}
    }
    
    /* Elementos Internos */
    .qr {
      width: ${qrSize}mm;
      height: ${qrSize}mm;
      flex-shrink: 0;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .nombre {
      font-size: ${nombreFont}pt;
      font-weight: bold;
      line-height: 1.25;
      margin-bottom: 0.4mm;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sub {
      font-size: ${subFont}pt;
      color: #555;
      margin-bottom: 0.4mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lote {
      font-size: ${infoFont}pt;
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vence {
      font-size: ${infoFont}pt;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
${styles}
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;

  // Crear iframe oculto para no navegar fuera de la página
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Esperar a que las imágenes QR carguen antes de imprimir
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (iframeDoc) {
    const imgs = Array.from(iframeDoc.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) =>
              img.addEventListener("load", () => res(), { once: true }),
            ),
      ),
    );
  }

  iframe.contentWindow?.print();

  // Limpiar después de imprimir
  setTimeout(() => document.body.removeChild(iframe), 2000);
}

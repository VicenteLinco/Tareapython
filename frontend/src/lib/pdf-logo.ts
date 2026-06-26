import type jsPDF from "jspdf";

/**
 * Shared logo placement for all exportable PDFs.
 *
 * The root issue across reports was that each one stretched the logo into a
 * fixed square, distorting non-square images. This helper draws the logo
 * preserving its natural aspect ratio, centered inside a fixed box, so the
 * placement is consistent across documents regardless of the source image.
 */

export interface LogoBox {
  /** Box top-left X (mm) */
  x: number;
  /** Box top-left Y (mm) */
  y: number;
  /** Box width (mm) — the logo never exceeds this */
  maxW: number;
  /** Box height (mm) — the logo never exceeds this */
  maxH: number;
}

/** True when the value is a usable image data URL. */
export function hasValidLogo(logo?: string | null): logo is string {
  return !!logo && logo.startsWith("data:image");
}

/**
 * Draws the logo inside `box` preserving aspect ratio and centering it.
 * Returns the actual width drawn in mm (0 when no/invalid logo), so callers
 * can offset adjacent header text consistently.
 */
export function drawPdfLogo(
  doc: jsPDF,
  logo: string | null | undefined,
  box: LogoBox,
): number {
  if (!hasValidLogo(logo)) return 0;
  try {
    const props = doc.getImageProperties(logo);
    if (!props.width || !props.height) return 0;

    const ratio = props.width / props.height;
    let w = box.maxW;
    let h = w / ratio;
    if (h > box.maxH) {
      h = box.maxH;
      w = h * ratio;
    }

    const offX = box.x + (box.maxW - w) / 2;
    const offY = box.y + (box.maxH - h) / 2;
    const fmt = props.fileType || "PNG";

    doc.addImage(logo, fmt, offX, offY, w, h);
    return w;
  } catch {
    // Imagen inválida: se omite para no bloquear la exportación.
    return 0;
  }
}

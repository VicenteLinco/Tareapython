# Spec: Stock PDF Report Redesign — Minimal Pro

**Fecha:** 2026-04-06  
**Archivo a modificar:** `frontend/src/lib/stock-pdf.ts`  
**Estado:** Aprobado por usuario

---

## Objetivo

Reemplazar el generador de PDF de inventario actual (básico, sin jerarquía visual) por un reporte de nivel profesional con estilo "Minimal Pro": tipografía bold oversized, paleta monocromática con acentos de color funcional, barras de nivel de stock, y estructura clara de dos tipos de página.

---

## Estructura del PDF

### Página 1 — Resumen Ejecutivo (condicional: `incluirResumen === true`)

**Header** (50 px de alto, compartido con todas las páginas):
- Logo del laboratorio en círculo (32×32 px). Si hay `logoBase64` válido se renderiza; si no, placeholder `🔬` en círculo gris.
- Nombre del laboratorio (11 px bold) + subtítulo "Sistema de Inventario · Reporte de Stock" (7 px gray).
- Badge negro a la derecha: `"Stock · DD MMM AAAA"` (ej. `"Stock · 06 ABR 2026"`) en mayúsculas.
- Debajo del badge: `"<usuario> · HH:MM hrs"` en 7 px gray.
- Línea divisora inferior (1 px, #e5e7eb).

**Body del Resumen:**

1. **Título grande** (izquierda): "Resumen\nEjecutivo" en 20 px / weight 900 / letra-spacing −0.05em.
2. **Scope** (derecha): "Inventario global · N secciones incluidas · <lista primeras 3 áreas>…" en 7.5 px gray.
3. **KPI Strip** — 4 tarjetas unidas horizontalmente (fondo blanco, separador 1 px #e5e7eb):
   - `N Productos en stock` — color #111827
   - `N Bajo mínimo` — color #dc2626
   - `N Por vencer (30d)` — color #d97706
   - `N Lotes vencidos` — color #6b7280
   - Número: 28 px / weight 900 / letter-spacing −0.05em. Label: 6.5 px uppercase gray.
4. **Dos columnas de alertas** (flex 1:1):
   - Encabezado de columna: punto de color + título uppercase 7.5 px + contador alineado a la derecha.
   - Columna izquierda (rojo): "Stock Bajo Mínimo" — borde inferior 1.5 px #fca5a5.
   - Columna derecha (amber): "Por Vencer en 30 días" — borde inferior 1.5 px #fcd34d.
   - Filas: nombre del producto (truncado con ellipsis) + valor alineado a la derecha (ej. `"3 / 20 tubos"` o `"vence en 12 días"`).
   - Si hay más de `MAX_ROWS`: nota italic `"... y N más"`.
   - Si no hay alertas: texto italic centrado `"Sin productos bajo mínimo"`.

**Footer** (14 px, compartido): Nombre del lab (izquierda) + `"Página N de T"` (derecha).

---

### Páginas 2..N — Tabla por Área

Una página (o más si se necesita continuación) por cada área con stock (`items.length > 0`).

**Header:** Idéntico al de la página de resumen.

**Encabezado de sección** (8 px de alto, inmediatamente bajo el header):
- Nombre del área en 14 px / weight 900 / letter-spacing −0.04em.
- A la derecha: mini-stats en 7 px — `"N productos"`, pill rojo `"N bajo mínimo"` (solo si > 0), pill amber `"N por vencer"` (solo si > 0).
- Línea degradada bajo el encabezado: `linear(#111827 → #e5e7eb → transparent)`, 2 px.

**Tabla de stock** — columnas:

| # | Columna | Ancho | Notas |
|---|---------|-------|-------|
| 0 | Producto | auto | Negrita 7 px, color #111827 |
| 1 | Código | 26 mm | Monospace 6.5 px, color #6b7280 |
| 2 | Categoría | 30 mm | 6.5 px, color #6b7280 |
| 3 | Stock | 24 mm | Bold, align right. Color rojo si alerta `bajo`, normal si OK |
| 4 | Vencimiento | 36 mm | `DD/MM/AAAA · Nd` si < 30d (amber bold); `—` si sin fecha |
| 5 | Estado | 20 mm | Centro. Chips: `⬇ Bajo` (rojo), `⚠ Vence` (amber), `✓ OK` (verde) |
| 6 | Nivel | 22 mm | Barra horizontal 4 px × 36 mm. Color: verde ≥ 60%, amber 20–59%, rojo < 20% |

**Head styles:** fondo #111827, texto blanco, 6.5 px uppercase, padding 4/6 px.  
**Body styles:** 7 px, padding 3.5/6 px, texto #374151.  
**Filas alternas:** fondo #f9fafb.  
**Fila alerta `bajo`:** fondo #fef2f2.  
**Fila alerta `vencer`:** fondo #fffbeb.  
**Continuación:** última fila del bloque si hay más páginas → `"— Continuación en siguiente página · N productos más —"` en gris italic centrado.

**Cálculo del nivel (barra):**
- `ratio = stock_total / (stock_minimo * 3)` clampeado a [0, 1].
- Si `stock_minimo === 0`: ratio = 0.7 (sin mínimo configurado → neutral).
- Verde si ratio ≥ 0.6, amber si 0.2–0.59, rojo si < 0.2.

**Footer:** Idéntico al de la página de resumen.

---

## Paleta de colores

```ts
const C = {
  // Base
  black:      [17,  24,  39],   // #111827
  grayDark:   [55,  65,  81],   // #374151
  gray:       [107, 114, 128],  // #6b7280
  grayMid:    [156, 163, 175],  // #9ca3af
  grayLight:  [249, 250, 251],  // #f9fafb
  grayBorder: [229, 231, 235],  // #e5e7eb
  white:      [255, 255, 255],

  // Alertas
  red:        [220,  38,  38],  // #dc2626
  redLight:   [254, 242, 242],  // #fef2f2
  redBorder:  [252, 165, 165],  // #fca5a5
  redDark:    [185,  28,  28],  // #b91c1c

  amber:      [217, 119,   6],  // #d97706
  amberLight: [255, 251, 235],  // #fffbeb
  amberBorder:[252, 211,  77],  // #fcd34d
  amberDark:  [180,  83,   9],  // #b45309

  green:      [ 34, 197,  94],  // #22c55e
  greenOk:    [ 22, 163,  74],  // #16a34a
}
```

---

## Función `getAlerta` (revisada)

```ts
function getAlerta(item: StockItem): 'bajo' | 'vencer' | null {
  const stock = item.stock_total ?? 0
  if (stock <= 0 || stock < item.stock_minimo) return 'bajo'   // incluye agotado
  if (item.proximo_vencimiento) {
    const d = daysUntil(item.proximo_vencimiento)
    if (d !== null && d <= 30) return 'vencer'
  }
  return null
}
```

---

## Logo

- `parseLogoBase64(raw)` ya existe y funciona — mantener sin cambios.
- En el header: círculo 32×32 con `border-radius` simulado via `roundedRect` con radio grande.
- Si no hay logo: placeholder gris con texto "🔬" dibujado via `doc.text`.

---

## Tamaño de página y márgenes

- Orientación: landscape, formato letter (279.4 × 215.9 mm).
- Márgenes tabla: `{ left: 8, right: 8, top: HEADER_H + seccion_H + 2, bottom: 14 }`.
- `HEADER_H = 50`, `SECTION_H = 22`.

---

## Nombre del archivo generado

`stock-inventario-YYYY-MM-DD.pdf` (ej. `stock-inventario-2026-04-06.pdf`).

---

## Lo que NO cambia

- `fetchStockForArea` (ya corregido con `per_page: 100`).
- Lógica de paginación multi-página por área.
- `PdfOptions` interface.
- Manejo de `stockPorArea.length === 0`.
- `parseLogoBase64`.

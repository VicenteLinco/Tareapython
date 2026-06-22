# Pendientes 3 — Rediseño de flujos y UX (compras, conteo, exportables, navegación)

Tercera tanda. El foco fueron **rediseños de flujo y UX** sobre módulos en uso.
Casi todo está cerrado; lo que queda abajo es lo único abierto (depende de una
revisión visual del usuario). Los ítems completados se borraron por convención
(su registro vive en engram + git history).

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
Donde hubo análisis previo se deja la **causa raíz** y la **evidencia** (archivo:línea).

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | Exportable de inventario — revisión visual del logo PNG transparente (resto ✅) | Exportación PDF | 🟡 Media |

---

## 1. Exportable de inventario — rediseño de contenido y logo con transparencia
**Prioridad:** 🟡 Media · **Área:** Exportación PDF

**Problema**
- El PDF exportable de inventario "se ve feo" y no presenta bien la información.
- El logo no carga correctamente: si la imagen es redonda o cuadrada, queda con un fondo
  feo (cuadro opaco alrededor). No respeta transparencia.

**Resultado esperado**
- El exportable de inventario tiene una composición clara y legible (jerarquía visual,
  agrupación de columnas, totales) que comunique bien la información.
- El logo se renderiza respetando transparencia (PNG con alpha) y se adapta a logos
  redondos o cuadrados sin recuadro de fondo.

**Evidencia / contexto**
- Helper de logo existente: `frontend/src/lib/pdf-logo.ts` (`drawPdfLogo`) — ya preserva
  aspect ratio, pero hay que verificar el manejo de transparencia/fondo.
- Generación del PDF de stock: `frontend/src/lib/stock-pdf.ts`.
- Relacionado con `PENDIENTES.md` #4 (formato del logo en PDF, cerrado) — esto es la
  **iteración siguiente**: transparencia + rediseño de contenido, no solo posición.

**Decisión (2026-06-20)**
- **Logo:** causa raíz = un círculo decorativo gris (`stock-pdf.ts` drawHeader) dibujado
  detrás del logo. **Resuelto:** se quitó el círculo; el logo se dibuja directo sobre el
  header blanco usando todo el box, respetando transparencia y forma (redondo/cuadrado).
- **Dirección del rediseño:** opción **C — Híbrido** (resumen ejecutivo mejorado + listado
  por área legible).
- **Valorización ($ total):** NO factible sin backend — `StockItem` (`types/index.ts:59`)
  no trae costo y `/stock` no lo devuelve. Queda como sub-tarea con backend.
- **Datos disponibles para enriquecer el listado:** `dias_autonomia` (cobertura),
  `proveedor_nombre`, `lotes_count`, `pct_por_vencer`, `categoria`. Columnas actuales:
  Producto, Código, Categoría, Stock, Vencimiento, Estado, Nivel (barra).

**Criterios de aceptación**
- [x] El logo respeta transparencia/forma (sin recuadro opaco) — círculo de fondo eliminado.
- [ ] Revisión visual sobre un logo PNG transparente real (requiere render — pendiente del usuario).
- [x] Afinar el listado → columna **Valor** por producto (moneda configurada; "—" si el lote no tiene costo).
- [x] Mejorar estética del resumen ejecutivo → banda **Valor total del inventario** + "% del stock sin costo".
- [x] (Backend) Exponer costo en `/stock` para la valorización del inventario.
      → Decisión: **costo por lote**. `/stock` ahora devuelve `valor_stock` por ítem y
        `valor_total_inventario` + `unidades_sin_costo` en el resumen. Costo base del lote =
        `COALESCE(lotes.costo_unitario, precio_unitario/factor de la última recepción)`.
        Hallazgo: la UI de recepción puebla `recepcion_detalle.precio_unitario` (por
        presentación), no `lotes.costo_unitario`; por eso el COALESCE + `/factor`.
        Tests: `stock_test::test_listar_valoriza_stock_por_costo_de_lote` +
        `test_listar_stock_sin_costo_se_informa`.


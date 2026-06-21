# Pendientes 3 — Rediseño de flujos y UX (compras, conteo, exportables, navegación)

Tercera tanda. A diferencia de la tanda 2 (auditoría de patrones), acá el foco son
**rediseños de flujo y UX** pedidos sobre módulos en uso: exportable de inventario,
catálogo de productos, solicitudes de compra, órdenes/guías, conteo y el menú lateral.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
Donde hubo análisis previo se deja la **causa raíz** y la **evidencia** (archivo:línea).
La prioridad es una sugerencia de orden, no un compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | Exportable de inventario — rediseño de contenido + logo con transparencia/adaptativo | Exportación PDF | 🟡 Media |
| 2 | Quitar el precio del creador de productos; capturarlo en solicitud/recepción | Catálogo / Compras | 🔴 Alta |
| 3 | Rediseño del flujo de solicitudes-compra por pasos + validación de proveedor | Compras / UX | 🔴 Alta |
| 4 | Órdenes de compra vs. guías de despacho — decidir nomenclatura y tabs | Compras | 🟡 Media |
| 5 | Conteo — botón visible, escaneo opcional y estados por color | Conteo / UX | 🟡 Media |
| 6 | Menú lateral de admin — jerarquía y agrupación de funciones | Navegación / UX | 🟢 Baja |

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
- [ ] Revisión visual sobre un logo PNG transparente real (requiere render).
- [ ] Afinar el listado (cobertura en días, legibilidad) — iterar con el PDF a la vista.
- [ ] Mejorar estética del resumen ejecutivo — iterar con el PDF a la vista.
- [ ] (Backend) Exponer costo en `/stock` para la valorización del inventario.

---

## 2. Quitar el precio del creador de productos y capturarlo en solicitud/recepción
**Prioridad:** 🔴 Alta · **Área:** Catálogo / Compras

**Problema**
- Hoy el precio se carga en el **catálogo** (creador de productos). El precio cambia
  seguido, así que tenerlo en el catálogo lo deja desactualizado.
- El precio relevante es el del **momento de la compra**, no el del catálogo.

**Resultado esperado**
- El creador de productos deja de pedir/mostrar el precio como dato del catálogo.
- El precio se ingresa al momento de hacer la **solicitud de compra** y/o la **recepción**,
  y ambos módulos se mantienen coherentes entre sí (el precio fluye de uno a otro:
  el de la solicitud propone el de la recepción, y la recepción puede ajustarlo).

**Evidencia / contexto**
- Campo de precio en catálogo: `frontend/src/pages/creador-productos/productos-tab.tsx`
  (`precio_unidad`, formulario en `:1135` "Precio por unidad").
- Ya existe historial de precios: `PrecioHistorialItem` en el mismo archivo (`:110`) — hay
  base para tratar el precio como dato temporal de compra, no de catálogo.
- Las solicitudes/órdenes ya manejan `precio_unitario` por ítem
  (`backend/src/handlers/ordenes_compra.rs`, `CreateOCItem.precio_unitario`).

**Decisión (2026-06-20)**
- El precio es dato de **transacción**, no de catálogo. `precio_unidad` deja de ser campo de
  alta editable y pasa a ser **"último precio conocido"** (cache de solo lectura, derivada de
  la última recepción del producto).
- En **solicitud Y recepción** el precio por línea **autocompleta con el último precio
  conocido** y es **editable**. Si se ajusta en la recepción, ese pasa a ser el nuevo último
  precio (ambos módulos sincronizados).
- **Hallazgo clave (revisa el plan):** el backend YA deriva el "último precio" con una
  subquery — `COALESCE(up.precio_unitario, p.precio_unidad) AS precio_ultimo`
  (`solicitudes_compra.rs:491-525`): toma `recepcion_detalle.precio_unitario` de la última
  recepción y cae a `productos.precio_unidad` solo si nunca se recibió. Por eso **NO hay que
  tocar el flujo transaccional de recepción** para "actualizar precio".
- El cambio real es menor: (a) sacar `precio_unidad` del alta del catálogo, (b) que
  `handleAddFromSearch` (`useSolicitudState.ts:428`) use `precio_ultimo` en vez de
  `p.precio_unidad` crudo — hoy es inconsistente con las recomendaciones que ya usan precio_ultimo.

**Criterios de aceptación**
- [x] Decidir el destino de `precio_unidad` → precio semilla opcional; el "último precio" real
      sale de `recepcion_detalle` vía la subquery existente (una sola fuente de verdad).
- [x] El formulario del creador de productos ya no pide precio como dato de alta
      (`productos-tab.tsx`: input → display de solo lectura).
- [x] El endpoint `horizonte` expone `precio_ultimo` (`solicitudes_compra.rs`) y
      `handleAddFromSearch` lo usa con fallback al catálogo (`useSolicitudState.ts:428`).
- [x] El precio por línea es editable en la **solicitud** (input en `pedido-panel.tsx`).
      Falta verificar/agregar el mismo input en el form de **recepción** (el DTO ya acepta
      `precio_unitario`).
- [x] ~~La recepción actualiza el precio al confirmar~~ → innecesario (la subquery ya lo deriva).
- [ ] Productos sin historial de recepción arrancan con precio vacío (se carga a mano la 1ª vez).

**Test (Strict TDD) — bloqueado por deuda del harness**
- Test escrito (`solicitudes_test.rs::horizonte_devuelve_ultimo_precio_de_recepcion`) pero
  `#[ignore]`: el harness de `#[sqlx::test]` solo aplica migraciones, no siembra datos base
  (unidades/áreas), así que `POST /productos` da 422. Arreglados de paso 2 bugs preexistentes
  del harness (`common/mod.rs`: `test_config` sin campos nuevos; `ensure_test_admin` con
  `ON CONFLICT (email)` incompatible con el unique parcial del soft-delete). Falta el seed de
  datos base para desbloquear toda la suite — decisión pendiente con el usuario.

---

## 3. Rediseño del flujo de solicitudes-compra por pasos + validación de proveedor
**Prioridad:** 🔴 Alta · **Área:** Compras / UX

**Problema**
- El flujo actual de `/solicitudes-compra` es confuso. El botón "Nueva +" no aporta al
  flujo real y debe eliminarse.
- El usuario quiere un flujo por pasos explícito:
  1. Paso 1: elegir el modo de armado — **sugeridos** (forecast/recomendaciones) o
     **por proveedor**.
  2. Paso 2: seleccionar **uno o más proveedores**.
  3. Paso 3: buscador de productos donde se cargan ítems y se **puede ajustar el precio**
     en ese mismo momento (ver pendiente #2).
- Además, aparece un error de validación al guardar que no queda claro para el usuario.

**Causa raíz de la validación (analizada)**
- El error es **"Todos los items deben tener proveedor asignado"**. Se dispara al guardar
  una solicitud si algún producto del detalle tiene `productos.proveedor_id IS NULL`.
- Evidencia: `backend/src/handlers/solicitudes_compra.rs:681-694` (cuenta ítems cuyo
  producto no tiene proveedor en catálogo y rechaza con `AppError::Validation`).
- **Tensión de modelo a resolver:** hoy el proveedor está atado al **producto en el
  catálogo** (un proveedor por producto, `productos.proveedor_id`). El flujo deseado
  ("elegir proveedores y después cargar productos") asume que el proveedor se elige en la
  solicitud. Hay que decidir si el proveedor sigue derivándose del producto o pasa a ser
  una elección del paso 2. Esto condiciona TODO el rediseño del flujo.

**Resultado esperado**
- Flujo por pasos claro (modo → proveedores → productos+precio), sin el botón "Nueva +".
- La regla de validación de proveedor se vuelve coherente con el nuevo flujo (o se explica
  al usuario de forma accionable en vez de un mensaje genérico al final).

**Decisión (2026-06-20)**
- **Hallazgo clave:** el flujo deseado YA existe como estados (modo Sugeridos/Por proveedor →
  galería de proveedores con selección múltiple + "Continuar" → buscador). No hay que
  construirlo, hay que **hacerlo visible** y limpiar la entrada.
- **Presentación:** opción A — **stepper visible** (1 Modo · 2 Proveedores · 3 Productos ·
  4 Revisar) ENCIMA del flujo actual, reutilizando las pantallas existentes. NO wizard de
  pantallas separadas (el proyecto ya abandonó el wizard en recepciones, PENDIENTES2 #10).
- **Botón "Nueva":** se elimina (es un tab confuso). Crear es el estado por defecto al entrar;
  "Historial" pasa a botón/link secundario, no un tab que compite con "Nueva".
- **Validación de proveedor:** el error `proveedor_id == null` se avisa **al agregar** el
  producto (inline), no como error genérico al guardar. El proveedor sigue viviendo en el
  producto (catálogo); no se mueve a la línea.

**Evidencia**
- Botón "Nueva +": `frontend/src/pages/solicitudes-compra/index.tsx:66`.
- Componentes existentes del módulo (a reaprovechar/reordenar):
  `solicitudes-compra/components/` (`solicitud-buscador.tsx`, `pedido-panel.tsx`,
  `revision-view.tsx`, `proveedor-banner.tsx`, `quiebres-panel.tsx`, `horizonte-chips.tsx`).
- Validación backend: `backend/src/handlers/solicitudes_compra.rs:681-694`.

**Criterios de aceptación**
- [x] **Decisión de modelo:** el proveedor se **deriva del producto** (catálogo); no se mueve
      a la línea de solicitud. La selección de proveedores del paso 2 actúa como filtro.
- [x] Eliminar el botón "Nueva +" → reemplazado por stepper; "Historial" es botón secundario
      (`index.tsx`).
- [x] Flujo por pasos visible → `components/solicitud-stepper.tsx` (3 pasos adaptativo:
      paso 2 "no aplica" en Sugeridos). Typecheck verde.
- [x] El precio se edita en el paso de carga de productos → input editable por línea en
      `pedido-panel.tsx` (edita por presentación, guarda por unidad base) + `handleUpdatePrecio`.
- [x] La validación de proveedor se avisa en línea al agregar → `notify.warning` en
      `handleAddFromSearch` cuando el producto no tiene proveedor (no bloquea).

---

## 4. Órdenes de compra vs. guías de despacho — decidir nomenclatura y tabs
**Prioridad:** 🟡 Media · **Área:** Compras

**Qué hace hoy `/ordenes-compra` (analizado)**
- La página tiene **dos tabs** (`frontend/src/pages/ordenes-compra/index.tsx:16`):
  - **Órdenes de compra (OC):** documento formal de pedido a un proveedor, generado a partir
    de una solicitud aprobada. Registra ítems, cantidad, `precio_unitario`, fecha de entrega
    esperada y estado. Backend: `backend/src/handlers/ordenes_compra.rs`.
  - **Guías respaldadas:** son **recepciones que tienen foto adjunta** (la guía de despacho
    física fotografiada). No es una entidad nueva: filtra `/recepciones?solo_con_foto=true`.
- O sea: la OC es el documento que se **envía** al proveedor (antes de recibir); la guía
  respaldada es el comprobante de lo que **se recibió**.

**Problema**
- El usuario siente que el módulo debería llamarse "guías de despacho respaldadas" y que el
  tab de "órdenes de compra" se elimine, porque cree que solo necesita las guías.

**Resultado esperado**
- Decisión informada: o (a) el laboratorio sí emite OC formales al proveedor → se mantiene
  el tab pero se mejora; o (b) en la práctica no se usan OC formales (el pedido vive en la
  solicitud y lo que importa es la recepción con guía) → se elimina el tab de OC y la página
  pasa a llamarse "Guías de despacho".

**Evidencia**
- Tabs y queries: `frontend/src/pages/ordenes-compra/index.tsx` (`tabActivo: 'ordenes' | 'guias'`).
- Backend OC: `backend/src/handlers/ordenes_compra.rs`.
- Guías = recepciones con foto: query a `/recepciones` con `solo_con_foto: true`.

**Decisión del usuario (2026-06-20)**
- El lab **no emite/corre órdenes de compra formales**. Aun así, **NO se elimina** el tab ni
  la lógica de OC (sin tocar backend/handler) — **solo se renombra** lo visible. Cambio
  cosmético de etiqueta, sin riesgo sobre la funcionalidad existente.

**Criterios de aceptación**
- [x] Confirmar si el lab emite órdenes de compra formales → **No**.
- [x] Renombrar la etiqueta visible → **"Guías de Despacho Respaldadas"** en menú lateral
      (`sidebar.tsx:75`) y título de página (`ordenes-compra/index.tsx:87`).
- [x] NO tocar el handler/endpoint ni la lógica de OC → intactos (solo strings de UI).
- [x] Tab interno renombrado a **"Solicitudes de Compra Respaldadas"** (`index.tsx:98`).
      ⚠️ Advertido al usuario: choca de nombre con el módulo "Solicitudes" (`sidebar.tsx:62`) y
      el contenido son órdenes (entidad distinta, con "Solicitud origen"). El usuario eligió este
      nombre igual. Si más adelante confunde, evaluar "Compras Respaldadas" o "Pedidos a Proveedor".

---

## 5. Conteo — botón visible, escaneo opcional y estados por color
**Prioridad:** 🟡 Media · **Área:** Conteo / UX

**Problema**
- El botón de "nuevo conteo" es poco visible y queda abajo. Debe ser prominente, arriba y
  con texto explícito.
- El flujo de conteo es lento ingresando cantidades a mano; falta una vía de **escaneo
  opcional** para acelerar (sin volverlo obligatorio).
- Faltan señales visuales por ítem que comuniquen el estado de un vistazo:
  - ítem ya contado / listo → un color
  - ítem con **ajuste negativo** → otro color
  - ítem **pendiente** → amarillo

**Resultado esperado**
- Botón de nueva sesión de conteo prominente, arriba, con texto.
- Escaneo opcional integrado al flujo de conteo para acelerar la carga (coexiste con la
  entrada manual; ver el patrón de `modo-qr/` y `kiosk/`).
- Cada ítem muestra su estado con color: listo, ajuste negativo y pendiente (amarillo)
  claramente diferenciados.

**Evidencia / contexto**
- Página de conteo: `frontend/src/pages/conteo/index.tsx` (atajo "Nueva sesión" en `:89`;
  ubicar y reposicionar el botón real).
- Detalle de sesión: `frontend/src/pages/conteo/detalle.tsx` (donde viven los ítems y donde
  irían los estados por color y el escaneo).
- Lectura de QR/HID ya existe en el proyecto: `frontend/src/pages/modo-qr/`, `kiosk/`,
  `html5-qrcode` — reaprovechar.

**Decisión (2026-06-20)**
- **Hallazgo:** gran parte ya existía. El botón era un FAB flotante abajo-derecha con solo
  `+` (`index.tsx:227`); los colores por estado ya vivían en `LoteRow` (`detalle.tsx:501`).
- **Botón:** se elimina el FAB; botón prominente con texto "Nueva sesión" en el header
  (`index.tsx`, junto a `KeyboardLegend`).
- **Colores (opción elegida):** pendiente (sin contar) = **amarillo**; contado con ajuste
  negativo (`diferencia < 0`) = **rojo**; contado OK/positivo = **verde**; "no encontrado"
  = **gris** (antes amarillo — se reasignó para liberar el amarillo a "pendiente").
- **Alcance:** los colores aplican a la **lista desktop** (`LoteRow`). La vista móvil es
  un ítem a la vez (wizard), no lista, así que conserva su estilo secuencial actual.
- **Escaneo (B) — decidido e implementado:** híbrido por viewport (`device-mode.ts` es un
  stub inútil; se usa el `isMobile = innerWidth < 768` que ya vivía en `detalle.tsx`, que
  además coincide con qué vista se muestra). **Desktop/lista → lector HID** (input enfocado);
  **móvil/card → cámara** (`QrScanner` reutilizado). Comportamiento: el escaneo **salta y
  enfoca** (no suma +1). Match 100% client-side (`scan-utils.ts`): 1º por `numero_lote`, 2º
  por `codigo_barras`/`gtin` de presentación → producto. `ConteoItem` no trae código de
  barras, pero el array `presentaciones` de la sesión sí.

**Criterios de aceptación**
- [x] Botón de nueva sesión: prominente, arriba, con texto (no flotante inferior).
- [x] Modo escaneo opcional, sin reemplazar la entrada manual → toggle "Escanear" en el
      detalle. Desktop: input HID (Enter en la cantidad devuelve el foco al escáner). Móvil:
      overlay de cámara que salta a la card del ítem escaneado. Lo no matcheado avisa con
      `notify.warning` y no bloquea.
- [x] Estados por ítem con color: listo (verde), ajuste negativo (rojo), pendiente (amarillo),
      no encontrado (gris) — en la lista desktop (`LoteRow`).
- [x] Definir qué cuenta como "ajuste negativo" → `diferencia = contada - stock_sistema < 0`.

---

## 6. Menú lateral de admin — jerarquía y agrupación de funciones
**Prioridad:** 🟢 Baja · **Área:** Navegación / UX

**Problema**
- El menú lateral de administración tiene muchas funciones al mismo nivel. Conviene
  agrupar algunas dentro de otras o darles jerarquía para reducir la carga visual.

**Resultado esperado**
- El menú lateral organiza las funciones en grupos/jerarquías coherentes (por dominio:
  catálogo, compras, stock, administración), en vez de una lista plana.

**Evidencia**
- `frontend/src/components/layout/sidebar.tsx` — definición de los ítems del menú.

**Criterios de aceptación**
- [ ] Definir la agrupación (qué entra en qué grupo y la jerarquía).
- [ ] Implementar grupos/colapsables en el sidebar respetando roles (admin/tecnologo/consulta).
- [ ] Revisión: el menú queda más corto y navegable sin perder accesos.

> Es un pendiente de diseño: antes de implementar conviene presentar 2–3 propuestas de
> agrupación y elegir una (regla de "design questions before code").

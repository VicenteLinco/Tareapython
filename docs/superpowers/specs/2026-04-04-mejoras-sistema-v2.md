# Mejoras Sistema V2 — Spec

## Objetivo

Corregir 6 bugs y entregar mejoras de UX en 6 módulos del sistema de inventario de laboratorio clínico.

---

## 1. Bugs a corregir

### 1.1 Stock — filtros categoría/proveedor no aplican
**Causa:** `stock.rs` construye el SQL con `param_idx` correctamente pero los valores se pasan al query como `String` vía `binds: Vec<String>`. PostgreSQL rechaza coerción TEXT→INTEGER en prepared statements.
**Fix:** Cambiar los filtros de categoría y proveedor en el SQL para usar `::integer`:
```sql
AND p.categoria_id = $N::integer
AND p.proveedor_id = $N::integer
```

### 1.2 Consumos — buscador muestra resultados incorrectos
**Causa:** El threshold mínimo para disparar la búsqueda es 3 caracteres. Con 2 letras o menos, la query se ejecuta sin parámetro `q`, devolviendo los 100 primeros productos sin filtrar.
**Fix:** Bajar threshold a 2 caracteres + agregar hint visual "escribe al menos 2 letras".

### 1.3 Solicitudes — buscador del historial no funciona
**Causa:** El `<Input>` de búsqueda en la pestaña Historial no tiene `value` ni `onChange` — es decorativo.
**Fix:** Agregar estado `historialSearch`, conectar al input, y pasar como query param `q` al endpoint `GET /solicitudes-compra`.

### 1.4 Solicitudes — PDF falla (tipos incompatibles)
**Causa:** `exportarSolicitudPDF(detail)` recibe `SolicitudDetalle` pero espera `SolicitudPdfOptions`. Los campos no coinciden directamente.
**Fix:** Construir el objeto `SolicitudPdfOptions` desde `SolicitudDetalle` antes de llamar a la función. Incluir logo del lab y moneda configurada.

### 1.5 Dashboard → Solicitudes — ?select= no agrega producto
**Causa:** La página de solicitudes nunca lee el query param `select` de la URL.
**Fix:** `useEffect` al montar que lea `searchParams.get('select')`, busque el producto por ID en el backend y lo pre-agregue al borrador.

### 1.6 Conteo — áreas sin stock no se bloquean en el modal
**Causa:** Todas las áreas activas aparecen en el modal de nueva sesión, incluyendo las vacías.
**Fix:** Marcar áreas sin stock como `disabled` (no seleccionables). Toggle "Ocultar sin stock" activo por defecto. El dato de stock por área ya está disponible via `GET /areas`.

---

## 2. Dashboard — Tipografía

Estandarizar `font-black` + texto 9–11px por `font-semibold/bold` + `text-sm/base`, alineado con el resto del sistema. Sin cambios estructurales ni de datos.

---

## 3. Consumos — Rediseño (Opción C elegida)

**Layout dividido:**
- Columna izquierda: buscador (min 2 chars) + selector de área + lista de productos con chips de área, categoría, stock y número de lotes
- Columna derecha: carrito con detalle de lotes por ítem

**Selector de lote:**
- Si el producto tiene 1 solo lote activo: FEFO automático, sin elección
- Si tiene múltiples lotes: en el carrito aparece selector inline con radio buttons, el lote FEFO marcado en verde, override opcional
- El consume se envía con el `lote_id` explícito cuando el usuario elige manualmente; sin él cuando es FEFO automático

**API consumos existente:** `POST /consumos/batch` acepta `lote_id` opcional por ítem (verificar que el backend lo soporte; si no, agregar).

---

## 4. Conteo — Mejoras

### 4.1 Período global configurable
- Nuevo campo en `configuracion`: clave `conteo_periodo_dias` (valor por defecto "30")
- Prioridad: `area.conteo_frecuencia_dias` (si > 0) → `configuracion.conteo_periodo_dias` → 30

### 4.2 Modal nueva sesión — Opción B (barras de progreso)
- Lista plana de áreas con stock
- Barra de progreso de urgencia por área: `dias_desde_ultimo / periodo_max * 100%`
- Colores: < 70% verde, 70–100% amarillo, > 100% rojo (vencida)
- Áreas sin stock: deshabilitadas, marcadas con ícono, ocultas por defecto (toggle)

---

## 5. Recepciones — Rediseño (Opción B elegida)

### 5.1 Lista con tabs
- Tabs: Borradores · Confirmadas · Todas
- Buscador por N° doc / proveedor + filtro por proveedor y rango de fechas
- Acciones rápidas por fila: Editar / Confirmar / Eliminar (solo borradores)
- Banner en la parte superior si hay ítems en camino del mismo proveedor

### 5.2 Página de detalle completa
- Editar ítems de borrador: cambiar cantidad, lote, área destino; agregar/quitar productos
- Botones de estado prominentes: Confirmar / Cancelar
- El cambio a "confirmada" dispara el modal de reconciliación en camino

### 5.3 Modal "ítems en camino"
Al confirmar una recepción:
1. Backend compara `proveedor_id` de la recepción con solicitudes en estado `en_camino` o `aprobada` con recepción vinculada pendiente
2. Si hay ítems, aparece modal con checkbox por ítem (detección automática: ítem presente en la recepción = pre-marcado)
3. Al aceptar: los ítems marcados se vinculan a la recepción y su estado en la solicitud pasa a `recibido`
4. New endpoint: `POST /recepciones/{id}/reconciliar` con body `{ item_ids: UUID[] }`

### 5.4 Escáner QR desde celular
- New endpoint: `POST /recepciones/scanner-session` → devuelve `{ token: UUID, expires_at }`
- New endpoint: `POST /recepciones/scanner-session/{token}/scan` → recibe `{ codigo: string }`, busca producto, agrega a cola
- New endpoint: `GET /recepciones/scanner-session/{token}/items` → devuelve ítems escaneados desde la última consulta (polling)
- Frontend: botón "Escanear con celular" genera QR con URL `/scan/{token}`, página móvil lee cámara con `html5-qrcode` y hace POST al endpoint
- Polling cada 2s desde la recepción activa; al llegar un ítem se agrega al formulario
- Las sesiones de scanner expiran en 10 minutos; tabla temporal en DB o en memoria de la app (usar tabla)

---

## 6. Solicitudes de Compra — Mejoras

- Buscador historial funcional (conectado al backend)
- PDF: corregir mapeo de tipos, incluir logo del laboratorio desde `configuracion.logo_base64`, usar moneda configurada
- URL `?select=PRODUCTO_ID`: leer al montar → `GET /productos/{id}` → construir `ItemRecomendado` → pre-agregar

---

## 7. Configuración + Creador de Productos

### 7.1 Nuevos campos en configuración
- `moneda_codigo`: string ISO 4217 (ej. "CLP", "USD", "PEN") — default "CLP"
- `moneda_simbolo`: string (ej. "$", "S/", "USD") — default "$"
- `conteo_periodo_dias`: integer — default 30

### 7.2 Uso de moneda
- `formatPesos()` en `solicitudes-compra/index.tsx` y `solicitud-pdf.ts` usa el símbolo/código de configuración
- Campo precio en creador de productos muestra símbolo de moneda configurada
- Backend: no requiere cambio (los precios siguen en NUMERIC sin moneda en DB)

---

## Archivos clave a crear/modificar

### Backend
- `backend/migrations/035_configuracion_moneda_conteo.sql` — nuevos campos en tabla configuracion
- `backend/migrations/036_scanner_sessions.sql` — tabla para sesiones de scanner QR
- `backend/src/handlers/configuracion.rs` — agregar moneda_codigo, moneda_simbolo, conteo_periodo_dias
- `backend/src/handlers/stock.rs` — fix ::integer en filtros
- `backend/src/handlers/recepciones.rs` — nuevo endpoint reconciliar + scanner_session
- `backend/src/bin/export_types.rs` — regenerar tipos después de cambios

### Frontend
- `frontend/src/pages/dashboard/index.tsx` — fix tipografía
- `frontend/src/pages/stock/index.tsx` — (no cambios, bug es en backend)
- `frontend/src/pages/consumos/index.tsx` — rediseño completo
- `frontend/src/pages/conteo/index.tsx` — modal rediseñado con barras de progreso
- `frontend/src/pages/solicitudes-compra/index.tsx` — buscador + ?select + PDF fix
- `frontend/src/lib/solicitud-pdf.ts` — mapeo de tipos + logo + moneda
- `frontend/src/pages/recepciones/index.tsx` — rediseño con tabs
- `frontend/src/pages/recepciones/detalle.tsx` — edición de borrador + modal en-camino
- `frontend/src/pages/recepciones/en-camino-modal.tsx` — nuevo componente
- `frontend/src/pages/recepciones/qr-scanner-session.tsx` — nuevo componente
- `frontend/src/pages/configuracion/index.tsx` — nuevos campos
- `frontend/src/types/generated.ts` — regenerar con export_types

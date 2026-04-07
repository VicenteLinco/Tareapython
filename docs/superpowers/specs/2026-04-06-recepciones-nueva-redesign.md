# Spec: Rediseño de Nueva Recepción

**Fecha:** 2026-04-06  
**Branch:** `feat/solicitudes-compra-redesign`  
**Estado:** Aprobado — listo para implementación

---

## Contexto

La página actual (`/recepciones/nueva`) usa un wizard de 2 pasos básico sin soporte para:
- Decisiones de recepción (conforme / parcial / rechazo con motivo)
- Escáner QR/código de barras integrado en el flujo
- Impresión de etiquetas por lote al momento de recibir

El flujo real del laboratorio: llega una guía de despacho física de un proveedor con N productos. El usuario cuenta los ítems, ingresa lote y vencimiento por producto, y toma una decisión final (todo conforme, recepción parcial, o rechazo total con motivo).

---

## Diseño: Layout B+C (panel lateral fijo + scan inline)

### Estructura de la página

```
┌────────────────────┬─────────────────────────────────────────┐
│  Panel izquierdo   │  Panel derecho                          │
│  (fijo, 280px)     │  (scrollable)                           │
│                    │                                          │
│  Datos de guía     │  [🔍 Escanear / Buscar producto...]     │
│  · Proveedor       │                                          │
│  · Nº Guía         │  ┌─ Ítem card ───────────────────────┐  │
│  · Fecha           │  │ Nombre · Código · Área             │  │
│  · Solicitud       │  │ [Lote] [Vencimiento] [Qty] [Área]  │  │
│                    │  │ 🏷️ Etiqueta (N)   [✕ Quitar]       │  │
│  Estado badge      │  └───────────────────────────────────┘  │
│                    │                                          │
│  [📷 Escanear]     │  (más ítems...)                         │
│                    │                                          │
│  ── Decisión ──    │  ┌─ 🏷️ Imprimir etiquetas ───────────┐  │
│  ○ Conforme        │  │ ☑ Guantes Latex  LT-089  [2]       │  │
│  ○ Parcial         │  │ ☐ Tubos EDTA     incompleto        │  │
│  ○ Rechazar →      │  │ ☑ Alcohol 70%    AP-777  [3]       │  │
│    [motivos]       │  │ [Imprimir 5 etiquetas]              │  │
│                    │  └───────────────────────────────────┘  │
│  [Confirmar]       │                                          │
└────────────────────┴─────────────────────────────────────────┘
```

En móvil: panel izquierdo colapsa en un header sticky + drawer de decisión al pie.

---

## Funcionalidades

### 1. Cabecera / Panel izquierdo

- **Proveedor**: selector existente (`ProveedorSelect`)
- **Nº Guía de Despacho**: input texto libre
- **Fecha y hora**: pre-rellenado con ahora, editable
- **Solicitud vinculada** (opcional): botón "Cargar solicitud" → modal existente con solicitudes aprobadas/enviadas
- **Estado badge**: cambia según decisión seleccionada (En proceso / Conforme / Parcial / Rechazada)

### 2. Agregar ítems — escáner y búsqueda

El campo de búsqueda superior resuelve en este orden de prioridad:
1. `lote.codigo_interno` → agrega ítem pre-rellenado con datos del lote ya existente
2. `presentacion.codigo_barras` → agrega ítem con la presentación correcta pre-seleccionada
3. `producto.codigo_interno` → agrega ítem con primer presentación por defecto
4. Búsqueda por nombre (≥3 chars) → dropdown con resultados

El botón "📷 Escanear" abre el componente `QrScannerSession` existente para cámara o acepta señal HID directamente en el input.

### 3. Tarjeta de ítem (inline editing)

Cada ítem muestra:
- Imagen del producto, nombre, código interno, área destino
- Badge de estado: ✓ OK (verde) cuando lote + vencimiento + área estén completos, ⚠ Incompleto (naranja) si falta alguno
- 4 campos editables inline:
  - **Lote** (texto)
  - **Vencimiento** (date)
  - **Cantidad** (número) + selector de presentación si hay más de una
  - **Área destino** (select — pre-rellenado desde el catálogo del producto, editable)
- Botón "🏷️ Etiqueta (N)" — toggle que añade el ítem a la sección de etiquetas; muestra cantidad actual
- Botón ✕ para quitar el ítem

### 4. Decisión de recepción

Tres opciones mutuamente excluyentes en el panel izquierdo:

| Decisión | Estado | Comportamiento |
|----------|--------|----------------|
| **Conforme** | `confirmada` | Recepciona todos los ítems completos |
| **Recepción parcial** | `parcial` | Recepciona solo ítems completos; los incompletos quedan anotados en nota |
| **Rechazar guía** | `rechazada` | No genera movimientos de stock; registra motivo |

**Motivos de rechazo** (chips seleccionables, múltiple, + campo nota libre):
- 🌡️ Cadena de frío rota
- 📦 Embalaje dañado
- 📄 Documentos incorrectos / Guía no coincide
- 🔢 Cantidad no coincide con guía
- ⚗️ Producto no solicitado
- ✏️ Otro (campo libre obligatorio)

**Recepción parcial**: muestra campo de nota para explicar qué faltó.

### 5. Impresión de etiquetas por lote

Sección colapsable al pie del panel derecho. Aparece automáticamente cuando al menos un ítem tiene lote y vencimiento completos.

Cada fila:
- **Checkbox** — incluir/excluir de la impresión
- **Nombre del producto** y presentación
- **Vista previa**: `[lote] · [vencimiento] · [área]`
- **Cantidad de etiquetas** — input numérico, pre-rellenado con la cantidad de presentaciones recibidas, editable
- Ítems sin lote/vencimiento completos aparecen deshabilitados con "Datos incompletos"

**QR de la etiqueta codifica `lote.codigo_interno`** — al escanear en consumo o conteo, el sistema resuelve directamente el lote sin ambigüedad y descuenta de ese lote específico (sin FEFO implícito).

Botón "Imprimir N etiquetas" → genera PDF con etiquetas en formato 50×25mm usando la biblioteca de impresión existente (o `window.print` con CSS `@media print`).

### 6. Confirmar

Botón en panel izquierdo. Validaciones antes de confirmar:
- Proveedor seleccionado
- Al menos 1 ítem con lote + vencimiento + área completos (para Conforme y Parcial)
- Motivo seleccionado o nota libre si decisión = Rechazar

Al confirmar exitosamente:
- Si hay etiquetas marcadas → ofrece imprimir antes de navegar
- Navega a `/recepciones` con toast de éxito

---

## Cambios en backend

### Modificar endpoint de scan

`GET /api/v1/productos/scan?codigo=` actualmente busca solo por `producto.codigo_interno` y `producto.codigo_proveedor`. Extender para que también busque por:
- `lote.codigo_interno` → devuelve datos del lote (producto, presentación, área, lote pre-rellenado, vencimiento)

Respuesta cuando el código resuelve un lote:
```json
{
  "tipo": "lote",
  "lote_id": "uuid",
  "codigo_interno": "LOT-000042",
  "numero_lote": "BT-2025-012",
  "fecha_vencimiento": "2026-12-31",
  "producto_id": "uuid",
  "producto_nombre": "Tubos EDTA 3mL",
  "presentacion_id": 5,
  "presentacion_nombre": "Caja",
  "area_id": 3,
  "area_nombre": "Hematología"
}
```

### Nuevo campo en recepción: `motivo_rechazo`

La tabla `recepciones` ya tiene:
- `estado CHECK ('borrador', 'completa', 'parcial', 'rechazada')` → mapea directamente a la decisión (conforme = `completa`)
- `nota TEXT` → se usa para nota de recepción parcial

Solo se requiere una migration nueva para:
```sql
ALTER TABLE recepciones ADD COLUMN motivo_rechazo TEXT;
```

El payload de confirmación agrega `motivo_rechazo` (string con los chips seleccionados + nota libre separados por `|`, solo para `estado = 'rechazada'`).

---

## Archivos afectados

### Frontend
- `frontend/src/pages/recepciones/nueva.tsx` — reescritura completa
- `frontend/src/lib/api.ts` — si se agrega helper para scan por lote

### Backend
- `backend/src/handlers/presentaciones.rs` o `productos.rs` — extender endpoint scan
- `backend/migrations/NNN_recepcion_decision.sql` — si se necesita columna nueva

---

## Fuera de alcance

- Firma digital de la recepción
- Foto del estado del embalaje
- Integración con sistema de temperatura (sensor externo)
- Notificación al proveedor de rechazo

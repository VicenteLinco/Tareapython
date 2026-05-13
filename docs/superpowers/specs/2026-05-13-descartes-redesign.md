# Spec: Rediseño Módulo Descartes

**Fecha:** 2026-05-13  
**Módulo:** `/descartes`  
**Estado:** Aprobado

---

## Contexto

El módulo de descartes actual tiene dos problemas principales:
1. El flujo obliga a seleccionar un área antes de ver cualquier ítem, lo que es lento cuando el objetivo habitual es descartar vencidos de cualquier área.
2. No existe historial visible de descartes pasados ni exportación PDF. Los registros sí se persisten en la tabla `movimientos` (tipos `DESCARTE_VENCIDO` / `DESCARTE_DAÑADO`) agrupados por `grupo_movimiento`, pero no hay UI para consultarlos.

---

## Objetivo

Rediseñar `/descartes` con:
- Flujo de nuevo descarte más directo: muestra todos los vencidos de todas las áreas por defecto, con filtros opcionales por área y proveedor.
- Historial de sesiones de descarte filtrable por fechas, con exportación PDF por sesión y por rango.

---

## Estructura de la página

Página con **dos tabs**:
- **Nuevo Descarte**
- **Historial**

---

## Tab "Nuevo Descarte"

### Layout
Dos paneles horizontales: lista (izquierda, flex-1) + carrito/resumen (derecha, w-96). Sin stepper.

### Panel izquierdo — Lista de stock vencido

**Carga inicial:** todos los ítems con `fecha_vencimiento < hoy` de todas las áreas y proveedores. No requiere selección de área previa.

**Barra de filtros (opcionales):**
- Buscador por nombre de producto o código de lote (autocomplete con dropdown)
- Select de área (opcional, filtra la lista)
- Select de proveedor (opcional, filtra la lista)
- Toggle "Incluir próximos a vencer (< 30 días)" — por defecto desactivado

**Columnas de la tabla:**
| Columna | Detalle |
|---------|---------|
| Checkbox | Selección |
| Insumo / Lote | Nombre + código lote |
| Área | Nombre del área |
| Vencimiento | Fecha + badge VENCIDO si `días < 0` |
| Stock | Cantidad con unidad (`formatCantidad`) |

**Interacción al seleccionar un ítem:**
- La fila se expande inline mostrando dos campos: **Cantidad a descartar** (number, máx = stock disponible) y **Motivo** (select: Vencido / Dañado / Contaminado / Otro)
- Al volver a hacer click o presionar × → se quita del carrito y la fila se colapsa

**Ítem sano (vencimiento > 30 días):** badge "sano" + el motivo debe ser distinto de "vencido". Si se intenta confirmar con ítems sanos sin justificación, se muestra modal de advertencia (comportamiento actual preservado).

### Panel derecho — Carrito

- Lista compacta de ítems seleccionados (nombre, lote, área, cantidad, motivo)
- Contador de ítems
- Botón "Confirmar Descarte" (rojo, ancho completo)
- Cuando no hay ítems: estado vacío con texto guía

**Estado post-confirmación:**
El panel derecho se reemplaza por una tarjeta de éxito que muestra:
- Fecha y hora de la operación
- Responsable (usuario logueado)
- N° de ítems descartados
- Botón **"Descargar Acta PDF"** (genera PDF cliente-side)
- Botón "Nuevo descarte" para limpiar y volver al estado inicial

---

## Tab "Historial"

### Filtros

- **Rango de fechas:** selector de día específico o mes completo (dos inputs: desde / hasta)
- **Filtro por área** (select, opcional)
- Botón **"Exportar PDF"** — genera un PDF de todas las sesiones visibles con los filtros aplicados

### Lista de sesiones

Cada sesión corresponde a un `grupo_movimiento`. Se muestran agrupadas cronológicamente descendente.

**Cabecera de sesión (siempre visible):**
- Fecha y hora
- Responsable (nombre de usuario)
- Áreas involucradas (lista compacta)
- Total de ítems descartados
- Botón **"PDF"** (ícono de descarga) → genera PDF solo de esa sesión
- Chevron expand/collapse

**Contenido expandido — tabla de ítems:**
| Columna | Detalle |
|---------|---------|
| Producto | Nombre |
| Lote | Código |
| Área | Nombre |
| Motivo | Tipo normalizado (Vencido / Dañado) |
| Cantidad | Con unidad (`formatCantidad`) |
| Vencimiento | Fecha |
| Nota | Justificación si existe |

---

## Generación de PDF

Librería: **jspdf + jspdf-autotable** (cliente, sin backend).

**Contenido del acta PDF:**
```
ACTA DE DESCARTE
Laboratorio: [nombre desde configuración]
Fecha: [fecha de la sesión]
Responsable: [nombre del usuario]
Área(s): [lista de áreas]

Tabla de ítems:
  N° | Producto | Lote | Área | Motivo | Cantidad | Venc. | Nota

Total ítems: N
Firma: ____________________
```

El PDF se genera en el cliente usando los datos ya disponibles en el frontend (respuesta de la API o datos del historial). No requiere endpoint nuevo para PDF.

---

## Backend — Nuevos endpoints

### 1. `GET /stock/lotes-vencidos`

Retorna todos los ítems de stock con `fecha_vencimiento <= hoy + dias_alerta`.

**Query params:**
| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `area_id` | int | — | Filtro opcional por área |
| `proveedor_id` | uuid | — | Filtro opcional por proveedor |
| `dias_alerta` | int | 0 | Días de margen: 0 = solo vencidos, 30 = incluye próximos a vencer |

**Response:** `StockPorArea[]` — mismo shape que `/stock/area/:id/lotes` pero con campo `area_nombre` adicional.

### 2. `GET /descartes`

Retorna sesiones de descarte paginadas.

**Query params:**
| Param | Tipo | Default |
|-------|------|---------|
| `desde` | date | — |
| `hasta` | date | — |
| `area_id` | int | — |
| `page` | int | 1 |
| `per_page` | int | 20 |

**Response:**
```json
{
  "data": [
    {
      "grupo_movimiento": "uuid",
      "fecha": "2026-05-13T10:30:00Z",
      "usuario_nombre": "María López",
      "areas": ["UCI", "Hematología"],
      "total_items": 4,
      "items": [
        {
          "producto_nombre": "...",
          "codigo_lote": "...",
          "area_nombre": "...",
          "tipo": "DESCARTE_VENCIDO",
          "cantidad": "5",
          "unidad_base_nombre": "...",
          "unidad_base_nombre_plural": "...",
          "fecha_vencimiento": "2026-04-01",
          "nota": null
        }
      ]
    }
  ],
  "total": 12,
  "page": 1,
  "per_page": 20
}
```

---

## Cambios en el frontend existente

- `frontend/src/pages/descartes/index.tsx` — reescritura completa
- Extraer hooks: `useDescartesStock` (query lotes-vencidos), `useDescartesHistorial` (query GET /descartes)
- Extraer componente: `DescartePdfGenerator` (lógica jspdf)
- Agregar dependencias: `jspdf`, `jspdf-autotable`

---

## Lo que NO cambia

- El endpoint `POST /descartes` y su lógica de negocio (idempotencia, FEFO, validación de sanos)
- La estructura de la tabla `movimientos`
- El comportamiento del modal de advertencia para ítems sanos

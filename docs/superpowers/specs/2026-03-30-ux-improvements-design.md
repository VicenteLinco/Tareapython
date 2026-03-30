# UX Improvements — Consumos, Dashboard Resoluciones, Audit Log, Descartes

**Date:** 2026-03-30
**Status:** Approved

---

## Scope

Four focused UX fixes across three pages:

1. Consumos — eliminar bloqueo por área
2. Dashboard Resoluciones — feed automático real
3. Audit Log — corrección de ruta rota + reubicación
4. Descartes — advertencia + justificación obligatoria para ítems saludables

---

## 1. Consumos — Área Opcional

### Problema
El selector de área muestra `"UBICACIÓN REQUERIDA..."` en rojo y bloquea el botón de confirmar hasta que se seleccione. En un laboratorio clínico el stock es compartido entre áreas — el área es un dato organizacional, no un requisito operacional.

### Diseño

**Selector de área:**
- Cambiar opción por defecto de `"UBICACIÓN REQUERIDA..."` → `"Todas las áreas"` (value `""`, sin estilo de error).
- Quitar el estilo condicional `select-error` cuando `!areaId`.

**Carga de productos:**
- Sin área seleccionada: cargar stock global con `GET /stock?per_page=100` (o el límite que sea razonable). Mostrar columna/campo de área junto a cada producto como dato informativo.
- Con área seleccionada: comportamiento actual (filtrar por área).


**Confirmación:**
- Eliminar la validación `if (!areaId || ...)` en `handleConfirm`.
- Si `areaId` tiene valor, se envía en el payload. Si es `null`, se omite (el backend ya acepta área opcional en `POST /consumos/batch`).

---

## 2. Dashboard — Resoluciones Automáticas

### Problema
El widget "Resoluciones" actualmente hace `GET /movimientos?tipo=entrada` y muestra cualquier movimiento de entrada. No tiene relación con la resolución de alertas.

### Diseño

**Lógica del feed (frontend, sin nuevo endpoint):**

Hacer dos queries en paralelo (ya existen ambos):
- `GET /stock/alertas?per_page=100` — alertas activas actuales
- `GET /movimientos?per_page=20` — últimos 20 movimientos

Cruzar en el cliente:
- Un movimiento se considera "resolución" si su `producto_id` **no aparece** en las alertas activas actuales.
- Mostrar máximo 5 ítems, ordenados por fecha descendente.

**Display de cada ítem:**
- Icono según tipo de movimiento:
  - `RECEPCION` → flecha verde hacia abajo (ArrowDownLeft) — label: "Stock normalizado"
  - `DESCARTE` → ícono de tachito (Trash2) en rojo — label: "Lote retirado"
  - `CONSUMO` → checkmark — label: "Consumo registrado"
- Nombre del producto
- Usuario + fecha relativa

**Botón "Ver historial completo":**
- Cambiar `navigate('/audit-log')` → `navigate('/movimientos')`.

---

## 3. Audit Log — Corrección de Ruta y Reubicación

### Problemas
1. El frontend llama `GET /audit_log` (underscore) pero el backend registra la ruta como `/audit-log` (guión) → 404.
2. El audit log no es contenido de dashboard operativo; es una herramienta de administración.

### Diseño

**Corrección de ruta:**
- En `frontend/src/pages/audit-log/index.tsx` línea 39: cambiar `'/audit_log'` → `'/audit-log'`.

**Reubicación:**
- Quitar el enlace al audit-log del dashboard.
- En el sidebar, mover "Auditoría" a la sección de Configuración, visible solo para rol `admin`.

---

## 4. Descartes — Advertencia para Ítems Saludables

### Problema
Un lote en buen estado puede descartarse con un solo click + confirmar, sin advertencia ni justificación.

### Diseño

**Condición de disparo:**
El modal se muestra cuando el usuario hace click en "Confirmar Descarte" y al menos un ítem seleccionado cumple:
- `motivo !== 'vencido'` **Y** `días_hasta_vencimiento > 30` (lote no vencido ni próximo a vencer)

**Modal de advertencia:**
- Header: "¿Descartar insumos en buen estado?" (icono + color rojo)
- Lista de los ítems afectados con nombre, lote y cantidad
- Texto: "Estos lotes no están vencidos ni próximos a vencer. Esta acción es irreversible."
- Campo de texto: "Justificación" (requerido, mínimo 10 caracteres)
- Botones: "Cancelar" + "Confirmar de todas formas" (deshabilitado hasta que justificación sea válida)

**Payload:**
- La justificación se envía en el campo `nota` que ya existe por ítem en el backend (`DescarteItem.nota: Option<String>`). Sin cambio de schema.

**Flujo normal (lotes vencidos o motivo = vencido):**
- Sin cambios — confirmar directo como hoy.

---

## Archivos Afectados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/pages/consumos/index.tsx` | Área opcional, carga global sin área, eliminar validación |
| `frontend/src/pages/dashboard/index.tsx` | Lógica de resoluciones cruzando alertas + movimientos, redirigir a /movimientos |
| `frontend/src/pages/audit-log/index.tsx` | Corregir path `/audit_log` → `/audit-log` |
| `frontend/src/components/layout/sidebar.tsx` | Mover Auditoría a sección Configuración (solo admin) |
| `frontend/src/pages/descartes/index.tsx` | Modal de advertencia + justificación obligatoria |

---

## No incluido en este alcance

- Cambios de schema en backend
- Nuevos endpoints
- Cambios en el modelo de usuario (área por defecto)
- Rediseño visual general de ninguna página

# Spec: Limpieza del sistema + Rediseño del algoritmo de compras

**Fecha:** 2026-04-13
**Branch:** feat/solicitudes-compra-redesign
**Alcance:** Eliminación de código muerto, simplificación del flujo de solicitudes, rediseño del algoritmo de recomendaciones, módulo de importación CSV y mejoras al PDF exportado.

---

## Contexto

El sistema está en fase final de desarrollo. Antes de producción se identificaron:
- Funcionalidades agregadas sin validación con el laboratorio (kiosk, QR)
- Un flujo de aprobación de solicitudes sobrediseñado (8 estados, 2 funcionales)
- Un algoritmo de recomendaciones con fallas estructurales
- La función `autoPlural()` con un bug que produce "kites" en lugar de "kits"

Este spec cubre todo el trabajo de limpieza y rediseño antes de continuar con nuevas features.

---

## Sección 1 — Eliminaciones

### Frontend

| Qué eliminar | Ubicación |
|---|---|
| Página kiosk completa | `frontend/src/pages/kiosk/` |
| Página modo-qr completa | `frontend/src/pages/modo-qr/` |
| Ruta `/kiosk` | Router principal |
| Ruta `/qr` | Router principal |
| Dependencia `qrcode` | `package.json` |
| Dependencia `html5-qrcode` | `package.json` |

### Backend

| Qué eliminar | Ubicación |
|---|---|
| Endpoint `POST /{id}/revisar` (stub vacío) | `handlers/solicitudes_compra.rs:487` |
| Endpoint `GET /en-camino` | `handlers/solicitudes_compra.rs:413` |
| CTE `pendientes` (calculado pero nunca usado) | `handlers/solicitudes_compra.rs:302` |

### Base de datos

| Qué eliminar | Migración |
|---|---|
| Tabla `solicitud_items` | migration 037 |
| Columna `recepcion_id` en `solicitudes_compra` | migration 037 |
| Check constraint de 9 estados | migration 037 |

El check constraint se reemplaza por uno nuevo de 2 estados (ver Sección 2).

---

## Sección 2 — Flujo de solicitudes simplificado

### Estados: de 8 a 2

```
borrador  →  guardada
```

| Estado | Significado |
|---|---|
| `borrador` | El usuario está construyendo la solicitud. Persiste en el servidor entre sesiones. Solo uno por usuario a la vez. |
| `guardada` | El usuario confirmó. Queda en el historial como registro inmutable. |

Todos los estados eliminados: `pendiente`, `aprobada`, `rechazada`, `enviada`, `en_camino`, `completada`, `cancelada`, `recibido`.

### Migración nueva

```sql
ALTER TABLE solicitudes_compra
  DROP CONSTRAINT solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
  ADD CONSTRAINT solicitudes_compra_estado_check
  CHECK (estado IN ('borrador', 'guardada'));

-- Normalizar registros existentes
UPDATE solicitudes_compra
  SET estado = 'guardada'
  WHERE estado NOT IN ('borrador', 'guardada');
```

### Cambios en el endpoint

| Antes | Después |
|---|---|
| `POST /{id}/enviar` → estado `aprobada` | `POST /{id}/guardar` → estado `guardada` |
| `POST /{id}/revisar` (TODO) | **eliminado** |
| `GET /en-camino` | **eliminado** |

### Flujo de usuario

```
1. Entra a Solicitudes de Compra
2. Ve recomendaciones automáticas por proveedor
3. Ajusta cantidades, agrega o quita ítems
4. Presiona "Guardar solicitud"
5. La solicitud pasa a estado guardada
6. Aparece en el historial
7. Puede exportar PDF desde el historial en cualquier momento
```

No existe workflow de aprobación. Cualquier usuario con rol `tecnologo` o `admin` puede guardar una solicitud.

---

## Sección 3 — Algoritmo de recomendaciones rediseñado

### Principio: dos preguntas separadas

| Pregunta | Lógica |
|---|---|
| ¿Cuándo mostrar en recomendaciones? | `stock_actual ≤ stock_seguridad + (consumo_diario × lead_time)` |
| ¿Cuánto sugerir pedir? | `stock_seguridad + consumo_diario × (lead_time + periodo_revision) - stock_actual - pedidos_en_vuelo` |

### Variables

| Variable | Fuente | Notas |
|---|---|---|
| `stock_seguridad` | Campo `stock_minimo` en tabla `productos` (renombrado semánticamente, no en DB) | Viene del CSV o se edita manualmente. Es el piso que nunca se debe cruzar. |
| `consumo_diario` | Promedio de movimientos tipo `CONSUMO` sobre ventana configurable | Ventana: 30 / 60 / 90 días, configurable global en `configuracion` |
| `lead_time` | `proveedores.dias_despacho_tierra` (o `aereo` si no hay tierra). Default 7 si ambos son null. | Sin cambios |
| `periodo_revision` | Campo nuevo en `configuracion`: `periodo_revision_dias`. Default 30. | Cada cuántos días se hace una compra |
| `pedidos_en_vuelo` | `SUM(cantidad_sugerida)` de ítems en solicitudes con estado `guardada` **creadas en los últimos `lead_time × 2` días** para ese producto | Ventana acotada para que órdenes antiguas no bloqueen futuras recomendaciones. Pasada esa ventana se asume recibida o abandonada. |

### Niveles de urgencia (2, no 3)

| Nivel | Condición |
|---|---|
| `critico` | `stock_actual < stock_seguridad` |
| `planificar` | `stock_actual < stock_seguridad + consumo_diario × lead_time` |

Los productos que no cumplen ninguna condición no aparecen en recomendaciones.

### Indicador de confianza

Se muestra en la UI junto a cada ítem recomendado:

| Días de historial disponible | Etiqueta |
|---|---|
| 0 días | "Sin historial — revisa la cantidad" |
| 1–30 días | "Estimación preliminar" |
| 31–90 días | "Estimación moderada" |
| > 90 días | "Estimación confiable" |

El indicador se calcula como: `NOW() - MIN(created_at) de movimientos tipo CONSUMO para ese producto`.

### Comportamiento año 1 (sin historial)

Cuando `consumo_diario = 0`:
- El producto aparece en recomendaciones **solo si** `stock_actual < stock_seguridad`
- `cantidad_sugerida` es editable, con hint = `stock_seguridad × 2`
- Se muestra etiqueta "Sin historial — revisa la cantidad"
- No se bloquea la solicitud: el usuario decide la cantidad

### Query SQL (estructura simplificada)

```sql
WITH consumo AS (
  SELECT
    l.producto_id,
    SUM(m.cantidad) / NULLIF(DATE_PART('day', NOW() - MIN(m.created_at)), 0) AS consumo_diario,
    DATE_PART('day', NOW() - MIN(m.created_at)) AS dias_historia
  FROM movimientos m
  JOIN lotes l ON l.id = m.lote_id
  WHERE m.tipo = 'CONSUMO'
    AND m.created_at >= NOW() - ($1 * INTERVAL '1 day')  -- ventana configurable
  GROUP BY l.producto_id
),
stock_total AS (
  SELECT producto_id, SUM(cantidad) AS stock_actual
  FROM stock GROUP BY producto_id
),
pedidos_en_vuelo AS (
  SELECT scd.producto_id, SUM(scd.cantidad_sugerida) AS cantidad_pedida
  FROM solicitud_compra_detalle scd
  JOIN solicitudes_compra sc ON sc.id = scd.solicitud_id
  WHERE sc.estado = 'guardada'
  GROUP BY scd.producto_id
)
-- ... resto de JOINs con productos, proveedores, presentaciones
```

El campo `$1` recibe el valor de `configuracion.ventana_consumo_dias` (30/60/90).

### Nuevo campo en `configuracion`

```sql
ALTER TABLE configuracion
  ADD COLUMN ventana_consumo_dias INT NOT NULL DEFAULT 30
    CHECK (ventana_consumo_dias IN (30, 60, 90)),
  ADD COLUMN periodo_revision_dias INT NOT NULL DEFAULT 30;
```

---

## Sección 4 — Módulo de importación CSV

### Endpoint

`POST /setup/importar-csv`

Protegido con rol `admin`. Acepta `multipart/form-data` con un archivo `.csv`.

### Columnas del CSV

| Columna | Requerido | Notas |
|---|---|---|
| `nombre` | ✅ | Nombre del producto |
| `codigo_interno` | ✅ | Debe ser único. Si ya existe, la fila se omite. |
| `unidad_base` | ✅ | Nombre de la unidad base (se crea si no existe) |
| `unidad_base_plural` | ❌ | Si no viene, se usa `autoPlural()` |
| `categoria` | ❌ | Se crea automáticamente si no existe |
| `proveedor` | ❌ | Se crea automáticamente si no existe |
| `stock_seguridad` | ❌ | Mapea a `stock_minimo`. Default 0. |
| `precio_unitario` | ❌ | Default null |
| `codigo_proveedor` | ❌ | Default null |

### Comportamiento

- **Preview**: el endpoint acepta un query param `?preview=true` que retorna las primeras 5 filas parseadas sin insertar nada.
- **No abortar por errores parciales**: filas con error se saltan, las válidas se insertan.
- **Respuesta**:

```json
{
  "importados": 1420,
  "omitidos": 43,
  "errores": [
    { "fila": 12, "motivo": "codigo_interno duplicado: LAB-0042" },
    { "fila": 38, "motivo": "unidad_base vacía" }
  ]
}
```

### UI (frontend)

Página en `configuracion/` o `creador-productos/` con:
1. Input de archivo CSV
2. Botón "Vista previa" → muestra tabla con primeras 5 filas
3. Botón "Importar" → muestra resumen al finalizar
4. Link para descargar plantilla CSV de ejemplo

---

## Sección 5 — Mejoras al PDF exportado

### Tabla: de 7 a 5 columnas

| Columna | Ancho | Cambio respecto al actual |
|---|---|---|
| `#` | 6mm | Sin cambio |
| `Producto` (nombre + códigos) | **80mm** | +24mm — resuelve truncado de nombres largos |
| `Cantidad` (presentación + equivalencia base) | 30mm | Sin cambio |
| `Precio unitario` | 32mm | Fusiona "P.U. Base" y "P. Pres." en una sola celda |
| `Total neto` | 38mm | Sin cambio |

La columna `IVA 19%` por ítem se elimina — el IVA sigue apareciendo en la caja de totales.

### Sección de firma

| Antes | Después |
|---|---|
| Título: "FIRMAS Y APROBACIÓN" | Título: "RESPONSABLE" |
| Dos líneas: Solicitante + Autorizador | Una sola línea: **GENERADO POR** con nombre del usuario |
| Campo configurable para autorizador | Eliminado |

### Header

- El subtítulo "SISTEMA DE GESTIÓN DE INVENTARIO E INSUMOS CLÍNICOS" se reemplaza por `nombreLaboratorio` (ya disponible en las opciones del PDF).
- El campo "DEPARTAMENTO / ORIGEN" se omite del PDF — no hay forma confiable de determinar el área del solicitante sin un campo explícito en el modelo de usuario.

### Fix autoPlural

La función `autoPlural()` en `frontend/src/lib/utils.ts` actualmente agrega "es" a toda palabra terminada en consonante, produciendo "kites", "testes", "sets" incorrectos.

**Regla corregida**: palabras de origen extranjero terminadas en consonante precedida por vocal simple (`kit`, `test`, `set`, `rol`) → agregar solo `"s"`.

Implementación: lista de excepciones explícitas + detección de patrón `vocal + consonante final`.

---

## Principio de implementación

**Regla:** ningún cambio puede dejar el sistema en estado parcialmente roto. Si durante la implementación de un paso se detecta que algo se rompe de forma no trivial, ese componente se rediseña completo — no se parchea.

**Orden obligatorio:** cada sección se implementa y verifica de forma aislada antes de pasar a la siguiente. El orden es:

1. Eliminaciones (reduce superficie, no agrega riesgos)
2. Migración de estados (con script de normalización de datos existentes)
3. Algoritmo de recomendaciones (reescritura completa del query)
4. CSV import (feature nueva, sin dependencias de lo anterior)
5. PDF (cambios aislados en `solicitud-pdf.ts`)
6. Fix `autoPlural` (cambio pequeño, verificar todos los lugares que lo usan)

**Puntos de ruptura conocidos a verificar:**
- Al eliminar `solicitud_items`: confirmar con grep que ningún handler, service ni query la referencia antes de borrar.
- Al renombrar `enviar` → `guardar`: el frontend y backend deben cambiar en el mismo commit para evitar 404.
- Al reescribir el query de recomendaciones: verificar que funciona cuando `consumo_diario = 0` (sin historial) y cuando `stock_seguridad = 0` (sin configurar). No debe producir divisiones por cero ni resultados negativos.
- Fix `autoPlural`: buscar todos los usos en el frontend antes de cambiar la función para no romper plurales que hoy funcionan correctamente.

---

## Resumen de cambios por capa

### Backend

- [ ] Nueva migración: simplificar estados a `borrador | guardada`
- [ ] Nueva migración: agregar `ventana_consumo_dias` y `periodo_revision_dias` a `configuracion`
- [ ] Renombrar `enviar` → `guardar` en handler y routes
- [ ] Eliminar endpoints: `revisar`, `en-camino`
- [ ] Reescribir query de `recomendaciones` con nueva lógica
- [ ] Nuevo endpoint `POST /setup/importar-csv`

### Frontend

- [ ] Eliminar páginas `kiosk/` y `modo-qr/`
- [ ] Desregistrar rutas `/kiosk` y `/qr`
- [ ] Desinstalar paquetes `qrcode` y `html5-qrcode`
- [ ] Actualizar flujo de solicitudes: `enviar` → `guardar`, eliminar UI de revisión
- [ ] Actualizar `solicitud-pdf.ts`: 5 columnas, sección firma simplificada, header dinámico
- [ ] Corregir `autoPlural()` en `utils.ts`
- [ ] UI de importación CSV en configuración o creador-productos
- [ ] Mostrar indicador de confianza en tarjetas de recomendación

### Base de datos

- [ ] Migración 040: simplificar estados solicitudes
- [ ] Migración 041: `ventana_consumo_dias` y `periodo_revision_dias` en configuracion
- [ ] Migración 042: eliminar tabla `solicitud_items` y columna `recepcion_id`

---

## Lo que NO cambia

- El campo `stock_minimo` en la tabla `productos` mantiene su nombre en DB — solo cambia su uso semántico (ahora es el stock de seguridad, no un multiplicador).
- El formato visual del PDF (colores, header corporativo, caja de totales) se mantiene.
- El borrador de solicitud sigue persistiendo en el servidor entre sesiones.
- La carga manual de productos en `creador-productos/` no se toca.

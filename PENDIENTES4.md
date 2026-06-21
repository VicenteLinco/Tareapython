# Pendientes 4 — Bugs reportados en uso real

Cuarta tanda. A diferencia de las anteriores (auditoría de patrones, rediseños de flujo),
acá se registran **bugs concretos detectados al usar la app** en módulos de WhatsApp y
guías de despacho. Lista abierta: se van sumando hallazgos a medida que aparecen.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
La prioridad es una sugerencia de orden, no un compromiso.

> Los ítems completados se borran de este archivo (su registro queda en engram + git history).

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 4 | Endpoint `enviar` no marca envíos pendientes preexistentes (queda en "guardada") | Compras | 🟡 Media |

---

## 4. El endpoint `enviar` no actualiza envíos pendientes preexistentes
**Prioridad:** 🟡 Media · **Área:** Compras

**Problema**
- `POST /solicitudes-compra/{id}/enviar` responde `200 OK` pero **no marca como enviados**
  los envíos que `guardar` ya dejó en estado `pendiente`. Como `guardar` siempre crea un
  envío `pendiente` por proveedor, tras `guardar` + `enviar` la solicitud **permanece en
  estado `guardada`** en vez de pasar a `enviada`.

**Causa raíz (analizada)**
- El INSERT de `enviar` usa `ON CONFLICT (solicitud_id, proveedor_id) DO NOTHING`. El registro
  pendiente ya existe (lo creó `guardar`), así que el `DO NOTHING` lo deja intacto en
  `pendiente`; `recalcular_estado_solicitud` cuenta 0 enviados → estado `guardada`.
- Evidencia: `services/solicitud_service.rs::enviar` (el INSERT ... DO NOTHING) y el test de
  caracterización `solicitudes_test::enviar_no_actualiza_envios_pendientes_preexistentes`,
  que **fija el comportamiento actual** (no es regresión; el flujo real usa `registrar_envio`
  granular por proveedor, que sí funciona).

**Resultado esperado**
- Decidir: o (a) `enviar` debe hacer `DO UPDATE SET estado='enviado'` para marcar también los
  pendientes (y entonces actualizar el test de caracterización conscientemente), o (b) se
  considera intencional que `enviar` solo agregue faltantes y el camino de marcado masivo se
  elimina/redefine. Hoy el front usa el flujo granular (`registrar_envio`), así que el impacto
  real es bajo, pero el endpoint `enviar` es engañoso.

**Detectado**: durante la migración de `solicitudes_compra` a `solicitud_service` (PENDIENTES2 #9).

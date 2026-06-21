# Pendientes 4 — Bugs reportados en uso real

Cuarta tanda. A diferencia de las anteriores (auditoría de patrones, rediseños de flujo),
acá se registran **bugs concretos detectados al usar la app** en módulos de WhatsApp y
guías de despacho. Lista abierta: se van sumando hallazgos a medida que aparecen.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
La prioridad es una sugerencia de orden, no un compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad | Estado |
|---|-----------|------|-----------|--------|
| 1 | No deja entrar al simulador de WhatsApp | WhatsApp / Bot | 🔴 Alta | ✅ Resuelto |
| 2 | No deja ver ni descargar las guías de despacho | Guías de despacho | 🔴 Alta | ✅ Descarga + robustez (ver: backend OK, re-testear) |
| 3 | El tab "Guías de despacho respaldadas" no se lee completo en el lateral | Navegación / UX | 🟡 Media | ✅ Resuelto |

---

## 1. No deja entrar al simulador de WhatsApp
**Prioridad:** 🔴 Alta · **Área:** WhatsApp / Bot

**Problema**
- Al intentar acceder al simulador de WhatsApp, no permite entrar.

**Resultado esperado**
- El simulador de WhatsApp abre y queda operativo.

**Evidencia**
- A levantar al ejecutar (revisar ruta/handler del simulador y consola).

**Criterios de aceptación**
- [x] El simulador de WhatsApp se abre sin bloqueos.

**Causa raíz / solución**
- El handler `handlers/whatsapp.rs` (webhook + logs) existía completo pero **nunca se
  montó en `routes.rs`** → `/api/v1/webhooks/whatsapp` y `/logs` devolvían 404.
- Se separó `routes()` en `public_routes()` (webhook POST, validado por
  `X-Webhook-Secret`/firma Twilio) y `routes()` (GET `/logs`, protegido por JWT), y se
  registraron en el grupo público y protegido respectivamente.
- Verificado en vivo: `logs` 200 con token / 401 sin token; webhook POST 202.

---

## 2. No deja ver ni descargar las guías de despacho
**Prioridad:** 🔴 Alta · **Área:** Guías de despacho

**Problema**
- Las guías de despacho no se pueden visualizar ni descargar.

**Resultado esperado**
- Las guías de despacho se pueden ver en pantalla y descargar correctamente.

**Hallazgos**
- **Descargar**: no existía NINGÚN botón/lógica de descarga → se agregó `lib/uploads.ts`
  (`downloadUpload`, baja el blob con JWT y fuerza el guardado) y botón "Descargar" en
  los lightbox de `ordenes-compra/index.tsx` y `detalle.tsx`.
- **Ver**: el backend sirve la imagen correctamente (verificado: `GET /uploads/...` →
  200, image/jpeg, directo y por proxy Vite). El síntoma "Cargando foto" perpetuo era
  que `AuthenticatedUploadImage` ocultaba cualquier fallo como spinner infinito. Se
  añadió **estado de error visible + botón Reintentar**, de modo que un fallo real ahora
  es diagnosticable en lugar de quedar colgado.

**Criterios de aceptación**
- [x] Se puede descargar la guía de despacho.
- [~] Ver: backend confirmado OK; re-testear en el browser (un hard-refresh limpia
  bundles viejos). Si reaparece, ahora muestra error + Reintentar.

---

## 3. El tab "Guías de despacho respaldadas" no se lee completo en el lateral
**Prioridad:** 🟡 Media · **Área:** Navegación / UX

**Problema**
- En el menú lateral, el texto del tab "Guías de despacho respaldadas" se corta y no se
  lee completo.

**Resultado esperado**
- El tab muestra su etiqueta completa y legible en el lateral (truncado controlado,
  ajuste de ancho o texto alternativo).

**Causa raíz / solución**
- El label "Guías de Despacho Respaldadas" excedía el ancho del sidebar (224px) con
  `whitespace-nowrap` + `overflow-x-hidden` → se clipeaba.
- Se acortó la etiqueta del sidebar a **"Guías de Despacho"** (el título completo sigue
  en el header de la página, en el tab y en el tooltip al colapsar).

**Criterios de aceptación**
- [x] La etiqueta del tab se lee completa en el lateral.

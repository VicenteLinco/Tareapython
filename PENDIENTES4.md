# Pendientes 4 — Bugs reportados en uso real

Cuarta tanda. A diferencia de las anteriores (auditoría de patrones, rediseños de flujo),
acá se registran **bugs concretos detectados al usar la app** en módulos de WhatsApp y
guías de despacho. Lista abierta: se van sumando hallazgos a medida que aparecen.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
La prioridad es una sugerencia de orden, no un compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | No deja entrar al simulador de WhatsApp | WhatsApp / Bot | 🔴 Alta |
| 2 | No deja ver ni descargar las guías de despacho | Guías de despacho | 🔴 Alta |
| 3 | El tab "Guías de despacho respaldadas" no se lee completo en el lateral | Navegación / UX | 🟡 Media |

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
- [ ] El simulador de WhatsApp se abre sin bloqueos.

---

## 2. No deja ver ni descargar las guías de despacho
**Prioridad:** 🔴 Alta · **Área:** Guías de despacho

**Problema**
- Las guías de despacho no se pueden visualizar ni descargar.

**Resultado esperado**
- Las guías de despacho se pueden ver en pantalla y descargar correctamente.

**Evidencia**
- A levantar al ejecutar (revisar endpoint de generación/descarga y visor).

**Criterios de aceptación**
- [ ] Se puede ver una guía de despacho en pantalla.
- [ ] Se puede descargar la guía de despacho.

---

## 3. El tab "Guías de despacho respaldadas" no se lee completo en el lateral
**Prioridad:** 🟡 Media · **Área:** Navegación / UX

**Problema**
- En el menú lateral, el texto del tab "Guías de despacho respaldadas" se corta y no se
  lee completo.

**Resultado esperado**
- El tab muestra su etiqueta completa y legible en el lateral (truncado controlado,
  ajuste de ancho o texto alternativo).

**Evidencia**
- A levantar al ejecutar (componente del sidebar).

**Criterios de aceptación**
- [ ] La etiqueta del tab se lee completa en el lateral.

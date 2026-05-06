# Descartes — Warning de Items Sanos y Orden de Pasos — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Media
**Estado:** Propuesto

---

## Problema

En `frontend/src/pages/descartes/index.tsx` (~líneas 99–147):

1. **Warning de items sanos tardío.** Un item se considera "sano" si `motivo !== 'vencido'` y (`dias_a_vencer === null` o `dias_a_vencer > 30`). El usuario solo descubre que está descartando items sanos al abrir el modal de confirmación, donde se le pide justificación obligatoria. Si seleccionó 20 items y 15 son sanos, la sorpresa es grande.
2. **Orden de pasos ambiguo.** El flujo puede ser: seleccionar área → filtrar por vencimiento → elegir motivo → descartar; o: elegir motivo → filtrar. El UI no guía el orden. El selector de `motivo` general tiene opciones genéricas aplicadas a todos los items a la vez.

## Objetivo

- El usuario sabe durante la selección (no en el modal) cuántos items "sanos" va a descartar.
- El flujo de descarte tiene un orden recomendado explícito.

## Alcance

**Incluido:**
- Indicador por fila: icono/chip "sano" cuando corresponda.
- Contador en el footer/sticky: `"N items seleccionados (K sanos)"`.
- Warning inline cuando `K > 0` con link a "Ver detalle de items sanos".
- Guía visual del orden: stepper simple o secciones numeradas ("1. Área → 2. Filtros → 3. Selección → 4. Motivo y confirmación").

**Fuera de alcance:**
- Cambiar la lógica de clasificación sano/vencido.
- Cambiar el endpoint de descarte.

## Diseño propuesto

### UI

**Fila de lote en tabla de descarte:**
- Si el lote es "sano": chip compacto `✓ sano` (neutral-verde) junto al código.
- Tooltip: `"Vencimiento > 30 días. Requerirá justificación para descartar."`

**Footer/sticky al seleccionar:**
```
┌─────────────────────────────────────────────────────────────┐
│ 12 items seleccionados · 7 sanos ⚠                         │
│ [Ver sanos]              [Continuar a motivo y confirmar →] │
└─────────────────────────────────────────────────────────────┘
```

- `⚠` solo si hay sanos.
- "Ver sanos": abre un popover listando los items sanos seleccionados.

**Modal de confirmación (existente):**
- Ya pide justificación cuando hay sanos; mantener. Añadir en el encabezado el texto: `"Descartando N items (K sanos requieren justificación)"`.

**Orden de pasos:**
- Encabezado de la página con secciones numeradas discretas:
  - `1. Área` (selector)
  - `2. Filtros` (vencimiento, proveedor, categoría)
  - `3. Seleccionar items`
  - `4. Motivo y confirmación` (CTA que abre el modal)
- Las secciones no bloquean entre sí (el usuario puede saltar), pero la numeración orienta.

### Lógica

```ts
const seleccionados = items.filter(i => i.checked)
const sanos = seleccionados.filter(esItemSano)
// esItemSano: motivo !== 'vencido' AND (diasAVencer === null || diasAVencer > 30)

const puedeConfirmar = seleccionados.length > 0
const requiereJustificacion = sanos.length > 0
```

La función `esItemSano` ya existe; extraerla a un helper si no lo está.

## Archivos afectados

- `frontend/src/pages/descartes/index.tsx` (stepper, footer, chip por fila)
- `frontend/src/lib/descartes-utils.ts` (crear si no existe, con `esItemSano`)

Sin cambios en backend.

## Criterios de aceptación

- [ ] Cada fila de la tabla de descartes muestra chip "sano" cuando corresponde.
- [ ] El footer sticky muestra contador total y contador de sanos con warning visible.
- [ ] Click en "Ver sanos" muestra lista de items sanos seleccionados.
- [ ] El encabezado de la página muestra los 4 pasos numerados.
- [ ] El modal de confirmación sigue requiriendo justificación si hay sanos (comportamiento existente intacto).

## Preguntas abiertas

- ¿El umbral de 30 días debería ser configurable por laboratorio (en `configuracion`)? → Fuera de alcance, pero dejarlo como nota para revisión futura.

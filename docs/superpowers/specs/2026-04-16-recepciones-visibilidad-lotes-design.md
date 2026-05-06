# Recepciones — Visibilidad de Lotes y Consistencia de Usuario — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Media
**Estado:** Propuesto

---

## Problema

En `frontend/src/pages/recepciones/index.tsx` y componentes asociados:

1. **Multi-lote invisible en la lista.** Desde la migración a multi-lote por producto (ver `2026-04-08-recepcion-multi-lote-design.md`), una recepción puede tener 1..N lotes por item. En la lista solo se ve el número de documento y el ícono de "tiene foto"; no hay indicador de cuántos lotes/items contiene. Esto obliga a entrar al detalle para saber si el borrador está completo.
2. **Usuario inconsistente entre lista y detalle.** En la lista, la columna "Usuario" está `hidden md:table-cell` (~línea 213). En el detalle, "Solicitado por" es prominente. La prioridad del dato debería ser la misma en ambas vistas.

## Objetivo

- Una recepción se puede evaluar desde la lista sin entrar al detalle: cuántos items, cuántos lotes, estado de completitud.
- El campo "Usuario" tiene la misma visibilidad en todos los viewports (o una regla coherente).

## Alcance

**Incluido:**
- Badge "N items / M lotes" en cada fila de recepción.
- Indicador de completitud para borradores: `✓ Listo para confirmar` o `⚠ Falta <campo>`.
- Mostrar "Usuario" en todos los viewports (o mover a un sub-título/caption en móvil si el espacio aprieta, pero no ocultarlo).

**Fuera de alcance:**
- Rediseñar la página de detalle (ya tuvo spec propio).
- Añadir filtros nuevos.

## Diseño propuesto

### UI

**Fila de recepción (lista):**

Layout propuesto (desktop):
```
┌──────────────────────────────────────────────────────────────┐
│ REC-000042  ·  2026-04-10  ·  Laboratorista Juan Pérez       │
│ Proveedor X  ·  3 items · 5 lotes  ·  🖼  ·  [borrador]      │
│                                        [Confirmar] [Eliminar] │
└──────────────────────────────────────────────────────────────┘
```

- `N items / M lotes`: badge compacto.
- Ícono `🖼` si `tiene_foto`.
- Estado: chip `borrador` / `confirmada`.
- "Usuario" visible siempre.

**Completitud para borradores:**

En cada borrador, calcular:
- ¿Todos los items tienen al menos un lote?
- ¿Todos los lotes tienen código + vencimiento + cantidad?

Mostrar:
- `✓ Listo para confirmar` (verde) si todo está completo.
- `⚠ N items sin lote` o `⚠ Falta vencimiento en K lotes` si hay pendientes.

El botón "Confirmar" en la lista queda deshabilitado si no está listo; tooltip indica qué falta.

### Lógica

El backend ya devuelve los items con sus lotes en `GET /recepciones`. Si no los devuelve, ajustar el endpoint para incluir `items_count` y `lotes_count` pre-calculados en la response de la lista (evitar N+1 queries).

**DTO sugerido** (`backend/src/dto/recepcion.rs`):
```rust
pub struct RecepcionListItem {
  // existentes
  pub items_count: i32,
  pub lotes_count: i32,
  pub completitud: CompletitudEstado, // "lista" | "items_sin_lote" | "lotes_incompletos"
}
```

## Archivos afectados

**Frontend:**
- `frontend/src/pages/recepciones/index.tsx` (fila de recepción, columna usuario)
- `frontend/src/pages/recepciones/components/recepcion-row.tsx` (si existe, sino crear)

**Backend:**
- `backend/src/handlers/recepciones.rs` (incluir counts en listado)
- `backend/src/dto/recepcion.rs` (DTO de listado)

## Criterios de aceptación

- [ ] Cada fila muestra "N items · M lotes".
- [ ] Borradores completos muestran chip verde "Listo"; incompletos muestran chip amarillo con detalle.
- [ ] "Usuario" visible en todos los breakpoints.
- [ ] El botón "Confirmar" en la lista queda deshabilitado si el borrador está incompleto, con tooltip explicativo.
- [ ] El listado no introduce queries N+1 (verificar logs SQL).

## Preguntas abiertas

- ¿Mostrar también "items/lotes" para recepciones ya confirmadas? → Sí, por consistencia; aunque ya no cambian, el dato es útil para auditoría rápida.
